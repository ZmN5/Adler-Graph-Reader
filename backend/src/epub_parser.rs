use sqlx::SqlitePool;
use uuid::Uuid;
use std::path::Path;
use std::io::{Read, BufReader};
use zip::ZipArchive;

use crate::config;
use crate::embedding;

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
            let href_lower = href.to_lowercase();
            if href_lower.contains("nav.xhtml") || href_lower.contains("toc.xhtml") || href_lower.contains("cover.") {
                continue;
            }
            chapter_num += 1;
            href_to_chapter.insert(href.clone(), chapter_num);
        }
    }

    let total_chapters = chapter_num;

    // Update total_pages in books table (using chapters as "pages" for EPUB)
    sqlx::query("UPDATE books SET total_pages = ? WHERE id = ?")
        .bind(total_chapters)
        .bind(book_id)
        .execute(pool)
        .await
        .map_err(|e| format!("Failed to update total_pages: {}", e))?;

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
            let href_lower = href.to_lowercase();
            if href_lower.contains("nav.xhtml") || href_lower.contains("toc.xhtml") || href_lower.contains("cover.") {
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
            let (chapter_title, chapter_content) = match file_contents.get(&full_path) {
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

/// Get the path to content.opf from container.xml
fn get_content_opf_path(archive: &mut ZipArchive<BufReader<std::fs::File>>) -> Result<String, String> {
    // Read container.xml
    let mut container_file = archive.by_name("META-INF/container.xml")
        .map_err(|e| format!("Failed to find container.xml: {}", e))?;

    let mut container_xml = String::new();
    container_file.read_to_string(&mut container_xml)
        .map_err(|e| format!("Failed to read container.xml: {}", e))?;

    // Parse rootfile full-path attribute
    // <rootfile media-type="application/oebps-package+xml" full-path="EPUB/content.opf"/>
    let start = container_xml.find("full-path=\"").ok_or("Could not find full-path in container.xml")?;
    let start = start + "full-path=\"".len();
    let end = container_xml[start..].find('"').ok_or("Could not find end of full-path")?;
    let opf_path = container_xml[start..start + end].to_string();

    Ok(opf_path)
}

/// Parse content.opf to get manifest and spine
fn parse_content_opf(
    archive: &mut ZipArchive<BufReader<std::fs::File>>,
    opf_path: &str,
) -> Result<(std::collections::HashMap<String, String>, Vec<String>), String> {
    // Read content.opf
    let mut opf_file = archive.by_name(opf_path)
        .map_err(|e| format!("Failed to find content.opf at {}: {}", opf_path, e))?;

    let mut opf_xml = String::new();
    opf_file.read_to_string(&mut opf_xml)
        .map_err(|e| format!("Failed to read content.opf: {}", e))?;

    // Parse manifest: build id -> href map
    // Find the manifest section and extract all <item> elements
    let mut manifest: std::collections::HashMap<String, String> = std::collections::HashMap::new();

    let manifest_start = opf_xml.find("<manifest>").ok_or("Could not find <manifest>")?;
    let manifest_end = opf_xml.find("</manifest>").ok_or("Could not find </manifest>")?;
    let manifest_section = &opf_xml[manifest_start..manifest_end];

    // Extract all id and href from manifest items
    // Note: href comes before id in the manifest, so we must search for href first
    let mut pos = 0;
    while let Some(item_start) = manifest_section[pos..].find("<item") {
        let item_start = pos + item_start;
        let item_end = manifest_section[item_start..].find("/>")
            .map(|p| item_start + p + 2)
            .or_else(|| manifest_section[item_start..].find("</item>")
                .map(|p| item_start + p + 7))
            .ok_or("Could not parse manifest item")?;

        let item_xml = &manifest_section[item_start..item_end];

        // Extract href FIRST (because it comes before id in the XML)
        let href = if let Some(href_start) = item_xml.find("href=\"") {
            let href_start = href_start + 6;
            let href_end = item_xml[href_start..].find('"').ok_or("Could not find href value")?;
            item_xml[href_start..href_start + href_end].to_string()
        } else {
            pos = item_end;
            continue;
        };

        // Extract id
        let id = if let Some(id_start) = item_xml.find("id=\"") {
            let id_start = id_start + 4;
            let id_end = item_xml[id_start..].find('"').ok_or("Could not find id value")?;
            item_xml[id_start..id_start + id_end].to_string()
        } else {
            pos = item_end;
            continue;
        };

        manifest.insert(id, href);

        // Move past this item
        pos = item_end;
    }

    // Parse spine: extract ordered list of idref values
    let mut spine: Vec<String> = Vec::new();

    let spine_start = opf_xml.find("<spine").ok_or("Could not find <spine>")?;
    let spine_end = opf_xml[spine_start..].find(">")
        .map(|p| spine_start + p + 1)
        .unwrap_or(spine_start + "<spine".len());

    // Handle both <spine ...> and <spine .../>
    let after_spine_tag = if &opf_xml[spine_end - 1..spine_end] == "/" {
        spine_end
    } else if let Some(closing) = opf_xml[spine_start..].find("</spine>") {
        spine_start + closing
    } else {
        return Err("Could not find end of spine".to_string());
    };

    let spine_section = &opf_xml[spine_end..after_spine_tag];

    // Extract all itemref idref values
    let mut pos = 0;
    while let Some(itemref_start) = spine_section[pos..].find("<itemref") {
        let itemref_start = pos + itemref_start;
        let itemref_end = spine_section[itemref_start..].find("/>")
            .map(|p| itemref_start + p + 2)
            .or_else(|| spine_section[itemref_start..].find(">")
                .map(|p| itemref_start + p + 1))
            .ok_or("Could not parse itemref")?;

        let itemref_xml = &spine_section[itemref_start..itemref_end];

        // Extract idref
        if let Some(idref_start) = itemref_xml.find("idref=\"") {
            let idref_start = idref_start + 7;
            let idref_end = itemref_xml[idref_start..].find('"').ok_or("Could not find idref value")?;
            let idref = itemref_xml[idref_start..idref_start + idref_end].to_string();
            spine.push(idref);
        }

        // Move past this itemref
        pos = itemref_end;
    }

    Ok((manifest, spine))
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

/// Split text into chunks of approximately target_size with overlap
fn split_text_with_overlap(text: &str, target_size: usize, overlap: usize) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let total_chars = chars.len();

    if total_chars <= target_size {
        return vec![text.to_string()];
    }

    let mut chunks: Vec<String> = Vec::new();
    let mut start = 0;

    while start < total_chars {
        let end = (start + target_size).min(total_chars);
        let chunk_text: String = chars[start..end].iter().collect();

        chunks.push(chunk_text);

        if end >= total_chars {
            break;
        }
        start = end - overlap;
    }

    chunks
}