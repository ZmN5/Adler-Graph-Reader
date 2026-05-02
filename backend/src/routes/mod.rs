use axum::{
    Router,
    http::StatusCode,
    response::IntoResponse,
    Json,
    extract::DefaultBodyLimit,
    routing::{get, put, post, delete},
};
use sqlx::SqlitePool;
use serde::Serialize;
use tower::ServiceBuilder;
use tower_http::cors::CorsLayer;

mod settings;
mod books;
mod graph;
mod retrieval;
mod chat;

#[derive(Serialize)]
pub struct ErrorResponse {
    pub error: String,
}

// Custom error type for handlers
pub enum AppError {
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

impl From<crate::extractor::ExtractorError> for AppError {
    fn from(e: crate::extractor::ExtractorError) -> Self {
        AppError::Internal(e.to_string())
    }
}

impl From<crate::epub_parser::EpubParseError> for AppError {
    fn from(e: crate::epub_parser::EpubParseError) -> Self {
        AppError::Internal(e.to_string())
    }
}

impl From<crate::pdf_parser::PdfParseError> for AppError {
    fn from(e: crate::pdf_parser::PdfParseError) -> Self {
        AppError::Internal(e.to_string())
    }
}

impl From<crate::core_concept::CoreConceptError> for AppError {
    fn from(e: crate::core_concept::CoreConceptError) -> Self {
        AppError::Internal(e.to_string())
    }
}

pub fn create_router(pool: SqlitePool) -> Router {
    // CORS: restrict to known frontend origins
    let allowed_origins: Vec<String> = std::env::var("FRONTEND_URL")
        .map(|s| s.split(',').map(|o| o.trim().to_string()).collect())
        .unwrap_or_else(|_| vec!["http://localhost:5173".to_string()]);

    let origins: Vec<axum::http::HeaderValue> = allowed_origins
        .iter()
        .filter_map(|o| o.parse().ok())
        .collect();

    let cors = CorsLayer::new()
        .allow_origin(origins)
        .allow_methods([
            axum::http::Method::GET,
            axum::http::Method::POST,
            axum::http::Method::PUT,
            axum::http::Method::DELETE,
        ])
        .allow_headers([
            axum::http::header::CONTENT_TYPE,
            axum::http::header::ACCEPT,
            axum::http::header::AUTHORIZATION,
        ]);

    Router::new()
        .route("/api/health", get(settings::health))
        .route("/api/settings/language", get(settings::get_language))
        .route("/api/settings/language", put(settings::put_language))
        .route("/api/settings/model-config", get(settings::get_model_config))
        .route("/api/settings/model-config", put(settings::put_model_config))
        .route("/api/books/upload", post(books::upload_book))
        .route("/api/books", get(books::list_books))
        .route("/api/books/{id}", get(books::get_book))
        .route("/api/books/{id}/file", get(books::get_book_file))
        .route("/api/books/{id}", delete(books::delete_book))
        .route("/api/books/{id}/parse", post(books::parse_book))
        .route("/api/books/{id}/rebuild-indexes", post(books::rebuild_indexes))
        .route("/api/books/{id}/chunks", get(books::get_book_chunks))
        .route("/api/chunks/{id}", get(books::get_chunk))
        .route("/api/books/{id}/graph", get(graph::get_book_graph))
        .route("/api/graph/global", get(graph::get_global_graph))
        .route("/api/nodes/{id}", get(graph::get_node))
        .route("/api/nodes/{id}/retrieval", get(retrieval::node_retrieval))
        .route("/api/nodes/{id}/summary", get(retrieval::node_summary))
        .route("/api/nodes/{id}/summary/stream", get(retrieval::node_summary_stream))
        .route("/api/books/{id}/extract", post(graph::extract_book))
        .route("/api/books/{id}/core-concepts", get(graph::get_core_concepts))
        .route("/api/books/{id}/identify-core-concepts", post(graph::identify_core_concepts))
        .route("/api/books/{id}/conversations", post(chat::create_conversation))
        .route("/api/books/{id}/conversations", get(chat::list_conversations))
        .route("/api/conversations/{id}", get(chat::get_conversation))
        .route("/api/conversations/{id}", delete(chat::delete_conversation))
        .route("/api/conversations/{id}/messages/stream", post(chat::send_message_stream))
        .layer(
            ServiceBuilder::new()
                .layer(cors)
                .layer(DefaultBodyLimit::max(100 * 1024 * 1024)) // 100MB limit for file uploads
        )
        .with_state(pool)
}
