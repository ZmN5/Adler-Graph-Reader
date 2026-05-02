use axum::{
    Json,
    extract::{Multipart, Path, State},
    http::StatusCode,
    response::IntoResponse,
};
use sqlx::SqlitePool;
use serde::Serialize;
use uuid::Uuid;

use super::{AppError};

#[derive(Serialize)]
pub struct BookSummary {
    pub id: String,
    pub title: String,
    pub author: Option<String>,
    pub format: String,
    pub total_pages: Option<i32>,
}

#[derive(Serialize)]
pub struct BookDetails {
    pub id: String,
    pub title: String,
    pub author: Option<String>,
    pub format: String,
    pub total_pages: Option<i32>,
    pub created_at: String,
}

#[derive(Serialize)]
pub struct UploadResponse {
    pub book_id: String,
    pub title: String,
}

pub async fn upload_book(
    pool: State<SqlitePool>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<UploadResponse>), AppError> {
    let mut title = String::new();
    let mut author: Option<String> = None;
    let mut language = String::from("auto");
    let mut file_data: Option<Vec<u8>> = None;
    let mut file_name = String::new();

    tracing::debug!("Starting multipart upload parsing");

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        tracing::error!("Multipart error: failed to get next field: {:?}", e);
        e.to_string()
    })? {
        let field_name = field.name().unwrap_or("").to_string();
        tracing::debug!("Processing field: {}", field_name);

        match field_name.as_str() {
            "title" => {
                title = field.text().await.map_err(|e| {
                    tracing::error!("Multipart error: failed to read title field: {:?}", e);
                    e.to_string()
                })?;
                tracing::debug!("Title: {}", title);
            }
            "author" => {
                author = Some(field.text().await.map_err(|e| {
                    tracing::error!("Multipart error: failed to read author field: {:?}", e);
                    e.to_string()
                })?);
            }
            "language" => {
                language = field.text().await.map_err(|e| {
                    tracing::error!("Multipart error: failed to read language field: {:?}", e);
                    e.to_string()
                })?;
                tracing::debug!("Language: {}", language);
            }
            "file" => {
                file_name = field.file_name().unwrap_or("unknown").to_string();
                tracing::debug!("File name: {}", file_name);
                file_data = Some(field.bytes().await.map_err(|e| {
                    tracing::error!("Multipart error: failed to read file bytes: {:?}", e);
                    e.to_string()
                })?.to_vec());
                tracing::debug!("File size: {} bytes", file_data.as_ref().map(|d| d.len()).unwrap_or(0));
            }
            _ => {
                tracing::warn!("Unknown field in multipart: {}", field_name);
            }
        }
    }

    tracing::debug!("Multipart parsing completed");

    let file_data = file_data.ok_or_else(|| AppError::BadRequest("No file provided".to_string()))?;
    if file_data.is_empty() {
        return Err(AppError::BadRequest("Empty file provided".to_string()));
    }

    // Determine format from extension
    let format = if file_name.to_lowercase().ends_with(".pdf") {
        "pdf"
    } else if file_name.to_lowercase().ends_with(".epub") {
        "epub"
    } else {
        return Err(AppError::BadRequest("Invalid file format, must be .pdf or .epub".to_string()));
    };

    // Generate book ID and file path
    let book_id = Uuid::new_v4().to_string();
    // Use consistent data directory path (same logic as main function)
    let current_dir = std::env::current_dir().map_err(|e| AppError::Internal(e.to_string()))?;
    let data_dir = current_dir.join("data");
    let books_dir = data_dir.join("books");
    tokio::fs::create_dir_all(&books_dir).await.map_err(|e| AppError::Internal(e.to_string()))?;

    let extension = if format == "pdf" { "pdf" } else { "epub" };
    let file_path = books_dir.join(format!("{}.{}", book_id, extension));

    // Save file
    tokio::fs::write(&file_path, &file_data).await.map_err(|e| AppError::Internal(e.to_string()))?;

    // For EPUB, count chapters immediately so total_pages is available right after upload
    let total_pages = if format == "epub" {
        match crate::epub_utils::count_epub_chapters(file_path.to_str().unwrap_or("")).await {
            Ok(count) => Some(count),
            Err(e) => {
                tracing::warn!("Failed to count EPUB chapters: {}", e);
                None
            }
        }
    } else {
        None
    };

    // Insert into database
    let created_at = chrono::Utc::now().to_rfc3339();
    let title_for_db = if title.is_empty() {
        file_name.clone()
    } else {
        title.clone()
    };

    sqlx::query(
        "INSERT INTO books (id, title, author, file_path, format, total_pages, language, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(&book_id)
    .bind(&title_for_db)
    .bind(&author)
    .bind(file_path.to_str().unwrap_or(""))
    .bind(format)
    .bind(total_pages)
    .bind(&language)
    .bind(&created_at)
    .execute(&*pool)
    .await?;

    Ok((StatusCode::CREATED, Json(UploadResponse { book_id, title: title_for_db })))
}

#[allow(clippy::type_complexity)]
pub async fn list_books(pool: State<SqlitePool>) -> Result<Json<Vec<BookSummary>>, AppError> {
    let rows: Vec<(String, String, Option<String>, String, Option<i32>)> = sqlx::query_as(
        "SELECT id, title, author, format, total_pages FROM books ORDER BY created_at DESC"
    )
    .fetch_all(&*pool)
    .await?;

    let books: Vec<BookSummary> = rows
        .into_iter()
        .map(|(id, title, author, format, total_pages)| BookSummary {
            id,
            title,
            author,
            format,
            total_pages,
        })
        .collect();

    Ok(Json(books))
}

pub async fn get_book(
    Path(book_id): Path<String>,
    pool: State<SqlitePool>,
) -> Result<Json<BookDetails>, AppError> {
    let row: (String, String, Option<String>, String, Option<i32>, String) = sqlx::query_as(
        "SELECT id, title, author, format, total_pages, created_at FROM books WHERE id = ?"
    )
    .bind(&book_id)
    .fetch_one(&*pool)
    .await
    .map_err(|_| AppError::NotFound("Book not found".to_string()))?;

    Ok(Json(BookDetails {
        id: row.0,
        title: row.1,
        author: row.2,
        format: row.3,
        total_pages: row.4,
        created_at: row.5,
    }))
}

pub async fn get_book_file(
    Path(book_id): Path<String>,
    pool: State<SqlitePool>,
) -> Result<impl IntoResponse, AppError> {
    let row: Option<(String, String)> = sqlx::query_as(
        "SELECT file_path, format FROM books WHERE id = ?"
    )
    .bind(&book_id)
    .fetch_optional(&*pool)
    .await
    .map_err(|e| AppError::Internal(e.to_string()))?;

    let (file_path, format) = match row {
        Some(r) => r,
        None => return Err(AppError::NotFound("Book not found".to_string())),
    };

    let data = tokio::fs::read(&file_path)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read file: {}", e)))?;

    let mime = match format.as_str() {
        "pdf" => "application/pdf",
        "epub" => "application/epub+zip",
        _ => "application/octet-stream",
    };

    Ok((
        [(axum::http::header::CONTENT_TYPE, mime)],
        data,
    ))
}

pub async fn delete_book(
    Path(book_id): Path<String>,
    pool: State<SqlitePool>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Get the file path first
    let file_path: Option<String> = sqlx::query_scalar(
        "SELECT file_path FROM books WHERE id = ?"
    )
    .bind(&book_id)
    .fetch_optional(&*pool)
    .await?;

    if file_path.is_none() {
        return Err(AppError::NotFound("Book not found".to_string()));
    }

    // Delete the file
    if let Some(path) = file_path {
        if let Err(e) = std::fs::remove_file(&path) {
            tracing::warn!("[delete_book] Failed to delete file {:?}: {}", path, e);
        }
    }

    // Use a transaction for atomic deletion, with cascading deletes in dependency order
    let mut tx = pool.begin().await?;

    // Delete dependent records in order: chunk_embeddings -> node_chunk_ranks -> edges -> nodes -> chunks -> books
    sqlx::query(
        r#"
        DELETE FROM chunk_embeddings
        WHERE chunk_id IN (SELECT id FROM chunks WHERE book_id = ?)
        "#,
    )
    .bind(&book_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        DELETE FROM node_chunk_ranks
        WHERE node_id IN (SELECT id FROM nodes WHERE book_id = ?)
        "#,
    )
    .bind(&book_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        DELETE FROM edges
        WHERE source_node_id IN (SELECT id FROM nodes WHERE book_id = ?)
           OR target_node_id IN (SELECT id FROM nodes WHERE book_id = ?)
        "#,
    )
    .bind(&book_id)
    .bind(&book_id)
    .execute(&mut *tx)
    .await?;

    sqlx::query("DELETE FROM nodes WHERE book_id = ?")
        .bind(&book_id)
        .execute(&mut *tx)
        .await?;

    sqlx::query("DELETE FROM chunks WHERE book_id = ?")
        .bind(&book_id)
        .execute(&mut *tx)
        .await?;

    sqlx::query("DELETE FROM books WHERE id = ?")
        .bind(&book_id)
        .execute(&mut *tx)
        .await?;

    tx.commit().await?;

    Ok(Json(serde_json::json!({ "deleted": true })))
}

// Parse response types
#[derive(Serialize)]
pub struct ParseResponse {
    pub status: String,
    pub chunks_created: usize,
    pub total_pages: i32,
}

// Rebuild indexes response types
#[derive(Serialize)]
pub struct RebuildIndexesResponse {
    pub status: String,
    pub fts_rebuilt: usize,
    pub embeddings_generated: usize,
}

pub async fn parse_book(
    Path(book_id): Path<String>,
    pool: State<SqlitePool>,
) -> Result<Json<ParseResponse>, AppError> {
    // Get book info
    let book: Option<(String, String, String)> = sqlx::query_as(
        "SELECT id, file_path, format FROM books WHERE id = ?"
    )
    .bind(&book_id)
    .fetch_optional(&*pool)
    .await?;

    let (book_id, file_path, format) = match book {
        Some(b) => b,
        None => return Err(AppError::NotFound("Book not found".to_string())),
    };

    // Parse based on format
    let result = match format.as_str() {
        "pdf" => crate::pdf_parser::parse_pdf(&book_id, &file_path, &pool).await?,
        "epub" => crate::epub_parser::parse_epub(&book_id, &file_path, &pool).await?,
        _ => return Err(AppError::BadRequest(format!("Unsupported format: {}", format))),
    };

    // Get total pages
    let total_pages: Option<i32> = sqlx::query_scalar(
        "SELECT total_pages FROM books WHERE id = ?"
    )
    .bind(&book_id)
    .fetch_optional(&*pool)
    .await?;

    Ok(Json(ParseResponse {
        status: "completed".to_string(),
        chunks_created: result,
        total_pages: total_pages.unwrap_or(0),
    }))
}

pub async fn rebuild_indexes(
    Path(book_id): Path<String>,
    pool: State<SqlitePool>,
) -> Result<Json<RebuildIndexesResponse>, AppError> {
    // Verify book exists
    let book_exists: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM books WHERE id = ?"
    )
    .bind(&book_id)
    .fetch_optional(&*pool)
    .await?;

    if book_exists.is_none() {
        return Err(AppError::NotFound("Book not found".to_string()));
    }

    // Check if book has chunks
    let chunk_count: Option<i64> = sqlx::query_scalar(
        "SELECT COUNT(*) FROM chunks WHERE book_id = ?"
    )
    .bind(&book_id)
    .fetch_optional(&*pool)
    .await?;

    if chunk_count.unwrap_or(0) == 0 {
        return Err(AppError::BadRequest(format!(
            "Book has no chunks. Please parse the book first via POST /api/books/{}/parse.",
            book_id
        )));
    }

    tracing::info!(
        "[API] Rebuild indexes request for book: {}",
        book_id
    );

    // Get model config for embedding
    let model_config = crate::config::get_model_config(&pool)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    // Rebuild FTS index
    let fts_count = crate::embedding::rebuild_fts_index(&pool, &book_id)
        .await
        .map_err(|e| AppError::Internal(format!("FTS rebuild failed: {}", e)))?;

    // Generate embeddings for chunks without embeddings
    let embedding_count = crate::embedding::generate_chunk_embeddings(
        &pool,
        &book_id,
        &model_config.embedding_model,
        &model_config.embedding_url,
        &model_config.api_key,
    )
    .await
    .map_err(|e| AppError::Internal(format!("Embedding generation failed: {}", e)))?;

    tracing::info!(
        "[API] Rebuild indexes completed for book {}: fts={}, embeddings={}",
        book_id,
        fts_count,
        embedding_count
    );

    Ok(Json(RebuildIndexesResponse {
        status: "completed".to_string(),
        fts_rebuilt: fts_count,
        embeddings_generated: embedding_count,
    }))
}

// Chunk-related types
#[derive(Serialize)]
pub struct ChunkSummary {
    pub id: String,
    pub book_id: String,
    pub page_start: i32,
    pub page_end: i32,
    pub content: String, // First 200 chars
}

#[derive(Serialize)]
pub struct ChunkDetails {
    pub id: String,
    pub book_id: String,
    pub page_start: i32,
    pub page_end: i32,
    pub content: String, // Full content
    pub chapter_href: Option<String>, // For EPUB navigation
}

pub async fn get_book_chunks(
    Path(book_id): Path<String>,
    pool: State<SqlitePool>,
) -> Result<Json<Vec<ChunkSummary>>, AppError> {
    // Verify book exists
    let book_exists: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM books WHERE id = ?"
    )
    .bind(&book_id)
    .fetch_optional(&*pool)
    .await?;

    if book_exists.is_none() {
        return Err(AppError::NotFound("Book not found".to_string()));
    }

    let rows: Vec<(String, String, i32, i32, String)> = sqlx::query_as(
        "SELECT id, book_id, page_start, page_end, content FROM chunks WHERE book_id = ? ORDER BY page_start, page_end"
    )
    .bind(&book_id)
    .fetch_all(&*pool)
    .await?;

    let chunks: Vec<ChunkSummary> = rows
        .into_iter()
        .map(|(id, book_id, page_start, page_end, content)| {
            // Truncate content to first 200 chars for list view
            let truncated_content = if content.chars().count() > 200 {
                content.chars().take(200).collect::<String>() + "..."
            } else {
                content
            };
            ChunkSummary {
                id,
                book_id,
                page_start,
                page_end,
                content: truncated_content,
            }
        })
        .collect();

    Ok(Json(chunks))
}

pub async fn get_chunk(
    Path(chunk_id): Path<String>,
    pool: State<SqlitePool>,
) -> Result<Json<ChunkDetails>, AppError> {
    let row: (String, String, i32, i32, String, Option<String>) = sqlx::query_as(
        "SELECT id, book_id, page_start, page_end, content, chapter_href FROM chunks WHERE id = ?"
    )
    .bind(&chunk_id)
    .fetch_one(&*pool)
    .await
    .map_err(|_| AppError::NotFound("Chunk not found".to_string()))?;

    Ok(Json(ChunkDetails {
        id: row.0,
        book_id: row.1,
        page_start: row.2,
        page_end: row.3,
        content: row.4,
        chapter_href: row.5,
    }))
}
