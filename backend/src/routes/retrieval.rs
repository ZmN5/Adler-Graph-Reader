use axum::{
    Json,
    extract::{Path, Query, State},
    response::sse::{Sse, Event as SseEvent, KeepAlive},
    response::IntoResponse,
};
use sqlx::SqlitePool;
use serde::Serialize;
use futures::StreamExt;

use crate::retrieval::HybridRetriever;
use crate::llm_client::{LlmClient, SourceGroundedSummaryRequest};

use super::{AppError};

#[derive(Serialize)]
pub struct RetrievalResponse {
    pub chunks: Vec<RetrievalResultItem>,
    pub total_found: usize,
}

#[derive(Serialize)]
pub struct RetrievalResultItem {
    pub chunk_id: String,
    pub content: String,
    pub page_start: i64,
    pub page_end: i64,
    pub vector_score: Option<f64>,
    pub bm25_score: Option<f64>,
    pub final_score: f64,
}

#[derive(Serialize)]
pub struct SummaryResponse {
    pub summary: String,
    pub citations: Vec<CitationItem>,
    pub sources: Vec<SourceItem>,
}

#[derive(Serialize)]
pub struct CitationItem {
    pub index: usize,
    pub chunk_id: String,
    pub page_start: i64,
    pub page_end: i64,
    pub excerpt: String,
}

#[derive(Serialize)]
pub struct SourceItem {
    pub index: usize,
    pub page_start: i64,
    pub page_end: i64,
    pub excerpt: String,
}

/// Handler for GET /api/nodes/{id}/retrieval
/// Returns retrieval results for a node using the hybrid retriever
pub async fn node_retrieval(
    Path(node_id): Path<String>,
    Query(params): Query<std::collections::HashMap<String, String>>,
    pool: State<SqlitePool>,
) -> Result<Json<RetrievalResponse>, AppError> {
    // Parse top_k parameter with default of 10
    let top_k = params
        .get("top_k")
        .and_then(|v| v.parse::<usize>().ok())
        .unwrap_or(10);

    tracing::info!(
        "[API] Node retrieval request: node_id={}, top_k={}",
        node_id,
        top_k
    );

    // Create hybrid retriever with config from database
    let model_config = crate::config::get_model_config(&pool.0)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let retriever = HybridRetriever::new(
        pool.0.clone(),
        model_config.llm_api_url.clone(),
        model_config.embedding_model.clone(),
        model_config.embedding_url.clone(),
        model_config.api_key.clone(),
    );

    // Run retrieval
    let results = retriever
        .retrieve_for_node(&node_id, Some(top_k))
        .await
        .map_err(|e| AppError::Internal(format!("Retrieval failed: {}", e)))?;

    let total_found = results.len();

    // Convert to response format
    let chunks: Vec<RetrievalResultItem> = results
        .into_iter()
        .map(|r| RetrievalResultItem {
            chunk_id: r.chunk_id,
            content: r.content,
            page_start: r.page_start,
            page_end: r.page_end,
            vector_score: r.vector_score,
            bm25_score: r.bm25_score,
            final_score: r.final_score,
        })
        .collect();

    tracing::info!(
        "[API] Node retrieval completed: node_id={}, found={}",
        node_id,
        total_found
    );

    Ok(Json(RetrievalResponse {
        chunks,
        total_found,
    }))
}

/// Handler for GET /api/nodes/{id}/summary
/// Returns source-grounded summary for a node
pub async fn node_summary(
    Path(node_id): Path<String>,
    pool: State<SqlitePool>,
) -> Result<Json<SummaryResponse>, AppError> {
    tracing::info!("[API] Node summary request: node_id={}", node_id);

    // Get node information from database
    let node_row: Option<(String, Option<String>, String, Option<String>)> = sqlx::query_as(
        "SELECT id, book_id, name, description FROM nodes WHERE id = ?"
    )
    .bind(&node_id)
    .fetch_optional(&*pool)
    .await
    .map_err(AppError::Sqlx)?;

    let node_info = match node_row {
        Some(row) => row,
        None => return Err(AppError::NotFound("Node not found".to_string())),
    };

    let node_name = node_info.2;
    let node_description = node_info.3;

    // Create hybrid retriever and get retrieval results
    let model_config = crate::config::get_model_config(&pool.0)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let retriever = HybridRetriever::new(
        pool.0.clone(),
        model_config.llm_api_url.clone(),
        model_config.embedding_model.clone(),
        model_config.embedding_url.clone(),
        model_config.api_key.clone(),
    );

    // Get retrieval results (top 10 for summary)
    let retrieval_outputs = retriever
        .retrieve_for_node(&node_id, Some(10))
        .await
        .map_err(|e| AppError::Internal(format!("Retrieval failed: {}", e)))?;

    if retrieval_outputs.is_empty() {
        return Ok(Json(SummaryResponse {
            summary: format!("未找到与 '{}' 相关的文档内容。", node_name),
            citations: vec![],
            sources: vec![],
        }));
    }

    // Convert retrieval outputs to LLM client format
    let retrieval_results: Vec<crate::llm_client::RetrievalResult> = retrieval_outputs
        .iter()
        .map(|r| crate::llm_client::RetrievalResult {
            chunk_id: r.chunk_id.clone(),
            content: r.content.clone(),
            page_start: r.page_start,
            page_end: r.page_end,
        })
        .collect();

    // Build summary request
    let summary_request = SourceGroundedSummaryRequest {
        node_name: node_name.clone(),
        node_description: node_description.clone(),
        retrieval_results,
    };

    // Create LLM client and generate summary
    let llm_client = LlmClient::new(&model_config.llm_api_url, &model_config.llm_model, &model_config.api_key)
        .map_err(|e| AppError::Internal(format!("Failed to create LLM client: {}", e)))?;
    let summary_result = llm_client
        .generate_source_grounded_summary(&summary_request)
        .await
        .map_err(|e| AppError::Internal(format!("Summary generation failed: {}", e)))?;

    // Convert citations to response format
    let citations: Vec<CitationItem> = summary_result
        .citations
        .iter()
        .map(|c| CitationItem {
            index: c.index,
            chunk_id: c.chunk_id.clone(),
            page_start: c.page_start,
            page_end: c.page_end,
            excerpt: c.excerpt.clone(),
        })
        .collect();

    // Build sources from retrieval outputs
    let sources: Vec<SourceItem> = retrieval_outputs
        .iter()
        .enumerate()
        .map(|(idx, r)| SourceItem {
            index: idx + 1,
            page_start: r.page_start,
            page_end: r.page_end,
            excerpt: r.content.chars().take(200).collect::<String>(),
        })
        .collect();

    tracing::info!(
        "[API] Node summary completed: node_id={}, citations={}",
        node_id,
        citations.len()
    );

    Ok(Json(SummaryResponse {
        summary: summary_result.summary,
        citations,
        sources,
    }))
}

/// Handler for GET /api/nodes/{id}/summary/stream
/// Returns source-grounded summary as a true token-level streaming SSE response
pub async fn node_summary_stream(
    Path(node_id): Path<String>,
    pool: State<SqlitePool>,
) -> Result<impl IntoResponse, AppError> {
    tracing::info!("[API] Node summary stream request: node_id={}", node_id);

    // Get node information from database
    let node_row: Option<(String, Option<String>, String, Option<String>)> = sqlx::query_as(
        "SELECT id, book_id, name, description FROM nodes WHERE id = ?"
    )
    .bind(&node_id)
    .fetch_optional(&*pool)
    .await
    .map_err(AppError::Sqlx)?;

    let node_info = match node_row {
        Some(row) => row,
        None => return Err(AppError::NotFound("Node not found".to_string())),
    };

    let node_name = node_info.2;
    let node_description = node_info.3;

    // Create hybrid retriever and get retrieval results
    let model_config = crate::config::get_model_config(&pool.0)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let retriever = HybridRetriever::new(
        pool.0.clone(),
        model_config.llm_api_url.clone(),
        model_config.embedding_model.clone(),
        model_config.embedding_url.clone(),
        model_config.api_key.clone(),
    );

    // Get retrieval results (top 10 for summary)
    let retrieval_outputs = retriever
        .retrieve_for_node(&node_id, Some(10))
        .await
        .map_err(|e| AppError::Internal(format!("Retrieval failed: {}", e)))?;

    if retrieval_outputs.is_empty() {
        return Err(AppError::NotFound("No relevant content found".to_string()));
    }

    // Convert retrieval outputs to LLM client format
    let retrieval_results: Vec<crate::llm_client::RetrievalResult> = retrieval_outputs
        .iter()
        .map(|r| crate::llm_client::RetrievalResult {
            chunk_id: r.chunk_id.clone(),
            content: r.content.clone(),
            page_start: r.page_start,
            page_end: r.page_end,
        })
        .collect();

    tracing::info!(
        "[========== SUMMARY GENERATION ==========]"
    );
    tracing::info!(
        "[Summary] INPUT: node_name='{}', description='{:?}'",
        node_name,
        node_description.as_ref().map(|s| s.chars().take(50).collect::<String>())
    );
    tracing::info!(
        "[Summary] INPUT: {} retrieval chunks for context",
        retrieval_results.len()
    );
    for (i, r) in retrieval_results.iter().take(3).enumerate() {
        tracing::debug!(
            "[Summary] Chunk {}: id='{}', pages={}-{}, content='{}...'",
            i + 1,
            r.chunk_id.chars().take(8).collect::<String>(),
            r.page_start,
            r.page_end,
            r.content.chars().take(100).collect::<String>()
        );
    }

    // Build summary request
    let summary_request = SourceGroundedSummaryRequest {
        node_name: node_name.clone(),
        node_description: node_description.clone(),
        retrieval_results,
    };

    // Generate summary with streaming tokens
    tracing::info!("[Summary] Calling LLM for source-grounded summary (streaming)...");
    let llm_client = match LlmClient::new(&model_config.llm_api_url, &model_config.llm_model, &model_config.api_key) {
        Ok(client) => client,
        Err(e) => {
            return Err(AppError::Internal(format!("Failed to create LLM client: {}", e)));
        }
    };

    // Clone for use in stream
    let retrieval_results_for_parse = summary_request.retrieval_results.clone();
    let node_id_clone = node_id.clone();

    let stream = async_stream::stream! {
        let mut full_text = String::new();

        // Stream tokens as they arrive from LLM
        let mut token_stream = llm_client.into_summary_stream(&summary_request);

        while let Some(token_result) = token_stream.next().await {
            match token_result {
                Ok(crate::llm_client::SummaryStreamItem::Text(text)) => {
                    full_text.push_str(&text);
                    // Forward text as SSE event to client
                    let text_chunk = serde_json::json!({"type": "content", "text": text});
                    yield Ok::<_, std::convert::Infallible>(SseEvent::default().data(text_chunk.to_string()));
                }
                Ok(crate::llm_client::SummaryStreamItem::Done) => {
                    yield Ok(SseEvent::default().data(r#"{"type":"done"}"#));
                }
                Err(e) => {
                    let error_chunk = serde_json::json!({
                        "type": "error",
                        "message": e.to_string()
                    });
                    yield Ok(SseEvent::default().data(error_chunk.to_string()));
                    yield Ok(SseEvent::default().data(r#"{"type":"done"}"#));
                    tracing::error!("[Summary] Stream error: {}", e);
                    return;
                }
            }
        }

        tracing::info!(
            "[Summary] Stream completed, full_text length={} chars",
            full_text.len()
        );

        // Parse citations from the full text
        let citations = parse_citations_from_summary(&full_text, &retrieval_results_for_parse);

        tracing::info!(
            "[API] Summary stream completed: node_id={}, citations={}",
            node_id_clone,
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
            yield Ok(SseEvent::default().data(citation_chunk.to_string()));
        }

        // Send done signal
        yield Ok(SseEvent::default().data(r#"{"type":"done"}"#));
    };

    Ok(Sse::new(stream)
        .keep_alive(KeepAlive::default())
        .into_response())
}

/// Parse citations from the summary text by extracting [Source: X] patterns
fn parse_citations_from_summary(
    summary: &str,
    retrieval_results: &[crate::llm_client::RetrievalResult],
) -> Vec<CitationItem> {
    let mut seen_indices = std::collections::HashSet::new();
    let mut citations = Vec::new();

    for caps in crate::utils::CITATION_REGEX.captures_iter(summary) {
        if let Ok(idx) = caps[1].parse::<usize>() {
            if idx > 0 && idx <= retrieval_results.len() && seen_indices.insert(idx) {
                let result = &retrieval_results[idx - 1];
                let excerpt = result.content.chars().take(200).collect::<String>();
                citations.push(CitationItem {
                    index: idx,
                    chunk_id: result.chunk_id.clone(),
                    page_start: result.page_start,
                    page_end: result.page_end,
                    excerpt,
                });
            }
        }
    }

    // Sort by index
    citations.sort_by_key(|c| c.index);
    citations
}
