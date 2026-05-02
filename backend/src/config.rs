use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;

/// Model configuration values
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelConfig {
    pub embedding_model: String,
    pub embedding_url: String,
    pub llm_model: String,
    pub llm_api_url: String,
    pub reranker_model: String,
    pub api_key: String,
}

/// Get a single config value from the database, with fallback to default
pub async fn get_config_value(
    pool: &SqlitePool,
    key: &str,
    default: &str,
) -> Result<String, sqlx::Error> {
    let value: Option<String> = sqlx::query_scalar(
        "SELECT value FROM model_config WHERE key = ?"
    )
    .bind(key)
    .fetch_optional(pool)
    .await?;

    Ok(value.unwrap_or_else(|| default.to_string()))
}

/// Get all model configuration from the database
pub async fn get_model_config(pool: &SqlitePool) -> Result<ModelConfig, sqlx::Error> {
    let embedding_model = get_config_value(pool, "embedding_model", "text-embedding-qwen3-embedding-0.6b").await?;
    let embedding_url = get_config_value(pool, "embedding_url", "http://localhost:1234/v1/embeddings").await?;
    let llm_model = get_config_value(pool, "llm_model", "qwen3.5-9b").await?;
    let llm_api_url = get_config_value(pool, "llm_api_url", "http://localhost:1234/v1").await?;
    let reranker_model = get_config_value(pool, "reranker_model", "qwen3.5-9b").await?;
    let api_key = get_config_value(pool, "api_key", "lm-studio").await?;

    Ok(ModelConfig {
        embedding_model,
        embedding_url,
        llm_model,
        llm_api_url,
        reranker_model,
        api_key,
    })
}

/// Update a single config value in the database
pub async fn update_config_value(
    pool: &SqlitePool,
    key: &str,
    value: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "UPDATE model_config SET value = ?, updated_at = datetime('now') WHERE key = ?"
    )
    .bind(value)
    .bind(key)
    .execute(pool)
    .await?;

    Ok(())
}
