use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::collections::HashSet;
use uuid::Uuid;

use crate::config;
use crate::llm_client::{ChatMessage, LlmClient, SummaryStreamItem};
use crate::retrieval::{HybridRetriever, reciprocal_rank_fusion_multi};

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
    #[serde(default)]
    pub node_id: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ConversationWithMessages {
    #[serde(flatten)]
    pub conversation: Conversation,
    pub messages: Vec<Message>,
}

#[derive(Debug, Clone)]
pub struct ChatNodeContext {
    pub name: String,
    pub native_term: Option<String>,
    pub description: Option<String>,
    pub examples: Vec<String>,
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

/// Build user message with retrieved sources and optional node context
fn build_chat_user_message(
    content: &str,
    retrieval_outputs: &[crate::retrieval::RetrievalOutput],
    node_context: Option<&ChatNodeContext>,
) -> String {
    let mut msg = String::new();

    // Prepend node metadata when available
    if let Some(nc) = node_context {
        let native_info = match &nc.native_term {
            Some(nt) if nt != &nc.name => format!(" (source term: \"{}\")", nt),
            _ => String::new(),
        };
        msg.push_str(&format!(
            "The user is asking about the concept \"{}\"{} from the book.\n",
            nc.name, native_info
        ));
        if let Some(ref desc) = nc.description {
            msg.push_str(&format!("Concept description: {}\n", desc));
        }
        if !nc.examples.is_empty() {
            msg.push_str("Examples: ");
            for (i, example) in nc.examples.iter().enumerate() {
                if i > 0 {
                    msg.push_str("; ");
                }
                msg.push_str(example);
            }
            msg.push_str("\n");
        }
        msg.push('\n');
    }

    msg.push_str(&format!("Question: {}\n\n", content));

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
    let mut seen_indices = std::collections::HashSet::new();
    let mut citations = Vec::new();

    for caps in crate::utils::CITATION_REGEX.captures_iter(response) {
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

/// Errors that can occur during chat operations
#[derive(Debug)]
pub enum ChatError {
    ConfigError(String),
    RetrievalError(String),
}

impl std::fmt::Display for ChatError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ChatError::ConfigError(msg) => write!(f, "Config error: {}", msg),
            ChatError::RetrievalError(msg) => write!(f, "Retrieval error: {}", msg),
        }
    }
}

impl std::error::Error for ChatError {}

/// Perform RAG retrieval for a chat query
pub async fn retrieve_for_chat(
    pool: &SqlitePool,
    book_id: &str,
    query: &str,
) -> Result<Vec<crate::retrieval::RetrievalOutput>, ChatError> {
    let model_config = config::get_model_config(pool)
        .await
        .map_err(|e| ChatError::ConfigError(e.to_string()))?;

    let retriever = HybridRetriever::new(
        pool.clone(),
        model_config.llm_api_url,
        model_config.embedding_model,
        model_config.embedding_url,
        model_config.api_key,
    );

    let results = retriever
        .retrieve_for_query(query, Some(book_id), Some(5))
        .await
        .map_err(|e| ChatError::RetrievalError(e.to_string()))?;

    Ok(results)
}

// ─── Node-Aware Retrieval Helpers ──────────────────────────────────────────────

/// Load chunk contents by chunk IDs directly from the database.
/// These are authoritative source chunks (from node.source_chunk_ids).
async fn load_chunks_by_ids(
    pool: &SqlitePool,
    chunk_ids: &[String],
) -> Result<Vec<crate::retrieval::RetrievalOutput>, ChatError> {
    if chunk_ids.is_empty() {
        return Ok(Vec::new());
    }

    let placeholders: Vec<String> = chunk_ids.iter().map(|_| "?".to_string()).collect();
    let in_clause = placeholders.join(",");
    let query_str = format!(
        "SELECT id, content, page_start, page_end FROM chunks WHERE id IN ({})",
        in_clause
    );

    let mut query = sqlx::query_as::<_, (String, String, i64, i64)>(&query_str);
    for id in chunk_ids {
        query = query.bind(id);
    }

    let rows = query
        .fetch_all(pool)
        .await
        .map_err(|e| ChatError::RetrievalError(format!("Failed to load source chunks: {}", e)))?;

    let outputs: Vec<crate::retrieval::RetrievalOutput> = rows
        .into_iter()
        .map(|(chunk_id, content, page_start, page_end)| {
            crate::retrieval::RetrievalOutput {
                chunk_id,
                content,
                page_start,
                page_end,
                vector_score: None,
                bm25_score: None,
                final_score: 1.0,
            }
        })
        .collect();

    Ok(outputs)
}

/// Fetch node metadata and source chunks from the database.
async fn fetch_node_context(
    pool: &SqlitePool,
    node_id: &str,
) -> Result<Option<(ChatNodeContext, Vec<crate::retrieval::RetrievalOutput>)>, ChatError> {
    let node_row: Option<(String, Option<String>, Option<String>, String, String, String)> =
        sqlx::query_as(
            "SELECT name, native_term, description, examples, language, source_chunk_ids FROM nodes WHERE id = ?"
        )
        .bind(node_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| ChatError::RetrievalError(format!("Failed to fetch node: {}", e)))?;

    let (name, native_term, description, examples_json, _language, source_chunk_ids_json) =
        match node_row {
            Some(row) => row,
            None => return Ok(None),
        };

    let examples: Vec<String> = serde_json::from_str(&examples_json).unwrap_or_default();
    let source_chunk_ids: Vec<String> =
        serde_json::from_str(&source_chunk_ids_json).unwrap_or_default();

    let source_chunks = load_chunks_by_ids(pool, &source_chunk_ids).await?;

    let node_context = ChatNodeContext {
        name,
        native_term,
        description,
        examples,
    };

    Ok(Some((node_context, source_chunks)))
}

/// Generate a HyDE (Hypothetical Document Embeddings) passage.
/// Creates a short hypothetical passage about the concept in the source language,
/// which serves as a richer query for vector search against document chunks.
async fn generate_hyde_passage(
    pool: &SqlitePool,
    node_context: &ChatNodeContext,
    user_question: &str,
    book_language: &str,
) -> Result<String, ChatError> {
    let model_config = config::get_model_config(pool)
        .await
        .map_err(|e| ChatError::ConfigError(e.to_string()))?;

    let llm_client = LlmClient::new(
        &model_config.llm_api_url,
        &model_config.llm_model,
        &model_config.api_key,
    )
    .map_err(|e| ChatError::ConfigError(format!("Failed to create LLM client: {}", e)))?;

    let lang_name = match book_language {
        "zh" => "Chinese",
        _ => "English",
    };

    let native_info = match &node_context.native_term {
        Some(nt) if *nt != node_context.name => format!(" (also known as \"{}\")", nt),
        _ => String::new(),
    };

    let desc = node_context
        .description
        .as_deref()
        .unwrap_or("No description available.");

    let examples_str = if node_context.examples.is_empty() {
        "No examples available.".to_string()
    } else {
        node_context.examples.join("\n")
    };

    let prompt = format!(
        "You are helping with document retrieval. Write a short informative passage \
        (2-3 paragraphs) in {lang_name} about the concept \"{name}\"{native_info}. \
        The user asked: \"{question}\"\n\n\
        Description: {desc}\n\n\
        Examples: {examples}\n\n\
        Write as if explaining this concept in a technical book. Include specific \
        terminology, key details, and context that would appear in a document \
        discussing this topic. This passage will be used for semantic search retrieval.",
        name = node_context.name,
        question = user_question,
        desc = desc,
        examples = examples_str,
    );

    let messages = vec![ChatMessage::new("user", &prompt)];

    llm_client
        .chat_completion(messages, 0.3)
        .await
        .map_err(|e| ChatError::RetrievalError(format!("HyDE generation failed: {}", e)))
}

/// Build RetrievalOutput from fused RRF results by loading chunk data from DB.
async fn build_retrieval_outputs_from_fused(
    pool: &SqlitePool,
    fused: &[crate::retrieval::FusedResult],
) -> Result<Vec<crate::retrieval::RetrievalOutput>, ChatError> {
    if fused.is_empty() {
        return Ok(Vec::new());
    }

    let chunk_ids: Vec<String> = fused.iter().map(|f| f.chunk_id.clone()).collect();
    let placeholders: Vec<String> = chunk_ids.iter().map(|_| "?".to_string()).collect();
    let in_clause = placeholders.join(",");
    let query_str = format!(
        "SELECT id, content, page_start, page_end FROM chunks WHERE id IN ({})",
        in_clause
    );

    let mut query = sqlx::query_as::<_, (String, String, i64, i64)>(&query_str);
    for id in &chunk_ids {
        query = query.bind(id);
    }

    let rows = query
        .fetch_all(pool)
        .await
        .map_err(|e| ChatError::RetrievalError(format!("Failed to load chunks: {}", e)))?;

    let chunk_data: std::collections::HashMap<String, (String, i64, i64)> = rows
        .into_iter()
        .map(|(id, content, ps, pe)| (id, (content, ps, pe)))
        .collect();

    // Maintain RRF order
    let outputs: Vec<crate::retrieval::RetrievalOutput> = fused
        .iter()
        .filter_map(|f| {
            chunk_data.get(&f.chunk_id).map(|(content, page_start, page_end)| {
                crate::retrieval::RetrievalOutput {
                    chunk_id: f.chunk_id.clone(),
                    content: content.clone(),
                    page_start: *page_start,
                    page_end: *page_end,
                    vector_score: f.vector_score,
                    bm25_score: f.bm25_score,
                    final_score: f.rrf_score,
                }
            })
        })
        .collect();

    Ok(outputs)
}

// ─── Prompt Building ──────────────────────────────────────────────────────────

/// Build LLM messages for chat: system + history + current user message with sources
pub fn build_chat_messages(
    history: &[Message],
    user_content: &str,
    retrieval_outputs: &[crate::retrieval::RetrievalOutput],
    node_context: Option<&ChatNodeContext>,
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

    // Add current user message with retrieved sources and node context
    let user_msg = build_chat_user_message(user_content, retrieval_outputs, node_context);
    messages.push(ChatMessage::new("user", &user_msg));

    messages
}

/// Stream chat response with RAG
/// This returns a stream of SSE events
pub async fn stream_chat_response(
    pool: SqlitePool,
    conversation_id: String,
    user_content: String,
    node_id: Option<String>,
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

        // 4. Perform RAG retrieval (node-aware when node_id is present)
        let (node_context, retrieval_outputs) = if let Some(ref nid) = node_id {
            // Fetch node context and source chunks (authoritative, always included)
            let (ctx, source_chunks) = match fetch_node_context(&pool, nid).await {
                Ok(Some((ctx, chunks))) => (Some(ctx), chunks),
                Ok(None) => (None, Vec::new()),
                Err(e) => {
                    tracing::warn!("[Chat] Failed to fetch node context: {}", e);
                    (None, Vec::new())
                }
            };

            // Get model config for embedding and BM25 calls
            let model_config = config::get_model_config(&pool).await.ok();

            // Get book language for cross-language HyDE generation
            let book_language: String = sqlx::query_scalar(
                "SELECT language FROM books WHERE id = ?"
            )
            .bind(&conversation.book_id)
            .fetch_optional(&pool)
            .await
            .unwrap_or_default()
            .unwrap_or_else(|| "auto".to_string());

            let source_lang = if book_language == "auto" || book_language.is_empty() {
                "en"
            } else {
                &book_language
            };

            // Collect search result lists for multi-strategy RRF fusion
            let mut all_search_lists: Vec<Vec<crate::retrieval::SearchResult>> = Vec::new();

            // Strategy A: HyDE vector search (hypothetical passage → embedding → cosine similarity)
            if let (Some(ref node_ctx), Some(ref mc)) = (ctx.as_ref(), model_config.as_ref()) {
                if let Ok(hyde_text) = generate_hyde_passage(
                    &pool,
                    node_ctx,
                    &user_content,
                    source_lang,
                ).await {
                    tracing::info!("[Chat] HyDE passage: {} chars", hyde_text.len());
                    match crate::retrieval::vector_search_with_query(
                        &pool,
                        &hyde_text,
                        Some(&conversation.book_id),
                        Some(50),
                        &mc.embedding_model,
                        &mc.embedding_url,
                        &mc.api_key,
                    ).await {
                        Ok(results) => {
                            tracing::info!("[Chat] HyDE vector: {} results", results.len());
                            all_search_lists.push(results);
                        }
                        Err(e) => tracing::warn!("[Chat] HyDE vector failed: {}", e),
                    }
                }
            }

            // Strategy B: BM25 with native_term (source-language term for cross-language matching)
            if let Some(ref node_ctx) = ctx {
                let bm25_query = node_ctx
                    .native_term
                    .as_deref()
                    .filter(|nt| !nt.is_empty())
                    .unwrap_or(&node_ctx.name);
                match crate::retrieval::bm25_search(
                    &pool,
                    bm25_query,
                    Some(&conversation.book_id),
                    Some(50),
                ).await {
                    Ok(results) => {
                        tracing::info!("[Chat] Native BM25 '{}': {} results",
                            bm25_query.chars().take(50).collect::<String>(),
                            results.len());
                        all_search_lists.push(results);
                    }
                    Err(e) => tracing::warn!("[Chat] Native BM25 failed: {}", e),
                }
            }

            // Strategy C: Vector search with original user question
            if let Some(ref mc) = model_config {
                match crate::retrieval::vector_search_with_query(
                    &pool,
                    &user_content,
                    Some(&conversation.book_id),
                    Some(50),
                    &mc.embedding_model,
                    &mc.embedding_url,
                    &mc.api_key,
                ).await {
                    Ok(results) => {
                        tracing::info!("[Chat] Question vector: {} results", results.len());
                        all_search_lists.push(results);
                    }
                    Err(e) => tracing::warn!("[Chat] Question vector failed: {}", e),
                }
            }

            // Strategy D: BM25 with user question
            match crate::retrieval::bm25_search(
                &pool,
                &user_content,
                Some(&conversation.book_id),
                Some(50),
            ).await {
                Ok(results) => {
                    tracing::info!("[Chat] Question BM25: {} results", results.len());
                    all_search_lists.push(results);
                }
                Err(e) => tracing::warn!("[Chat] Question BM25 failed: {}", e),
            }

            // RRF fuse all non-empty search result lists
            let fused_outputs = {
                let non_empty: Vec<Vec<crate::retrieval::SearchResult>> = all_search_lists
                    .into_iter()
                    .filter(|l| !l.is_empty())
                    .collect();

                if non_empty.is_empty() {
                    Vec::new()
                } else {
                    let fused = reciprocal_rank_fusion_multi(&non_empty, None);

                    // Convert FusedResult → RetrievalOutput by loading chunk data
                    build_retrieval_outputs_from_fused(&pool, &fused).await
                        .unwrap_or_default()
                }
            };

            // Merge: source chunks first (unduplicated), then fused search results
            let source_ids: HashSet<String> = source_chunks
                .iter()
                .map(|r| r.chunk_id.clone())
                .collect();
            let source_count = source_ids.len();

            let mut merged = source_chunks;
            for result in fused_outputs {
                if !source_ids.contains(&result.chunk_id) {
                    merged.push(result);
                }
            }

            let total = merged.len();
            merged.truncate(8);

            tracing::info!(
                "[Chat] Node-aware: {} source + {} fused → {} merged (from {})",
                source_count,
                total.saturating_sub(source_count),
                merged.len(),
                total
            );

            (ctx, merged)
        } else {
            // No node_id: standard retrieval
            let outputs = match retrieve_for_chat(
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
            (None, outputs)
        };

        tracing::info!(
            "[Chat] Retrieved {} chunks for query '{}'",
            retrieval_outputs.len(),
            user_content.chars().take(50).collect::<String>()
        );

        // 5. Build LLM messages
        let messages = build_chat_messages(
            &history,
            &user_content,
            &retrieval_outputs,
            node_context.as_ref(),
        );

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

        let llm_client = match LlmClient::new(&model_config.llm_api_url, &model_config.llm_model, &model_config.api_key) {
            Ok(client) => client,
            Err(e) => {
                yield Ok(Event::default().data(
                    serde_json::json!({"type": "error", "message": format!("LLM client error: {}", e)}).to_string()
                ));
                yield Ok(Event::default().data(r#"{"type":"done"}"#));
                return;
            }
        };

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
