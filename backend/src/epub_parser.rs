use sqlx::SqlitePool;
use uuid::Uuid;
use std::path::Path;
use std::io::{Read, BufReader};
use zip::ZipArchive;

use crate::config;
use crate::embedding;
use crate::epub_utils::{get_content_opf_path, parse_content_opf, is_non_content_spine_item};
use crate::text_utils::split_text_with_overlap;

/// Parse an EPUB file and create chunks in the database
/// Chapters are treated as units, with ~16000 char segments (~4000 tokens) with overlap
pub async fn parse_epub(book_id: &str, file_path: &str, pool: &SqlitePool) -> Result<usize, String> {
    // Verify file exists
    let path = Path::new(file_path);
    if !path.exists() {
        return Err(format!("EPUB file not found: {}", file_path));
    }

    // Open the EPUB file (which is a ZIP archive)
    let file = std::fs::File::open(path)
        .map_err(|e| format!("Failed to open EPUB file: {}", e))?;
    let reader = BufReader::new(file);
    let mut archive = ZipArchive::new(reader)
        .map_err(|e| format!("Failed to read EPUB as ZIP: {}", e))?;

    // Step 1: Parse container.xml to find content.opf path
    let content_opf_path = get_content_opf_path(&mut archive)?;

    // Step 2: Parse content.opf to get manifest and spine
    let (manifest, spine) = parse_content_opf(&mut archive, &content_opf_path)?;

    // Extract base directory from content.opf path (e.g., "EPUB/" from "EPUB/content.opf")
    let base_dir = if let Some(last_slash) = content_opf_path.rfind('/') {
        content_opf_path[..last_slash + 1].to_string()
    } else {
        String::new()
    };

    // Step 3: Extract content from each file in spine order
    // Build a map from filename to (title, content)
    let mut file_contents: std::collections::HashMap<String, (String, String)> = std::collections::HashMap::new();

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| format!("Failed to read ZIP entry: {}", e))?;

        let file_name = file.name().to_string();

        // Only process XHTML/HTML content files
        if file_name.ends_with(".xhtml") || file_name.ends_with(".html") || file_name.ends_with(".htm") {
            let mut content = String::new();
            file.read_to_string(&mut content)
                .map_err(|e| format!("Failed to read content file: {}", e))?;

            // Extract text from HTML
            let text = extract_text_from_html(&content);

            // Use filename as chapter title (clean it up)
            let chapter_title = clean_chapter_title(&file_name);

            if !text.trim().is_empty() {
                file_contents.insert(file_name, (chapter_title, text));
            }
        }
    }

    // Step 4: Iterate through spine order and create chunks
    // Build href to chapter_num mapping
    let mut href_to_chapter: std::collections::HashMap<String, i32> = std::collections::HashMap::new();
    let mut chapter_num = 0;

    // First pass: assign chapter numbers in spine order
    for itemref in &spine {
        if let Some(href) = manifest.get(itemref.as_str()) {
            // Skip non-content files (like nav.xhtml which is navigation)
            if is_non_content_spine_item(href) {
                continue;
            }
            chapter_num += 1;
            href_to_chapter.insert(href.clone(), chapter_num);
        }
    }

    // Note: total_pages for EPUB is set during upload via count_epub_chapters().
    // We do NOT update it here to avoid upload-vs-parse inconsistency.

    // Delete existing chunks for this book (in case of re-parsing)
    sqlx::query("DELETE FROM chunks WHERE book_id = ?")
        .bind(book_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to delete existing chunks: {}", e))?;

    // Create chunks from content in spine order
    let created_at = chrono::Utc::now().to_rfc3339();
    let mut chunks_created = 0;

    for itemref in &spine {
        if let Some(href) = manifest.get(itemref.as_str()) {
            // Skip non-content files
            if is_non_content_spine_item(href) {
                continue;
            }

            // Get chapter number for this href
            let chapter = match href_to_chapter.get(href) {
                Some(&c) => c,
                None => continue,
            };

            // Build full path by prepending base directory to href
            let full_path = format!("{}{}", base_dir, href);

            // Get content from file_contents (using full_path since ZIP keys include base dir)
            let (_chapter_title, chapter_content) = match file_contents.get(&full_path) {
                Some(c) => c,
                None => continue,
            };

            let content = chapter_content.trim();
            if content.is_empty() {
                continue;
            }

            // Store the href (relative path) for navigation - this matches what epubjs uses
            let chapter_href = href.clone();

            // If chapter is under 16000 chars (~4000 tokens), create single chunk
            if content.chars().count() <= 16000 {
                let chunk_id = Uuid::new_v4().to_string();
                sqlx::query(
                    "INSERT INTO chunks (id, book_id, page_start, page_end, content, chapter_href, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
                )
                .bind(&chunk_id)
                .bind(book_id)
                .bind(chapter)
                .bind(chapter)
                .bind(&content)
                .bind(&chapter_href)
                .bind(&created_at)
                .execute(pool)
                .await
                .map_err(|e| format!("Failed to insert chunk: {}", e))?;

                // Insert into FTS table
                sqlx::query(
                    "INSERT INTO chunks_fts (chunk_id, content) VALUES (?, ?)"
                )
                .bind(&chunk_id)
                .bind(&content)
                .execute(pool)
                .await
                .map_err(|e| format!("Failed to insert FTS entry: {}", e))?;

                chunks_created += 1;
            } else {
                // Split chapter into ~16000 char chunks (~4000 tokens) with overlap
                let sub_chunks = split_text_with_overlap(content, 16000, 400);
                for chunk_content in sub_chunks.iter() {
                    let chunk_id = Uuid::new_v4().to_string();
                    sqlx::query(
                        "INSERT INTO chunks (id, book_id, page_start, page_end, content, chapter_href, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
                    )
                    .bind(&chunk_id)
                    .bind(book_id)
                    .bind(chapter)
                    .bind(chapter)
                    .bind(chunk_content)
                    .bind(&chapter_href)
                    .bind(&created_at)
                    .execute(pool)
                    .await
                    .map_err(|e| format!("Failed to insert chunk: {}", e))?;

                    // Insert into FTS table
                    sqlx::query(
                        "INSERT INTO chunks_fts (chunk_id, content) VALUES (?, ?)"
                    )
                    .bind(&chunk_id)
                    .bind(chunk_content)
                    .execute(pool)
                    .await
                    .map_err(|e| format!("Failed to insert FTS entry: {}", e))?;

                    chunks_created += 1;
                }
            }
        }
    }

    // Spawn async task for embedding generation (non-blocking)
    let pool_clone = pool.clone();
    let book_id_clone = book_id.to_string();
    tokio::spawn(async move {
        // Get model config from database
        let model_config = match config::get_model_config(&pool_clone).await {
            Ok(cfg) => cfg,
            Err(e) => {
                tracing::error!("[EPUB Parser] Failed to get model config: {}", e);
                return;
            }
        };

        match embedding::generate_chunk_embeddings(
            &pool_clone,
            &book_id_clone,
            &model_config.embedding_model,
            &model_config.embedding_url,
        )
        .await
        {
            Ok(count) => {
                tracing::info!(
                    "[EPUB Parser] Embedding generation completed for book {}: {} chunks processed",
                    book_id_clone,
                    count
                );
            }
            Err(e) => {
                tracing::error!(
                    "[EPUB Parser] Embedding generation failed for book {}: {}",
                    book_id_clone,
                    e
                );
            }
        }
    });

    Ok(chunks_created)
}

/// Extract plain text from HTML content
fn extract_text_from_html(html: &str) -> String {
    // Remove script and style tags first
    let mut text = html.to_string();

    // Remove <script>...</script>
    while let Some(start) = text.find("<script") {
        if let Some(end_tag) = text[start..].find("</script>") {
            let end = start + end_tag + 9; // 9 = len("</script>")
            text = format!("{}{}", &text[..start], &text[end..]);
        } else {
            break;
        }
    }

    // Remove <style>...</style>
    while let Some(start) = text.find("<style") {
        if let Some(end_tag) = text[start..].find("</style>") {
            let end = start + end_tag + 8; // 8 = len("</style>")
            text = format!("{}{}", &text[..start], &text[end..]);
        } else {
            break;
        }
    }

    // Remove all HTML tags
    let mut result = String::new();
    let mut in_tag = false;

    for ch in text.chars() {
        if ch == '<' {
            in_tag = true;
            result.push(' ');
        } else if ch == '>' {
            in_tag = false;
            result.push(' ');
        } else if !in_tag {
            result.push(ch);
        }
    }

    // Clean up whitespace
    let mut cleaned = String::new();
    let mut last_was_space = false;

    for ch in result.chars() {
        if ch.is_whitespace() {
            if !last_was_space {
                cleaned.push(' ');
                last_was_space = true;
            }
        } else {
            cleaned.push(ch);
            last_was_space = false;
        }
    }

    cleaned.trim().to_string()
}

/// Clean up chapter title from filename
fn clean_chapter_title(file_path: &str) -> String {
    // Get just the filename
    let file_name = if let Some(pos) = file_path.rfind('/') {
        &file_path[pos + 1..]
    } else {
        file_path
    };

    // Remove extension
    file_name
        .trim_end_matches(".xhtml")
        .trim_end_matches(".html")
        .trim_end_matches(".htm")
        .to_string()
}

