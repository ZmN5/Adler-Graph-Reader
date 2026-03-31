mod core_concept;
mod db;
mod embedding;
mod epub_parser;
mod extractor;
mod llm_client;
mod pdf_parser;

use axum::{
    routing::{get, put, post, delete},
    Router,
    Json,
    extract::{Path, Multipart, DefaultBodyLimit},
    http::StatusCode,
    response::IntoResponse,
};
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
    file_path: String,
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

    // Insert into database
    let created_at = chrono::Utc::now().to_rfc3339();
    let title_for_db = if title.is_empty() {
        file_name.clone()
    } else {
        title.clone()
    };

    sqlx::query(
        "INSERT INTO books (id, title, author, file_path, format, total_pages, language, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)"
    )
    .bind(&book_id)
    .bind(&title_for_db)
    .bind(&author)
    .bind(file_path.to_str().unwrap_or(""))
    .bind(format)
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
    let row: (String, String, Option<String>, String, String, Option<i32>, String) = sqlx::query_as(
        "SELECT id, title, author, file_path, format, total_pages, created_at FROM books WHERE id = ?"
    )
    .bind(&book_id)
    .fetch_one(&*pool)
    .await
    .map_err(|_| AppError::NotFound("Book not found".to_string()))?;

    Ok(Json(BookDetails {
        id: row.0,
        title: row.1,
        author: row.2,
        file_path: row.3,
        format: row.4,
        total_pages: row.5,
        created_at: row.6,
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
        let _ = std::fs::remove_file(path);
    }

    // Delete book (cascades to chunks, nodes, edges via FK)
    sqlx::query("DELETE FROM books WHERE id = ?")
        .bind(&book_id)
        .execute(&*pool)
        .await?;

    Ok(Json(serde_json::json!({ "deleted": true })))
}

// Parse response types
#[derive(Serialize)]
struct ParseResponse {
    status: String,
    chunks_created: usize,
    total_pages: i32,
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
            let examples: Vec<String> = serde_json::from_str(&examples).unwrap_or_default();
            let source_chunk_ids: Vec<String> = serde_json::from_str(&source_chunk_ids).unwrap_or_default();
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
            let examples: Vec<String> = serde_json::from_str(&examples).unwrap_or_default();
            let source_chunk_ids: Vec<String> = serde_json::from_str(&source_chunk_ids).unwrap_or_default();
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
    let row: (String, Option<String>, String, Option<String>, String, String, String, Option<String>, Option<i32>) = sqlx::query_as(
        "SELECT id, book_id, name, description, examples, source_chunk_ids, language, category, page_number FROM nodes WHERE id = ?"
    )
    .bind(&node_id)
    .fetch_one(&*pool)
    .await
    .map_err(|_| AppError::NotFound("Node not found".to_string()))?;

    let examples: Vec<String> = serde_json::from_str(&row.4).unwrap_or_default();
    let source_chunk_ids: Vec<String> = serde_json::from_str(&row.5).unwrap_or_default();

    Ok(Json(NodeDetails {
        id: row.0,
        book_id: row.1,
        name: row.2,
        description: row.3.unwrap_or_default(),
        examples,
        source_chunk_ids,
        language: row.6,
        category: row.7,
        page_number: row.8,
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
            let examples: Vec<String> = serde_json::from_str(&examples).unwrap_or_default();
            let source_chunk_ids: Vec<String> = serde_json::from_str(&source_chunk_ids).unwrap_or_default();
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

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/settings/language", get(get_language))
        .route("/api/settings/language", put(put_language))
        .route("/api/books/upload", post(upload_book))
        .route("/api/books", get(list_books))
        .route("/api/books/{id}", get(get_book))
        .route("/api/books/{id}/file", get(get_book_file))
        .route("/api/books/{id}", delete(delete_book))
        .route("/api/books/{id}/parse", post(parse_book))
        .route("/api/books/{id}/chunks", get(get_book_chunks))
        .route("/api/chunks/{id}", get(get_chunk))
        .route("/api/books/{id}/graph", get(get_book_graph))
        .route("/api/graph/global", get(get_global_graph))
        .route("/api/nodes/{id}", get(get_node))
        .route("/api/books/{id}/extract", post(extract_book))
        .route("/api/books/{id}/core-concepts", get(get_core_concepts))
        .route("/api/books/{id}/identify-core-concepts", post(identify_core_concepts))
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