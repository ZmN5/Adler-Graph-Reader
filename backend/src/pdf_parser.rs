use pdf_extract::extract_text;
use sqlx::SqlitePool;
use uuid::Uuid;
use std::path::Path;

/// Parse a PDF file and create chunks in the database
/// Each page becomes a chunk, or pages are split into ~16000 char segments (~4000 tokens) with overlap
pub async fn parse_pdf(book_id: &str, file_path: &str, pool: &SqlitePool) -> Result<usize, String> {
    // Verify file exists
    let path = Path::new(file_path);
    if !path.exists() {
        return Err(format!("PDF file not found: {}", file_path));
    }

    // Extract text from PDF
    let full_text = extract_text(path).map_err(|e| format!("Failed to extract text from PDF: {}", e))?;

    // Get total pages by counting page markers in the extracted text
    // pdf-extract extracts text page by page, separated by page markers
    let pages = split_pages_from_text(&full_text);
    let total_pages = pages.len() as i32;

    // Update total_pages in books table
    sqlx::query("UPDATE books SET total_pages = ? WHERE id = ?")
        .bind(total_pages)
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

    // Create chunks from pages
    // Strategy: each page is one chunk, with a target of ~16000 chars (~4000 tokens) per chunk
    // If a page is too long, it gets split with overlap
    let created_at = chrono::Utc::now().to_rfc3339();
    let mut chunks_created = 0;

    for (page_idx, page_text) in pages.iter().enumerate() {
        let page_num = page_idx as i32 + 1;
        let page_text = page_text.trim();

        if page_text.is_empty() {
            continue;
        }

        // If page is under 8000 chars (~2000 tokens), create single chunk
        if page_text.chars().count() <= 8000 {
            let chunk_id = Uuid::new_v4().to_string();
            sqlx::query(
                "INSERT INTO chunks (id, book_id, page_start, page_end, content, created_at) VALUES (?, ?, ?, ?, ?, ?)"
            )
            .bind(&chunk_id)
            .bind(book_id)
            .bind(page_num)
            .bind(page_num)
            .bind(page_text)
            .bind(&created_at)
            .execute(pool)
            .await
            .map_err(|e| format!("Failed to insert chunk: {}", e))?;
            chunks_created += 1;
        } else {
            // Split page into ~8000 char chunks (~2000 tokens) with overlap
            let chunks = split_text_with_overlap(page_text, 8000, 200);
            for chunk_content in chunks.iter() {
                let chunk_id = Uuid::new_v4().to_string();
                let chunk_start = page_num;
                let chunk_end = page_num; // Each sub-chunk still belongs to same page
                sqlx::query(
                    "INSERT INTO chunks (id, book_id, page_start, page_end, content, created_at) VALUES (?, ?, ?, ?, ?, ?)"
                )
                .bind(&chunk_id)
                .bind(book_id)
                .bind(chunk_start)
                .bind(chunk_end)
                .bind(chunk_content)
                .bind(&created_at)
                .execute(pool)
                .await
                .map_err(|e| format!("Failed to insert chunk: {}", e))?;
                chunks_created += 1;
            }
        }
    }

    Ok(chunks_created)
}

/// Split text into pages based on PDF page markers
fn split_pages_from_text(text: &str) -> Vec<String> {
    // pdf-extract typically separates pages with form feeds or specific markers
    // Common patterns: "\f" (form feed), "---Page---", etc.
    let mut pages: Vec<String> = Vec::new();

    // Try splitting by form feed first (common PDF output)
    let parts: Vec<&str> = text.split('\u{0C}').collect();
    if parts.len() > 1 {
        pages.extend(parts.iter().filter(|s| !s.trim().is_empty()).map(|s| s.to_string()));
        return pages;
    }

    // Try splitting by "Page" pattern (e.g., "Page 1 of 10")
    let page_patterns = ["\nPage ", "\r\nPage ", "Page "];
    for pattern in &page_patterns {
        let parts: Vec<&str> = text.split(pattern).collect();
        if parts.len() > 1 {
            // First part might be cover/intro, skip if too short
            let filtered: Vec<String> = parts.iter()
                .skip(1) // Skip first part (before first "Page X")
                .map(|s| s.to_string())
                .collect();
            if !filtered.is_empty() {
                pages.extend(filtered);
                return pages;
            }
        }
    }

    // Fallback: treat entire text as single page
    if pages.is_empty() && !text.trim().is_empty() {
        pages.push(text.to_string());
    }

    pages
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

        // Move start forward (target_size - overlap to maintain overlap)
        if end >= total_chars {
            break;
        }
        start = end - overlap;
    }

    chunks
}