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
    // Create books table
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
    sqlx::query("ALTER TABLE books ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'auto'")
        .execute(pool)
        .await
        .ok(); // Ignore error if column already exists

    // Create chunks table
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS chunks (
            id TEXT PRIMARY KEY,
            book_id TEXT NOT NULL,
            page_start INTEGER NOT NULL,
            page_end INTEGER NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
        )
        "#,
    )
    .execute(pool)
    .await?;

    // Migration: Add chapter_href column to chunks table (for EPUB navigation)
    sqlx::query("ALTER TABLE chunks ADD COLUMN IF NOT EXISTS chapter_href TEXT")
        .execute(pool)
        .await
        .ok(); // Ignore error if column already exists

    // Create nodes table
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

    // Migration: Add is_core and page_number columns to existing nodes table
    sqlx::query("ALTER TABLE nodes ADD COLUMN IF NOT EXISTS is_core BOOLEAN NOT NULL DEFAULT FALSE")
        .execute(pool)
        .await
        .ok();
    sqlx::query("ALTER TABLE nodes ADD COLUMN IF NOT EXISTS page_number INTEGER")
        .execute(pool)
        .await
        .ok();

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

    Ok(())
}

pub fn ensure_data_dir(data_dir: &Path) -> std::io::Result<()> {
    if !data_dir.exists() {
        std::fs::create_dir_all(data_dir)?;
    }
    Ok(())
}
