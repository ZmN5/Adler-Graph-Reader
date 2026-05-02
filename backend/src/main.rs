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
mod rate_limit;
mod retrieval;
mod routes;
mod text_utils;
mod utils;

use std::net::SocketAddr;
use tokio::net::TcpListener;

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

    let app = routes::create_router(pool);

    let addr = SocketAddr::from(([127, 0, 0, 1], 8080));
    let listener = TcpListener::bind(addr).await?;

    tracing::info!("Server running on http://localhost:8080");

    axum::serve(listener, app).await?;

    Ok(())
}
