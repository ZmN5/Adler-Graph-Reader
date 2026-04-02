use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
use std::path::Path;
use std::str::FromStr;

pub async fn create_pool(database_url: &str) -> Result<SqlitePool, sqlx::Error> {
    let options = sqlx::sqlite::SqliteConnectOptions::from_str(database_url)?
        .create_if_missing(true);
    SqlitePoolOptions::new()
        .connect_with(options)
        .await
}

pub async fn init_database(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    // Create books table (with all current columns for new databases)
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS books (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            author TEXT,
            file_path TEXT NOT NULL,
            format TEXT NOT NULL CHECK(format IN ('pdf', 'epub')),
            total_pages INTEGER,
            language TEXT NOT NULL DEFAULT 'auto',
            created_at TEXT NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await?;

    // Migration: Add language column to existing books table (for backward compatibility)
    // SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we check pragma_table_info first
    let language_exists: bool = sqlx::query_scalar(
        "SELECT COUNT(*) > 0 FROM pragma_table_info('books') WHERE name = 'language'"
    )
    .fetch_one(pool)
    .await?;

    if !language_exists {
        sqlx::query("ALTER TABLE books ADD COLUMN language TEXT NOT NULL DEFAULT 'auto'")
            .execute(pool)
            .await?;
    }

    // Create chunks table (with all current columns for new databases)
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS chunks (
            id TEXT PRIMARY KEY,
            book_id TEXT NOT NULL,
            page_start INTEGER NOT NULL,
            page_end INTEGER NOT NULL,
            content TEXT NOT NULL,
            chapter_href TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
        )
        "#,
    )
    .execute(pool)
    .await?;

    // Migration: Add chapter_href column to existing chunks table (for backward compatibility)
    // SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we check pragma_table_info first
    let chapter_href_exists: bool = sqlx::query_scalar(
        "SELECT COUNT(*) > 0 FROM pragma_table_info('chunks') WHERE name = 'chapter_href'"
    )
    .fetch_one(pool)
    .await?;

    if !chapter_href_exists {
        sqlx::query("ALTER TABLE chunks ADD COLUMN chapter_href TEXT")
            .execute(pool)
            .await?;
    }

    // Create nodes table (with all current columns for new databases)
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS nodes (
            id TEXT PRIMARY KEY,
            book_id TEXT,
            name TEXT NOT NULL,
            description TEXT,
            examples TEXT NOT NULL DEFAULT '[]',
            source_chunk_ids TEXT NOT NULL DEFAULT '[]',
            language TEXT NOT NULL DEFAULT 'zh',
            category TEXT,
            is_core BOOLEAN NOT NULL DEFAULT FALSE,
            page_number INTEGER,
            created_at TEXT NOT NULL,
            FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
        )
        "#,
    )
    .execute(pool)
    .await?;

    // Migration: Add is_core column to existing nodes table (for backward compatibility)
    let is_core_exists: bool = sqlx::query_scalar(
        "SELECT COUNT(*) > 0 FROM pragma_table_info('nodes') WHERE name = 'is_core'"
    )
    .fetch_one(pool)
    .await?;

    if !is_core_exists {
        sqlx::query("ALTER TABLE nodes ADD COLUMN is_core BOOLEAN NOT NULL DEFAULT FALSE")
            .execute(pool)
            .await?;
    }

    // Migration: Add page_number column to existing nodes table (for backward compatibility)
    let page_number_exists: bool = sqlx::query_scalar(
        "SELECT COUNT(*) > 0 FROM pragma_table_info('nodes') WHERE name = 'page_number'"
    )
    .fetch_one(pool)
    .await?;

    if !page_number_exists {
        sqlx::query("ALTER TABLE nodes ADD COLUMN page_number INTEGER")
            .execute(pool)
            .await?;
    }

    // Create edges table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS edges (
            id TEXT PRIMARY KEY,
            source_node_id TEXT NOT NULL,
            target_node_id TEXT NOT NULL,
            relation_type TEXT NOT NULL,
            source_chunk_ids TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            FOREIGN KEY (source_node_id) REFERENCES nodes(id) ON DELETE CASCADE,
            FOREIGN KEY (target_node_id) REFERENCES nodes(id) ON DELETE CASCADE
        )
        "#,
    )
    .execute(pool)
    .await?;

    // Create settings table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        "#,
    )
    .execute(pool)
    .await?;

    // Insert default language setting if not exists
    sqlx::query(
        r#"
        INSERT OR IGNORE INTO settings (key, value, updated_at)
        VALUES ('language', 'zh', datetime('now'))
        "#,
    )
    .execute(pool)
    .await?;

    // Migration: Add paragraph_start column to existing chunks table
    let paragraph_start_exists: bool = sqlx::query_scalar(
        "SELECT COUNT(*) > 0 FROM pragma_table_info('chunks') WHERE name = 'paragraph_start'"
    )
    .fetch_one(pool)
    .await?;

    if !paragraph_start_exists {
        sqlx::query("ALTER TABLE chunks ADD COLUMN paragraph_start INTEGER")
            .execute(pool)
            .await?;
    }

    // Migration: Add paragraph_end column to existing chunks table
    let paragraph_end_exists: bool = sqlx::query_scalar(
        "SELECT COUNT(*) > 0 FROM pragma_table_info('chunks') WHERE name = 'paragraph_end'"
    )
    .fetch_one(pool)
    .await?;

    if !paragraph_end_exists {
        sqlx::query("ALTER TABLE chunks ADD COLUMN paragraph_end INTEGER")
            .execute(pool)
            .await?;
    }

    // Create chunk_embeddings table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS chunk_embeddings (
            chunk_id TEXT PRIMARY KEY,
            embedding BLOB NOT NULL,
            model_name TEXT NOT NULL,
            dimensions INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
        )
        "#,
    )
    .execute(pool)
    .await?;

    // Create FTS5 virtual table for full-text search
    // Note: We use content column to store chunk_id instead of content_rowid
    // because chunks.id is TEXT (UUID) but FTS rowid must be INTEGER
    sqlx::query(
        r#"
        CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
            chunk_id,
            content,
            tokenize='porter'
        )
        "#,
    )
    .execute(pool)
    .await?;

    // Create node_chunk_ranks table for storing node-chunk relevance scores
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS node_chunk_ranks (
            id TEXT PRIMARY KEY,
            node_id TEXT NOT NULL,
            chunk_id TEXT NOT NULL,
            vector_score REAL,
            bm25_score REAL,
            final_score REAL NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE,
            FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE,
            UNIQUE(node_id, chunk_id)
        )
        "#,
    )
    .execute(pool)
    .await?;

    Ok(())
}

pub fn ensure_data_dir(data_dir: &Path) -> std::io::Result<()> {
    if !data_dir.exists() {
        std::fs::create_dir_all(data_dir)?;
    }
    Ok(())
}
