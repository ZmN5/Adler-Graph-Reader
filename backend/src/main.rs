mod chat;
mod config;
mod core_concept;
mod db;
mod embedding;
mod epub_parser;
mod epub_utils;
mod extractor;
mod llm_client;
mod pdf_parser;
mod retrieval;
mod text_utils;

use retrieval::HybridRetriever;
use llm_client::{LlmClient, SourceGroundedSummaryRequest};

use axum::{
    routing::{get, put, post, delete},
    Router,
    Json,
    extract::{Path, Multipart, DefaultBodyLimit},
    http::StatusCode,
    response::IntoResponse,
};
use axum::response::sse::{Sse, Event as SseEvent, KeepAlive};
use futures::StreamExt;
use tower::ServiceBuilder;
use tower_http::cors::{Any, CorsLayer};
use std::net::SocketAddr;
use tokio::net::TcpListener;
use sqlx::SqlitePool;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(serde::Serialize)]
struct HealthResponse {
    status: String,
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
    })
}

#[derive(Serialize)]
struct LanguageResponse {
    language: String,
}

#[derive(Deserialize)]
struct LanguageRequest {
    language: String,
}

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}

// Custom error type for handlers
enum AppError {
    Sqlx(sqlx::Error),
    BadRequest(String),
    NotFound(String),
    Internal(String),
}

impl IntoResponse for AppError {
    fn into_response(self) -> axum::response::Response {
        match self {
            AppError::Sqlx(e) => {
                (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: e.to_string() })).into_response()
            }
            AppError::BadRequest(msg) => {
                (StatusCode::BAD_REQUEST, Json(ErrorResponse { error: msg })).into_response()
            }
            AppError::NotFound(msg) => {
                (StatusCode::NOT_FOUND, Json(ErrorResponse { error: msg })).into_response()
            }
            AppError::Internal(msg) => {
                (StatusCode::INTERNAL_SERVER_ERROR, Json(ErrorResponse { error: msg })).into_response()
            }
        }
    }
}

impl From<sqlx::Error> for AppError {
    fn from(e: sqlx::Error) -> Self {
        AppError::Sqlx(e)
    }
}

impl From<String> for AppError {
    fn from(e: String) -> Self {
        AppError::Internal(e)
    }
}

impl From<&str> for AppError {
    fn from(e: &str) -> Self {
        AppError::Internal(e.to_string())
    }
}

async fn get_language(pool: axum::extract::State<SqlitePool>) -> Result<Json<LanguageResponse>, AppError> {
    let row: (String,) = sqlx::query_as("SELECT value FROM settings WHERE key = 'language'")
        .fetch_one(&*pool)
        .await?;

    Ok(Json(LanguageResponse { language: row.0 }))
}

async fn put_language(
    pool: axum::extract::State<SqlitePool>,
    Json(req): Json<LanguageRequest>,
) -> Result<Json<LanguageResponse>, AppError> {
    // Validate language value
    if req.language != "zh" && req.language != "en" {
        return Err(AppError::BadRequest("Invalid language, must be 'zh' or 'en'".to_string()));
    }

    sqlx::query("UPDATE settings SET value = ?, updated_at = datetime('now') WHERE key = 'language'")
        .bind(&req.language)
        .execute(&*pool)
        .await?;

    Ok(Json(LanguageResponse { language: req.language }))
}

// Model config types
#[derive(Debug, Serialize, Deserialize)]
pub struct ModelConfigResponse {
    pub embedding_model: String,
    pub embedding_url: String,
    pub llm_model: String,
    pub llm_api_url: String,
    pub reranker_model: String,
}

#[derive(Debug, Deserialize)]
pub struct ModelConfigUpdateRequest {
    pub key: String,
    pub value: String,
}

async fn get_model_config(
    pool: axum::extract::State<SqlitePool>,
) -> Result<Json<ModelConfigResponse>, AppError> {
    let config = config::get_model_config(&pool.0)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    Ok(Json(ModelConfigResponse {
        embedding_model: config.embedding_model,
        embedding_url: config.embedding_url,
        llm_model: config.llm_model,
        llm_api_url: config.llm_api_url,
        reranker_model: config.reranker_model,
    }))
}

async fn put_model_config(
    pool: axum::extract::State<SqlitePool>,
    Json(req): Json<ModelConfigUpdateRequest>,
) -> Result<Json<ModelConfigResponse>, AppError> {
    // Validate key
    let valid_keys = ["embedding_model", "embedding_url", "llm_model", "llm_api_url", "reranker_model"];
    if !valid_keys.contains(&req.key.as_str()) {
        return Err(AppError::BadRequest(format!(
            "Invalid config key '{}'. Valid keys: {:?}",
            req.key, valid_keys
        )));
    }

    // Update the config value
    config::update_config_value(&pool.0, &req.key, &req.value)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    // Return updated full config
    let config = config::get_model_config(&pool.0)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    tracing::info!("[ModelConfig] Updated {} to '{}'", req.key, req.value);

    Ok(Json(ModelConfigResponse {
        embedding_model: config.embedding_model,
        embedding_url: config.embedding_url,
        llm_model: config.llm_model,
        llm_api_url: config.llm_api_url,
        reranker_model: config.reranker_model,
    }))
}

// Book-related types
#[derive(Serialize)]
struct BookSummary {
    id: String,
    title: String,
    author: Option<String>,
    format: String,
    total_pages: Option<i32>,
}

#[derive(Serialize)]
struct BookDetails {
    id: String,
    title: String,
    author: Option<String>,
    format: String,
    total_pages: Option<i32>,
    created_at: String,
}

#[derive(Serialize)]
struct UploadResponse {
    book_id: String,
    title: String,
}

async fn upload_book(
    pool: axum::extract::State<SqlitePool>,
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
    std::fs::create_dir_all(&books_dir).map_err(|e| AppError::Internal(e.to_string()))?;

    let extension = if format == "pdf" { "pdf" } else { "epub" };
    let file_path = books_dir.join(format!("{}.{}", book_id, extension));

    // Save file
    std::fs::write(&file_path, &file_data).map_err(|e| AppError::Internal(e.to_string()))?;

    // For EPUB, count chapters immediately so total_pages is available right after upload
    let total_pages = if format == "epub" {
        match epub_utils::count_epub_chapters(file_path.to_str().unwrap_or("")) {
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

async fn list_books(pool: axum::extract::State<SqlitePool>) -> Result<Json<Vec<BookSummary>>, AppError> {
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

async fn get_book(
    Path(book_id): Path<String>,
    pool: axum::extract::State<SqlitePool>,
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

async fn get_book_file(
    Path(book_id): Path<String>,
    pool: axum::extract::State<SqlitePool>,
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

async fn delete_book(
    Path(book_id): Path<String>,
    pool: axum::extract::State<SqlitePool>,
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
struct ParseResponse {
    status: String,
    chunks_created: usize,
    total_pages: i32,
}

// Rebuild indexes response types
#[derive(Serialize)]
struct RebuildIndexesResponse {
    status: String,
    fts_rebuilt: usize,
    embeddings_generated: usize,
}

async fn parse_book(
    Path(book_id): Path<String>,
    pool: axum::extract::State<SqlitePool>,
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
        "pdf" => pdf_parser::parse_pdf(&book_id, &file_path, &*pool).await?,
        "epub" => epub_parser::parse_epub(&book_id, &file_path, &*pool).await?,
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

async fn rebuild_indexes(
    Path(book_id): Path<String>,
    pool: axum::extract::State<SqlitePool>,
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
    let model_config = config::get_model_config(&pool)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    // Rebuild FTS index
    let fts_count = embedding::rebuild_fts_index(&pool, &book_id)
        .await
        .map_err(|e| AppError::Internal(format!("FTS rebuild failed: {}", e)))?;

    // Generate embeddings for chunks without embeddings
    let embedding_count = embedding::generate_chunk_embeddings(
        &pool,
        &book_id,
        &model_config.embedding_model,
        &model_config.embedding_url,
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
struct ChunkSummary {
    id: String,
    book_id: String,
    page_start: i32,
    page_end: i32,
    content: String, // First 200 chars
}

#[derive(Serialize)]
struct ChunkDetails {
    id: String,
    book_id: String,
    page_start: i32,
    page_end: i32,
    content: String, // Full content
    chapter_href: Option<String>, // For EPUB navigation
}

async fn get_book_chunks(
    Path(book_id): Path<String>,
    pool: axum::extract::State<SqlitePool>,
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

async fn get_chunk(
    Path(chunk_id): Path<String>,
    pool: axum::extract::State<SqlitePool>,
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

// Graph-related types
#[derive(Serialize)]
struct GraphNode {
    id: String,
    name: String,
    description: String,
    examples: Vec<String>,
    source_chunk_ids: Vec<String>,
    is_core: bool,
    category: Option<String>,
}

#[derive(Serialize)]
struct GraphEdge {
    id: String,
    source_node_id: String,
    target_node_id: String,
    relation_type: String,
}

#[derive(Serialize)]
struct GraphResponse {
    nodes: Vec<GraphNode>,
    edges: Vec<GraphEdge>,
}

async fn get_book_graph(
    Path(book_id): Path<String>,
    pool: axum::extract::State<SqlitePool>,
) -> Result<Json<GraphResponse>, AppError> {
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

    // Fetch all nodes for this book
    let node_rows: Vec<(String, String, Option<String>, String, String, bool, Option<String>)> = sqlx::query_as(
        "SELECT id, name, description, examples, source_chunk_ids, is_core, category FROM nodes WHERE book_id = ?"
    )
    .bind(&book_id)
    .fetch_all(&*pool)
    .await?;

    // Get node IDs for edge filtering
    let node_ids: Vec<String> = node_rows.iter().map(|(id, _, _, _, _, _, _)| id.clone()).collect();

    // Fetch all edges where both source and target belong to this book
    let edge_rows: Vec<(String, String, String, String)> = if node_ids.is_empty() {
        vec![]
    } else {
        // Build query with placeholders for node IDs
        let placeholders: Vec<&str> = node_ids.iter().map(|_| "?").collect();
        let query = format!(
            "SELECT id, source_node_id, target_node_id, relation_type FROM edges WHERE source_node_id IN ({}) AND target_node_id IN ({})",
            placeholders.join(","),
            placeholders.join(",")
        );
        let mut query_builder = sqlx::query_as::<_, (String, String, String, String)>(&query);
        for id in &node_ids {
            query_builder = query_builder.bind(id);
        }
        for id in &node_ids {
            query_builder = query_builder.bind(id);
        }
        query_builder.fetch_all(&*pool).await?
    };

    let nodes: Vec<GraphNode> = node_rows
        .into_iter()
        .map(|(id, name, description, examples, source_chunk_ids, is_core, category)| {
            let examples: Vec<String> = serde_json::from_str(&examples)
                .map_err(|e| tracing::warn!("Failed to parse examples JSON for node '{}': {}", name, e))
                .unwrap_or_default();
            let source_chunk_ids: Vec<String> = serde_json::from_str(&source_chunk_ids)
                .map_err(|e| tracing::warn!("Failed to parse source_chunk_ids JSON for node '{}': {}", name, e))
                .unwrap_or_default();
            GraphNode {
                id,
                name,
                description: description.unwrap_or_default(),
                examples,
                source_chunk_ids,
                is_core,
                category,
            }
        })
        .collect();

    let edges: Vec<GraphEdge> = edge_rows
        .into_iter()
        .map(|(id, source_node_id, target_node_id, relation_type)| GraphEdge {
            id,
            source_node_id,
            target_node_id,
            relation_type,
        })
        .collect();

    Ok(Json(GraphResponse { nodes, edges }))
}

async fn get_global_graph(
    pool: axum::extract::State<SqlitePool>,
) -> Result<Json<GraphResponse>, AppError> {
    // Fetch all nodes
    let node_rows: Vec<(String, String, Option<String>, String, String, bool, Option<String>)> = sqlx::query_as(
        "SELECT id, name, description, examples, source_chunk_ids, is_core, category FROM nodes"
    )
    .fetch_all(&*pool)
    .await?;

    // Fetch all edges
    let edge_rows: Vec<(String, String, String, String)> = sqlx::query_as(
        "SELECT id, source_node_id, target_node_id, relation_type FROM edges"
    )
    .fetch_all(&*pool)
    .await?;

    let nodes: Vec<GraphNode> = node_rows
        .into_iter()
        .map(|(id, name, description, examples, source_chunk_ids, is_core, category)| {
            let examples: Vec<String> = serde_json::from_str(&examples)
                .map_err(|e| tracing::warn!("Failed to parse examples JSON for node '{}': {}", name, e))
                .unwrap_or_default();
            let source_chunk_ids: Vec<String> = serde_json::from_str(&source_chunk_ids)
                .map_err(|e| tracing::warn!("Failed to parse source_chunk_ids JSON for node '{}': {}", name, e))
                .unwrap_or_default();
            GraphNode {
                id,
                name,
                description: description.unwrap_or_default(),
                examples,
                source_chunk_ids,
                is_core,
                category,
            }
        })
        .collect();

    let edges: Vec<GraphEdge> = edge_rows
        .into_iter()
        .map(|(id, source_node_id, target_node_id, relation_type)| GraphEdge {
            id,
            source_node_id,
            target_node_id,
            relation_type,
        })
        .collect();

    Ok(Json(GraphResponse { nodes, edges }))
}

#[derive(Serialize)]
struct NodeDetails {
    id: String,
    book_id: Option<String>,
    name: String,
    native_term: Option<String>,
    description: String,
    examples: Vec<String>,
    source_chunk_ids: Vec<String>,
    language: String,
    category: Option<String>,
    page_number: Option<i32>,
}

async fn get_node(
    Path(node_id): Path<String>,
    pool: axum::extract::State<SqlitePool>,
) -> Result<Json<NodeDetails>, AppError> {
    let row: (String, Option<String>, String, Option<String>, Option<String>, String, String, String, Option<String>, Option<i32>) = sqlx::query_as(
        "SELECT id, book_id, name, native_term, description, examples, source_chunk_ids, language, category, page_number FROM nodes WHERE id = ?"
    )
    .bind(&node_id)
    .fetch_one(&*pool)
    .await
    .map_err(|_| AppError::NotFound("Node not found".to_string()))?;

    let examples: Vec<String> = serde_json::from_str(&row.5)
        .map_err(|e| tracing::warn!("Failed to parse examples JSON for node '{}': {}", row.2, e))
        .unwrap_or_default();
    let source_chunk_ids: Vec<String> = serde_json::from_str(&row.6)
        .map_err(|e| tracing::warn!("Failed to parse source_chunk_ids JSON for node '{}': {}", row.2, e))
        .unwrap_or_default();

    Ok(Json(NodeDetails {
        id: row.0,
        book_id: row.1,
        name: row.2,
        native_term: row.3,
        description: row.4.unwrap_or_default(),
        examples,
        source_chunk_ids,
        language: row.7,
        category: row.8,
        page_number: row.9,
    }))
}

// Extraction-related types
#[derive(Serialize)]
struct ExtractResponse {
    status: String,
    nodes_count: usize,
    edges_count: usize,
    core_concepts_count: usize,
}

async fn extract_book(
    Path(book_id): Path<String>,
    pool: axum::extract::State<SqlitePool>,
) -> Result<Json<ExtractResponse>, AppError> {
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

    // Run extraction
    match extractor::extract_concepts_from_book(&*pool, &book_id).await {
        Ok((nodes_count, edges_count)) => {
            // Get core concepts count after extraction
            let core_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM nodes WHERE book_id = ? AND is_core = TRUE"
            )
            .bind(&book_id)
            .fetch_one(&*pool)
            .await
            .unwrap_or(0);

            // Get model config for embedding
            let model_config = config::get_model_config(&pool)
                .await
                .unwrap_or_else(|_| config::ModelConfig {
                    embedding_model: "text-embedding-qwen3-embedding-0.6b".to_string(),
                    embedding_url: "http://localhost:1234/v1/embeddings".to_string(),
                    llm_model: "qwen3.5-9b".to_string(),
                    llm_api_url: "http://localhost:1234/v1".to_string(),
                    reranker_model: "qwen3.5-9b".to_string(),
                });

            // Auto-rebuild FTS index and generate embeddings after extraction
            let _fts_count = embedding::rebuild_fts_index(&pool, &book_id)
                .await
                .unwrap_or(0);
            let _embedding_count = embedding::generate_chunk_embeddings(
                &pool,
                &book_id,
                &model_config.embedding_model,
                &model_config.embedding_url,
            )
            .await
            .unwrap_or(0);

            tracing::info!(
                "[extract_book] Auto-built indexes for book {}: fts={}, embeddings={}",
                book_id, _fts_count, _embedding_count
            );

            Ok(Json(ExtractResponse {
                status: "completed".to_string(),
                nodes_count,
                edges_count,
                core_concepts_count: core_count as usize,
            }))
        }
        Err(e) => Err(AppError::Internal(format!("Extraction failed: {}", e))),
    }
}

// Core concept-related types
#[derive(Serialize)]
struct IdentifyCoreConceptsResponse {
    status: String,
    core_concepts_count: usize,
}

// Retrieval-related types
#[derive(Serialize)]
struct RetrievalResponse {
    chunks: Vec<RetrievalResultItem>,
    total_found: usize,
}

#[derive(Serialize)]
struct RetrievalResultItem {
    chunk_id: String,
    content: String,
    page_start: i64,
    page_end: i64,
    vector_score: Option<f64>,
    bm25_score: Option<f64>,
    final_score: f64,
}

// Summary-related types
#[derive(Serialize)]
struct SummaryResponse {
    summary: String,
    citations: Vec<CitationItem>,
    sources: Vec<SourceItem>,
}

#[derive(Serialize)]
struct CitationItem {
    index: usize,
    chunk_id: String,
    page_start: i64,
    page_end: i64,
    excerpt: String,
}

#[derive(Serialize)]
struct SourceItem {
    index: usize,
    page_start: i64,
    page_end: i64,
    excerpt: String,
}

async fn get_core_concepts(
    Path(book_id): Path<String>,
    pool: axum::extract::State<SqlitePool>,
) -> Result<Json<Vec<GraphNode>>, AppError> {
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

    // Get core concepts - query returns nodes with is_core = TRUE
    let node_rows: Vec<(String, String, Option<String>, String, String, bool, Option<String>)> = sqlx::query_as(
        "SELECT id, name, description, examples, source_chunk_ids, is_core, category FROM nodes WHERE book_id = ? AND is_core = TRUE ORDER BY name"
    )
    .bind(&book_id)
    .fetch_all(&*pool)
    .await?;

    let nodes: Vec<GraphNode> = node_rows
        .into_iter()
        .map(|(id, name, description, examples, source_chunk_ids, is_core, category)| {
            let examples: Vec<String> = serde_json::from_str(&examples)
                .map_err(|e| tracing::warn!("Failed to parse examples JSON for node '{}': {}", name, e))
                .unwrap_or_default();
            let source_chunk_ids: Vec<String> = serde_json::from_str(&source_chunk_ids)
                .map_err(|e| tracing::warn!("Failed to parse source_chunk_ids JSON for node '{}': {}", name, e))
                .unwrap_or_default();
            GraphNode {
                id,
                name,
                description: description.unwrap_or_default(),
                examples,
                source_chunk_ids,
                is_core,
                category,
            }
        })
        .collect();

    Ok(Json(nodes))
}

async fn identify_core_concepts(
    Path(book_id): Path<String>,
    pool: axum::extract::State<SqlitePool>,
) -> Result<Json<IdentifyCoreConceptsResponse>, AppError> {
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

    // Check if book has nodes
    let node_count: Option<i64> = sqlx::query_scalar(
        "SELECT COUNT(*) FROM nodes WHERE book_id = ?"
    )
    .bind(&book_id)
    .fetch_optional(&*pool)
    .await?;

    if node_count.unwrap_or(0) == 0 {
        return Err(AppError::BadRequest("Book has no concepts to analyze. Extract concepts first.".to_string()));
    }

    // Run core concept identification
    let core_ids = core_concept::identify_core_concepts(&*pool, &book_id, None, None)
        .await
        .map_err(|e| AppError::Internal(e))?;

    Ok(Json(IdentifyCoreConceptsResponse {
        status: "completed".to_string(),
        core_concepts_count: core_ids.len(),
    }))
}

/// Handler for GET /api/nodes/{id}/retrieval
/// Returns retrieval results for a node using the hybrid retriever
async fn node_retrieval(
    Path(node_id): Path<String>,
    axum::extract::Query(params): axum::extract::Query<std::collections::HashMap<String, String>>,
    pool: axum::extract::State<SqlitePool>,
) -> Result<Json<RetrievalResponse>, AppError> {
    // Parse top_k parameter with default of 10
    let top_k = params
        .get("top_k")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(10);

    tracing::info!(
        "[API] Node retrieval request: node_id={}, top_k={}",
        node_id,
        top_k
    );

    // Create hybrid retriever with config from database
    let model_config = config::get_model_config(&pool.0)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let retriever = HybridRetriever::new(
        pool.0.clone(),
        model_config.llm_api_url,
        model_config.embedding_model,
        model_config.embedding_url,
    );

    // Run retrieval
    let results = retriever
        .retrieve_for_node(&node_id, Some(top_k))
        .await
        .map_err(|e| AppError::Internal(format!("Retrieval failed: {}", e)))?;

    let total_found = results.len();

    // Convert to response format
    let chunks: Vec<RetrievalResultItem> = results
        .into_iter()
        .map(|r| RetrievalResultItem {
            chunk_id: r.chunk_id,
            content: r.content,
            page_start: r.page_start,
            page_end: r.page_end,
            vector_score: r.vector_score,
            bm25_score: r.bm25_score,
            final_score: r.final_score,
        })
        .collect();

    tracing::info!(
        "[API] Node retrieval completed: node_id={}, found={}",
        node_id,
        total_found
    );

    Ok(Json(RetrievalResponse {
        chunks,
        total_found,
    }))
}

/// Handler for GET /api/nodes/{id}/summary
/// Returns source-grounded summary for a node
async fn node_summary(
    Path(node_id): Path<String>,
    pool: axum::extract::State<SqlitePool>,
) -> Result<Json<SummaryResponse>, AppError> {
    tracing::info!("[API] Node summary request: node_id={}", node_id);

    // Get node information from database
    let node_row: Option<(String, Option<String>, String, Option<String>)> = sqlx::query_as(
        "SELECT id, book_id, name, description FROM nodes WHERE id = ?"
    )
    .bind(&node_id)
    .fetch_optional(&*pool)
    .await
    .map_err(|e| AppError::Sqlx(e))?;

    let node_info = match node_row {
        Some(row) => row,
        None => return Err(AppError::NotFound("Node not found".to_string())),
    };

    let node_name = node_info.2;
    let node_description = node_info.3;

    // Create hybrid retriever and get retrieval results
    let model_config = config::get_model_config(&pool.0)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let retriever = HybridRetriever::new(
        pool.0.clone(),
        model_config.llm_api_url.clone(),
        model_config.embedding_model.clone(),
        model_config.embedding_url.clone(),
    );

    // Get retrieval results (top 10 for summary)
    let retrieval_outputs = retriever
        .retrieve_for_node(&node_id, Some(10))
        .await
        .map_err(|e| AppError::Internal(format!("Retrieval failed: {}", e)))?;

    if retrieval_outputs.is_empty() {
        return Ok(Json(SummaryResponse {
            summary: format!("未找到与 '{}' 相关的文档内容。", node_name),
            citations: vec![],
            sources: vec![],
        }));
    }

    // Convert retrieval outputs to LLM client format
    let retrieval_results: Vec<llm_client::RetrievalResult> = retrieval_outputs
        .iter()
        .map(|r| llm_client::RetrievalResult {
            chunk_id: r.chunk_id.clone(),
            content: r.content.clone(),
            page_start: r.page_start,
            page_end: r.page_end,
        })
        .collect();

    // Build summary request
    let summary_request = SourceGroundedSummaryRequest {
        node_name: node_name.clone(),
        node_description: node_description.clone(),
        retrieval_results,
    };

    // Create LLM client and generate summary
    let llm_client = LlmClient::new(&model_config.llm_api_url, &model_config.llm_model);
    let summary_result = llm_client
        .generate_source_grounded_summary(&summary_request)
        .await
        .map_err(|e| AppError::Internal(format!("Summary generation failed: {}", e)))?;

    // Convert citations to response format
    let citations: Vec<CitationItem> = summary_result
        .citations
        .iter()
        .map(|c| CitationItem {
            index: c.index,
            chunk_id: c.chunk_id.clone(),
            page_start: c.page_start,
            page_end: c.page_end,
            excerpt: c.excerpt.clone(),
        })
        .collect();

    // Build sources from retrieval outputs
    let sources: Vec<SourceItem> = retrieval_outputs
        .iter()
        .enumerate()
        .map(|(idx, r)| SourceItem {
            index: idx + 1,
            page_start: r.page_start,
            page_end: r.page_end,
            excerpt: r.content.chars().take(200).collect::<String>(),
        })
        .collect();

    tracing::info!(
        "[API] Node summary completed: node_id={}, citations={}",
        node_id,
        citations.len()
    );

    Ok(Json(SummaryResponse {
        summary: summary_result.summary,
        citations,
        sources,
    }))
}

/// Handler for GET /api/nodes/{id}/summary/stream
/// Returns source-grounded summary as a true token-level streaming SSE response
async fn node_summary_stream(
    Path(node_id): Path<String>,
    pool: axum::extract::State<SqlitePool>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    tracing::info!("[API] Node summary stream request: node_id={}", node_id);

    // Get node information from database
    let node_row: Option<(String, Option<String>, String, Option<String>)> = sqlx::query_as(
        "SELECT id, book_id, name, description FROM nodes WHERE id = ?"
    )
    .bind(&node_id)
    .fetch_optional(&*pool)
    .await
    .map_err(|e| AppError::Sqlx(e))?;

    let node_info = match node_row {
        Some(row) => row,
        None => return Err(AppError::NotFound("Node not found".to_string())),
    };

    let node_name = node_info.2;
    let node_description = node_info.3;

    // Create hybrid retriever and get retrieval results
    let model_config = config::get_model_config(&pool.0)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let retriever = HybridRetriever::new(
        pool.0.clone(),
        model_config.llm_api_url.clone(),
        model_config.embedding_model.clone(),
        model_config.embedding_url.clone(),
    );

    // Get retrieval results (top 10 for summary)
    let retrieval_outputs = retriever
        .retrieve_for_node(&node_id, Some(10))
        .await
        .map_err(|e| AppError::Internal(format!("Retrieval failed: {}", e)))?;

    if retrieval_outputs.is_empty() {
        return Err(AppError::NotFound("No relevant content found".to_string()));
    }

    // Convert retrieval outputs to LLM client format
    let retrieval_results: Vec<llm_client::RetrievalResult> = retrieval_outputs
        .iter()
        .map(|r| llm_client::RetrievalResult {
            chunk_id: r.chunk_id.clone(),
            content: r.content.clone(),
            page_start: r.page_start,
            page_end: r.page_end,
        })
        .collect();

    tracing::info!(
        "[========== SUMMARY GENERATION ==========]"
    );
    tracing::info!(
        "[Summary] INPUT: node_name='{}', description='{:?}'",
        node_name,
        node_description.as_ref().map(|s| s.chars().take(50).collect::<String>())
    );
    tracing::info!(
        "[Summary] INPUT: {} retrieval chunks for context",
        retrieval_results.len()
    );
    for (i, r) in retrieval_results.iter().take(3).enumerate() {
        tracing::debug!(
            "[Summary] Chunk {}: id='{}', pages={}-{}, content='{}...'",
            i + 1,
            r.chunk_id.chars().take(8).collect::<String>(),
            r.page_start,
            r.page_end,
            r.content.chars().take(100).collect::<String>()
        );
    }

    // Build summary request
    let summary_request = SourceGroundedSummaryRequest {
        node_name: node_name.clone(),
        node_description: node_description.clone(),
        retrieval_results,
    };

    // Generate summary with streaming tokens
    tracing::info!("[Summary] Calling LLM for source-grounded summary (streaming)...");
    let llm_client = LlmClient::new(&model_config.llm_api_url, &model_config.llm_model);

    // Clone for use in stream
    let retrieval_results_for_parse = summary_request.retrieval_results.clone();
    let node_id_clone = node_id.clone();

    let stream = async_stream::stream! {
        let mut full_text = String::new();

        // Stream tokens as they arrive from LLM
        let mut token_stream = llm_client.into_summary_stream(&summary_request);

        while let Some(token_result) = token_stream.next().await {
            match token_result {
                Ok(llm_client::SummaryStreamItem::Text(text)) => {
                    full_text.push_str(&text);
                    // Forward text as SSE event to client
                    let text_chunk = serde_json::json!({"type": "content", "text": text});
                    yield Ok::<_, std::convert::Infallible>(SseEvent::default().data(text_chunk.to_string()));
                }
                Ok(llm_client::SummaryStreamItem::Done) => {
                    yield Ok(SseEvent::default().data(r#"{"type":"done"}"#));
                }
                Err(e) => {
                    let error_chunk = serde_json::json!({
                        "type": "error",
                        "message": e.to_string()
                    });
                    yield Ok(SseEvent::default().data(error_chunk.to_string()));
                    yield Ok(SseEvent::default().data(r#"{"type":"done"}"#));
                    tracing::error!("[Summary] Stream error: {}", e);
                    return;
                }
            }
        }

        tracing::info!(
            "[Summary] Stream completed, full_text length={} chars",
            full_text.len()
        );

        // Parse citations from the full text
        let citations = parse_citations_from_summary(&full_text, &retrieval_results_for_parse);

        tracing::info!(
            "[API] Summary stream completed: node_id={}, citations={}",
            node_id_clone,
            citations.len()
        );

        // Send citation events
        for citation in citations {
            let citation_chunk = serde_json::json!({
                "type": "citation",
                "index": citation.index,
                "chunk_id": citation.chunk_id,
                "page_start": citation.page_start,
                "page_end": citation.page_end,
                "excerpt": citation.excerpt
            });
            yield Ok(SseEvent::default().data(citation_chunk.to_string()));
        }

        // Send done signal
        yield Ok(SseEvent::default().data(r#"{"type":"done"}"#));
    };

    Ok(Sse::new(stream)
        .keep_alive(KeepAlive::default())
        .into_response())
}

/// Parse citations from the summary text by extracting [Source: X] patterns
fn parse_citations_from_summary(
    summary: &str,
    retrieval_results: &[llm_client::RetrievalResult],
) -> Vec<CitationItem> {
    use regex::Regex;

    let citation_pattern = Regex::new(r"\[Source:\s*(\d+)\]").unwrap();
    let mut seen_indices = std::collections::HashSet::new();
    let mut citations = Vec::new();

    for caps in citation_pattern.captures_iter(summary) {
        if let Ok(idx) = caps[1].parse::<usize>() {
            if idx > 0 && idx <= retrieval_results.len() && seen_indices.insert(idx) {
                let result = &retrieval_results[idx - 1];
                let excerpt = result.content.chars().take(200).collect::<String>();
                citations.push(CitationItem {
                    index: idx,
                    chunk_id: result.chunk_id.clone(),
                    page_start: result.page_start,
                    page_end: result.page_end,
                    excerpt,
                });
            }
        }
    }

    // Sort by index
    citations.sort_by_key(|c| c.index);
    citations
}

// Chat handlers

async fn create_conversation(
    Path(book_id): Path<String>,
    pool: axum::extract::State<SqlitePool>,
    Json(req): Json<chat::CreateConversationRequest>,
) -> Result<(StatusCode, Json<chat::Conversation>), AppError> {
    let title = req.title.as_deref();
    let conversation = chat::create_conversation(&pool, &book_id, title)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to create conversation: {}", e)))?;
    Ok((StatusCode::CREATED, Json(conversation)))
}

async fn list_conversations(
    Path(book_id): Path<String>,
    pool: axum::extract::State<SqlitePool>,
) -> Result<Json<Vec<chat::Conversation>>, AppError> {
    let conversations = chat::list_conversations(&pool, &book_id)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to list conversations: {}", e)))?;
    Ok(Json(conversations))
}

async fn get_conversation(
    Path(conversation_id): Path<String>,
    pool: axum::extract::State<SqlitePool>,
) -> Result<Json<chat::ConversationWithMessages>, AppError> {
    let conversation = chat::get_conversation(&pool, &conversation_id)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to get conversation: {}", e)))?;
    Ok(Json(conversation))
}

async fn delete_conversation(
    Path(conversation_id): Path<String>,
    pool: axum::extract::State<SqlitePool>,
) -> Result<Json<serde_json::Value>, AppError> {
    chat::delete_conversation(&pool, &conversation_id)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to delete conversation: {}", e)))?;
    Ok(Json(serde_json::json!({ "deleted": true })))
}

async fn send_message_stream(
    Path(conversation_id): Path<String>,
    pool: axum::extract::State<SqlitePool>,
    Json(req): Json<chat::SendMessageRequest>,
) -> Result<impl axum::response::IntoResponse, AppError> {
    tracing::info!(
        "[API] Chat stream request: conversation_id={}, content_len={}",
        conversation_id,
        req.content.len()
    );

    let stream = chat::stream_chat_response(pool.0, conversation_id, req.content).await;

    Ok(Sse::new(stream)
        .keep_alive(KeepAlive::default())
        .into_response())
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Filter out pdf-extract glyph warnings (they're informational, not errors)
    // These warnings occur when PDFs use non-standard font glyph names
    tracing_subscriber::fmt()
        .with_target(false)
        .with_max_level(tracing::Level::INFO)
        .init();

    // Setup data directory with absolute path
    let current_dir = std::env::current_dir()?;
    let data_dir = current_dir.join("data");
    db::ensure_data_dir(&data_dir)?;

    // Create database pool
    let db_path = data_dir.join("reader.db");
    let database_url = format!("sqlite:{}", db_path.display());
    let pool = db::create_pool(&database_url).await?;

    // Initialize database schema
    db::init_database(&pool).await?;
    tracing::info!("Database initialized successfully");

    // CORS: restrict to known frontend origins
    let allowed_origins: Vec<String> = std::env::var("FRONTEND_URL")
        .map(|s| s.split(',').map(|o| o.trim().to_string()).collect())
        .unwrap_or_else(|_| vec!["http://localhost:5173".to_string()]);

    let cors = if allowed_origins.len() == 1 && allowed_origins[0] == "*" {
        CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any)
    } else {
        let origins: Vec<axum::http::HeaderValue> = allowed_origins
            .iter()
            .filter_map(|o| o.parse().ok())
            .collect();
        CorsLayer::new()
            .allow_origin(origins)
            .allow_methods(Any)
            .allow_headers(Any)
    };

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/settings/language", get(get_language))
        .route("/api/settings/language", put(put_language))
        .route("/api/settings/model-config", get(get_model_config))
        .route("/api/settings/model-config", put(put_model_config))
        .route("/api/books/upload", post(upload_book))
        .route("/api/books", get(list_books))
        .route("/api/books/{id}", get(get_book))
        .route("/api/books/{id}/file", get(get_book_file))
        .route("/api/books/{id}", delete(delete_book))
        .route("/api/books/{id}/parse", post(parse_book))
        .route("/api/books/{id}/rebuild-indexes", post(rebuild_indexes))
        .route("/api/books/{id}/chunks", get(get_book_chunks))
        .route("/api/chunks/{id}", get(get_chunk))
        .route("/api/books/{id}/graph", get(get_book_graph))
        .route("/api/graph/global", get(get_global_graph))
        .route("/api/nodes/{id}", get(get_node))
        .route("/api/nodes/{id}/retrieval", get(node_retrieval))
        .route("/api/nodes/{id}/summary", get(node_summary))
        .route("/api/nodes/{id}/summary/stream", get(node_summary_stream))
        .route("/api/books/{id}/extract", post(extract_book))
        .route("/api/books/{id}/core-concepts", get(get_core_concepts))
        .route("/api/books/{id}/identify-core-concepts", post(identify_core_concepts))
        .route("/api/books/{id}/conversations", post(create_conversation))
        .route("/api/books/{id}/conversations", get(list_conversations))
        .route("/api/conversations/{id}", get(get_conversation))
        .route("/api/conversations/{id}", delete(delete_conversation))
        .route("/api/conversations/{id}/messages/stream", post(send_message_stream))
        .layer(
            ServiceBuilder::new()
                .layer(cors)
                .layer(DefaultBodyLimit::max(100 * 1024 * 1024)) // 100MB limit for file uploads
        )
        .with_state(pool);

    let addr = SocketAddr::from(([127, 0, 0, 1], 8080));
    let listener = TcpListener::bind(addr).await?;

    tracing::info!("Server running on http://localhost:8080");

    axum::serve(listener, app).await?;

    Ok(())
}