use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::config;
use crate::llm_client::{ChatMessage, LlmClient, SummaryStreamItem};
use crate::retrieval::HybridRetriever;

// ─── Types ───────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Conversation {
    pub id: String,
    pub book_id: String,
    pub title: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Message {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
    pub citations: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateConversationRequest {
    pub title: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SendMessageRequest {
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct ConversationWithMessages {
    #[serde(flatten)]
    pub conversation: Conversation,
    pub messages: Vec<Message>,
}

// ─── DB Operations ───────────────────────────────────────────────────────────

pub async fn create_conversation(
    pool: &SqlitePool,
    book_id: &str,
    title: Option<&str>,
) -> Result<Conversation, sqlx::Error> {
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let title = title.unwrap_or("新对话");

    sqlx::query_as::
        <_, Conversation>(
            "INSERT INTO conversations (id, book_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?) RETURNING *"
        )
        .bind(&id)
        .bind(book_id)
        .bind(title)
        .bind(&now)
        .bind(&now)
        .fetch_one(pool)
        .await
}

pub async fn list_conversations(
    pool: &SqlitePool,
    book_id: &str,
) -> Result<Vec<Conversation>, sqlx::Error> {
    sqlx::query_as::
        <_, Conversation>(
            "SELECT * FROM conversations WHERE book_id = ? ORDER BY updated_at DESC"
        )
        .bind(book_id)
        .fetch_all(pool)
        .await
}

pub async fn get_conversation(
    pool: &SqlitePool,
    conversation_id: &str,
) -> Result<ConversationWithMessages, sqlx::Error> {
    let conversation: Conversation = sqlx::query_as(
        "SELECT * FROM conversations WHERE id = ?"
    )
    .bind(conversation_id)
    .fetch_one(pool)
    .await?;

    let messages: Vec<Message> = sqlx::query_as(
        "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC"
    )
    .bind(conversation_id)
    .fetch_all(pool)
    .await?;

    Ok(ConversationWithMessages {
        conversation,
        messages,
    })
}

pub async fn delete_conversation(
    pool: &SqlitePool,
    conversation_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query("DELETE FROM conversations WHERE id = ?")
        .bind(conversation_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn save_message(
    pool: &SqlitePool,
    conversation_id: &str,
    role: &str,
    content: &str,
    citations: Option<String>,
) -> Result<Message, sqlx::Error> {
    let id = Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();

    let message: Message = sqlx::query_as(
        "INSERT INTO messages (id, conversation_id, role, content, citations, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *"
    )
    .bind(&id)
    .bind(conversation_id)
    .bind(role)
    .bind(content)
    .bind(citations)
    .bind(&now)
    .fetch_one(pool)
    .await?;

    // Update conversation updated_at
    sqlx::query("UPDATE conversations SET updated_at = ? WHERE id = ?")
        .bind(&now)
        .bind(conversation_id)
        .execute(pool)
        .await?;

    Ok(message)
}

// ─── RAG + Streaming ─────────────────────────────────────────────────────────

/// Build system prompt for chat
fn build_chat_system_prompt() -> String {
    r#"You are an expert research assistant helping a user understand a book they are reading.

Instructions:
1. Answer the user's questions based on the provided source materials.
2. When you use information from a specific source, cite it using [Source: X] format where X is the source number.
3. Include at least one citation per major point or claim.
4. Be concise but comprehensive.
5. If the sources don't contain enough information to answer the question, say so honestly.
6. Output ONLY plain text, no JSON, no markdown code blocks.
7. Use the same language as the user's question.

Example output:
Key-Value Cache is a foundational technique for efficient LLM inference [Source: 1]. It stores key-value pairs derived from previous tokens, allowing the model to avoid redundant calculations when generating new tokens [Source: 2]. However, this approach introduces a significant memory cost [Source: 3].
"#.to_string()
}

/// Build user message with retrieved sources
fn build_chat_user_message(content: &str, retrieval_outputs: &[crate::retrieval::RetrievalOutput]) -> String {
    let mut msg = format!("Question: {}\n\n", content);

    if !retrieval_outputs.is_empty() {
        msg.push_str("---\nRETRIEVED SOURCE MATERIALS:\n\n");
        for (idx, result) in retrieval_outputs.iter().enumerate() {
            let page_info = if result.page_start == result.page_end {
                format!("Page {}", result.page_start)
            } else {
                format!("Pages {}-{}", result.page_start, result.page_end)
            };
            // Truncate content (char-safe for multi-byte UTF-8)
            let truncated = if result.content.chars().count() > 1500 {
                format!("{}...[content truncated]", result.content.chars().take(1500).collect::<String>())
            } else {
                result.content.clone()
            };
            msg.push_str(&format!(
                "[Source {}] ({}):\n{}\n\n",
                idx + 1,
                page_info,
                truncated
            ));
        }
        msg.push_str("---\n\n");
    }

    msg.push_str("Please answer the question using the source materials above.");
    msg
}

/// Parse citations from the assistant response
pub fn parse_citations_from_response(
    response: &str,
    retrieval_outputs: &[crate::retrieval::RetrievalOutput],
) -> Vec<crate::llm_client::Citation> {
    use regex::Regex;

    let citation_pattern = Regex::new(r"\[Source:\s*(\d+)\]").unwrap();
    let mut seen_indices = std::collections::HashSet::new();
    let mut citations = Vec::new();

    for caps in citation_pattern.captures_iter(response) {
        if let Ok(idx) = caps[1].parse::<usize>() {
            if idx > 0 && idx <= retrieval_outputs.len() && seen_indices.insert(idx) {
                let result = &retrieval_outputs[idx - 1];
                let excerpt = result.content.chars().take(200).collect::<String>();
                citations.push(crate::llm_client::Citation {
                    index: idx,
                    chunk_id: result.chunk_id.clone(),
                    page_start: result.page_start,
                    page_end: result.page_end,
                    excerpt,
                });
            }
        }
    }

    citations.sort_by_key(|c| c.index);
    citations
}

/// Perform RAG retrieval for a chat query
pub async fn retrieve_for_chat(
    pool: &SqlitePool,
    book_id: &str,
    query: &str,
) -> Result<Vec<crate::retrieval::RetrievalOutput>, String> {
    let model_config = config::get_model_config(pool)
        .await
        .map_err(|e| format!("Failed to get model config: {}", e))?;

    let retriever = HybridRetriever::new(
        pool.clone(),
        model_config.llm_api_url,
        model_config.embedding_model,
        model_config.embedding_url,
    );

    let results = retriever
        .retrieve_for_query(query, Some(book_id), Some(5))
        .await
        .map_err(|e| format!("Retrieval failed: {}", e))?;

    Ok(results)
}

/// Build LLM messages for chat: system + history + current user message with sources
pub fn build_chat_messages(
    history: &[Message],
    user_content: &str,
    retrieval_outputs: &[crate::retrieval::RetrievalOutput],
) -> Vec<ChatMessage> {
    let mut messages = vec![ChatMessage::new("system", &build_chat_system_prompt())];

    // Add history (skip system messages if any in DB)
    for msg in history {
        if msg.role == "system" {
            continue;
        }
        messages.push(ChatMessage::new(
            &msg.role,
            &msg.content,
        ));
    }

    // Add current user message with retrieved sources
    let user_msg = build_chat_user_message(user_content, retrieval_outputs);
    messages.push(ChatMessage::new("user", &user_msg));

    messages
}

/// Stream chat response with RAG
/// This returns a stream of SSE events
pub async fn stream_chat_response(
    pool: SqlitePool,
    conversation_id: String,
    user_content: String,
) -> impl futures::Stream<Item = Result<axum::response::sse::Event, std::convert::Infallible>> {
    use axum::response::sse::Event;
    use futures::StreamExt;

    let stream = async_stream::stream! {
        // 1. Load conversation to get book_id
        let conversation: Result<Conversation, _> = sqlx::query_as(
            "SELECT * FROM conversations WHERE id = ?"
        )
        .bind(&conversation_id)
        .fetch_one(&pool)
        .await;

        let conversation = match conversation {
            Ok(c) => c,
            Err(e) => {
                yield Ok(Event::default().data(
                    serde_json::json!({"type": "error", "message": format!("Conversation not found: {}", e)}).to_string()
                ));
                yield Ok(Event::default().data(r#"{"type":"done"}"#));
                return;
            }
        };

        // 2. Save user message
        if let Err(e) = save_message(
            &pool,
            &conversation_id,
            "user",
            &user_content,
            None,
        ).await {
            tracing::error!("[Chat] Failed to save user message: {}", e);
        }

        // 3. Load conversation history
        let history: Vec<Message> = sqlx::query_as(
            "SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC"
        )
        .bind(&conversation_id)
        .fetch_all(&pool)
        .await
        .unwrap_or_default();

        // 4. Perform RAG retrieval
        let retrieval_outputs = match retrieve_for_chat(
            &pool,
            &conversation.book_id,
            &user_content,
        ).await {
            Ok(outputs) => outputs,
            Err(e) => {
                tracing::warn!("[Chat] Retrieval failed: {}", e);
                Vec::new()
            }
        };

        tracing::info!(
            "[Chat] Retrieved {} chunks for query '{}'",
            retrieval_outputs.len(),
            user_content.chars().take(50).collect::<String>()
        );

        // 5. Build LLM messages
        let messages = build_chat_messages(&history, &user_content, &retrieval_outputs);

        // 6. Stream LLM response
        let model_config = match config::get_model_config(&pool).await {
            Ok(c) => c,
            Err(e) => {
                yield Ok(Event::default().data(
                    serde_json::json!({"type": "error", "message": format!("Model config error: {}", e)}).to_string()
                ));
                yield Ok(Event::default().data(r#"{"type":"done"}"#));
                return;
            }
        };

        let llm_client = LlmClient::new(&model_config.llm_api_url,
            &model_config.llm_model,
        );

        let mut full_text = String::new();
        let mut token_stream = llm_client.into_chat_stream(messages);

        while let Some(token_result) = token_stream.next().await {
            match token_result {
                Ok(SummaryStreamItem::Text(text)) => {
                    full_text.push_str(&text);
                    let text_chunk = serde_json::json!({"type": "content", "text": text});
                    yield Ok(Event::default().data(text_chunk.to_string()));
                }
                Ok(SummaryStreamItem::Done) => {
                    yield Ok(Event::default().data(r#"{"type":"done"}"#));
                }
                Err(e) => {
                    let error_chunk = serde_json::json!({
                        "type": "error",
                        "message": e.to_string()
                    });
                    yield Ok(Event::default().data(error_chunk.to_string()));
                    yield Ok(Event::default().data(r#"{"type":"done"}"#));
                    tracing::error!("[Chat] Stream error: {}", e);
                    return;
                }
            }
        }

        // 7. Parse citations
        let citations = parse_citations_from_response(&full_text, &retrieval_outputs
        );

        tracing::info!(
            "[Chat] Response completed, {} chars, {} citations",
            full_text.len(),
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
            yield Ok(Event::default().data(citation_chunk.to_string()));
        }

        // Send final done
        yield Ok(Event::default().data(r#"{"type":"done"}"#));

        // 8. Save assistant message
        let citations_json = if !retrieval_outputs.is_empty() {
            let simple_citations: Vec<serde_json::Value> = retrieval_outputs.iter().enumerate().map(|(idx, r)| {
                serde_json::json!({
                    "index": idx + 1,
                    "chunk_id": r.chunk_id,
                    "page_start": r.page_start,
                    "page_end": r.page_end,
                    "excerpt": r.content.chars().take(200).collect::<String>()
                })
            }).collect();
            Some(serde_json::to_string(&simple_citations).unwrap_or_default())
        } else {
            None
        };

        if let Err(e) = save_message(
            &pool,
            &conversation_id,
            "assistant",
            &full_text,
            citations_json,
        ).await {
            tracing::error!("[Chat] Failed to save assistant message: {}", e);
        }
    };

    stream
}
