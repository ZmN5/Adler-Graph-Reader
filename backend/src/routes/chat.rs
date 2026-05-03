use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
    response::sse::{Sse, KeepAlive},
    response::IntoResponse,
};
use sqlx::SqlitePool;

use super::{AppError};

pub async fn create_conversation(
    Path(book_id): Path<String>,
    pool: State<SqlitePool>,
    Json(req): Json<crate::chat::CreateConversationRequest>,
) -> Result<(StatusCode, Json<crate::chat::Conversation>), AppError> {
    let title = req.title.as_deref();
    let conversation = crate::chat::create_conversation(&pool, &book_id, title)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to create conversation: {}", e)))?;
    Ok((StatusCode::CREATED, Json(conversation)))
}

pub async fn list_conversations(
    Path(book_id): Path<String>,
    pool: State<SqlitePool>,
) -> Result<Json<Vec<crate::chat::Conversation>>, AppError> {
    let conversations = crate::chat::list_conversations(&pool, &book_id)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to list conversations: {}", e)))?;
    Ok(Json(conversations))
}

pub async fn get_conversation(
    Path(conversation_id): Path<String>,
    pool: State<SqlitePool>,
) -> Result<Json<crate::chat::ConversationWithMessages>, AppError> {
    let conversation = crate::chat::get_conversation(&pool, &conversation_id)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to get conversation: {}", e)))?;
    Ok(Json(conversation))
}

pub async fn delete_conversation(
    Path(conversation_id): Path<String>,
    pool: State<SqlitePool>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::chat::delete_conversation(&pool, &conversation_id)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to delete conversation: {}", e)))?;
    Ok(Json(serde_json::json!({ "deleted": true })))
}

pub async fn send_message_stream(
    Path(conversation_id): Path<String>,
    pool: State<SqlitePool>,
    Json(req): Json<crate::chat::SendMessageRequest>,
) -> Result<impl IntoResponse, AppError> {
    tracing::info!(
        "[API] Chat stream request: conversation_id={}, content_len={}",
        conversation_id,
        req.content.len()
    );

    let stream = crate::chat::stream_chat_response(pool.0, conversation_id, req.content, req.node_id).await;

    Ok(Sse::new(stream)
        .keep_alive(KeepAlive::default())
        .into_response())
}
