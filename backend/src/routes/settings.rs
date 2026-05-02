use axum::{
    Json,
    extract::State,
};
use sqlx::SqlitePool;
use serde::{Deserialize, Serialize};

use super::{AppError};

#[derive(serde::Serialize)]
pub struct HealthResponse {
    pub status: String,
}

pub async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".to_string(),
    })
}

#[derive(Serialize)]
pub struct LanguageResponse {
    pub language: String,
}

#[derive(Deserialize)]
pub struct LanguageRequest {
    pub language: String,
}

pub async fn get_language(pool: State<SqlitePool>) -> Result<Json<LanguageResponse>, AppError> {
    let row: (String,) = sqlx::query_as("SELECT value FROM settings WHERE key = 'language'")
        .fetch_one(&*pool)
        .await?;

    Ok(Json(LanguageResponse { language: row.0 }))
}

pub async fn put_language(
    pool: State<SqlitePool>,
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

pub async fn get_model_config(
    pool: State<SqlitePool>,
) -> Result<Json<ModelConfigResponse>, AppError> {
    let config = crate::config::get_model_config(&pool.0)
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

pub async fn put_model_config(
    pool: State<SqlitePool>,
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
    crate::config::update_config_value(&pool.0, &req.key, &req.value)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;

    // Return updated full config
    let config = crate::config::get_model_config(&pool.0)
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
