use sqlx::SqlitePool;
use std::collections::HashMap;
use serde::Deserialize;

use crate::embedding::call_embedding_api;

/// Default number of top results to return
const DEFAULT_TOP_K: usize = 50;
/// RRF fusion constant
const RRF_K: f64 = 60.0;
/// Default number of candidates for reranking
const RERANK_TOP_K: usize = 20;
/// LM Studio completions API URL
const LM_STUDIO_COMPLETIONS_URL: &str = "http://localhost:1234/v1/chat/completions";
/// Reranker model
const RERANKER_MODEL: &str = "qwen3.5-9b";

/// Search result from a single retrieval method
#[derive(Debug, Clone)]
pub struct SearchResult {
    pub chunk_id: String,
    pub score: f64,
}

/// Fused result after RRF combining
#[derive(Debug, Clone)]
pub struct FusedResult {
    pub chunk_id: String,
    pub rrf_score: f64,
    pub vector_score: Option<f64>,
    pub bm25_score: Option<f64>,
}

/// Final retrieval result with all scoring details
#[derive(Debug, Clone)]
pub struct RetrievalResult {
    pub chunk_id: String,
    pub vector_score: Option<f64>,
    pub bm25_score: Option<f64>,
    pub final_score: f64,
}

/// Reranked result with final scores
#[derive(Debug, Clone)]
pub struct RerankResult {
    pub chunk_id: String,
    pub rerank_score: f64,
    pub vector_score: Option<f64>,
    pub bm25_score: Option<f64>,
    pub rrf_score: Option<f64>,
}

/// Errors that can occur during retrieval operations
#[derive(Debug)]
pub enum RetrievalError {
    DatabaseError(String),
    EmbeddingError(String),
    ApiError(String),
    RerankError(String),
}

impl std::fmt::Display for RetrievalError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RetrievalError::DatabaseError(msg) => write!(f, "Database error: {}", msg),
            RetrievalError::EmbeddingError(msg) => write!(f, "Embedding error: {}", msg),
            RetrievalError::ApiError(msg) => write!(f, "API error: {}", msg),
            RetrievalError::RerankError(msg) => write!(f, "Rerank error: {}", msg),
        }
    }
}

impl std::error::Error for RetrievalError {}

/// Perform BM25 full-text search using SQLite FTS5
///
/// # Arguments
/// * `pool` - Database connection pool
/// * `query` - Search query (node name and description combined)
/// * `book_id` - Optional book ID to restrict search to specific book
/// * `top_k` - Maximum number of results to return
///
/// # Returns
/// * `Result<Vec<SearchResult>, RetrievalError>` - BM25 ranked results
pub async fn bm25_search(
    pool: &SqlitePool,
    query: &str,
    book_id: Option<&str>,
    top_k: Option<usize>,
) -> Result<Vec<SearchResult>, RetrievalError> {
    let top_k = top_k.unwrap_or(DEFAULT_TOP_K);

    // Clean and prepare the query for FTS5 MATCH
    // Escape special characters that could break FTS5 query syntax
    let escaped_query = escape_fts5_query(query);

    tracing::info!(
        "[BM25 Search] Query: '{}', Book: {:?}, TopK: {}",
        query,
        book_id,
        top_k
    );

    let results: Vec<(String, f64)> = if let Some(bid) = book_id {
        // Search restricted to specific book
        sqlx::query_as(
            r#"
            SELECT c.id, bm25(chunks_fts) as score
            FROM chunks c
            JOIN chunks_fts ON chunks_fts.rowid = c.id
            WHERE chunks_fts.content MATCH ?
            AND c.book_id = ?
            ORDER BY score ASC
            LIMIT ?
            "#,
        )
        .bind(&escaped_query)
        .bind(bid)
        .bind(top_k as i64)
        .fetch_all(pool)
        .await
        .map_err(|e| RetrievalError::DatabaseError(e.to_string()))?
    } else {
        // Search across all books
        sqlx::query_as(
            r#"
            SELECT c.id, bm25(chunks_fts) as score
            FROM chunks c
            JOIN chunks_fts ON chunks_fts.rowid = c.id
            WHERE chunks_fts.content MATCH ?
            ORDER BY score ASC
            LIMIT ?
            "#,
        )
        .bind(&escaped_query)
        .bind(top_k as i64)
        .fetch_all(pool)
        .await
        .map_err(|e| RetrievalError::DatabaseError(e.to_string()))?
    };

    // BM25 returns lower scores for better matches, so we negate for consistency
    // with other scoring methods (higher = better)
    let search_results: Vec<SearchResult> = results
        .into_iter()
        .map(|(chunk_id, score)| SearchResult {
            chunk_id,
            score: -score, // Negate so higher is better
        })
        .collect();

    tracing::info!(
        "[BM25 Search] Found {} results",
        search_results.len()
    );

    Ok(search_results)
}

/// Escape special characters in FTS5 query to prevent syntax errors
///
/// FTS5 special characters: " ( ) * : ^ - OR AND NOT
fn escape_fts5_query(query: &str) -> String {
    // Replace double quotes with single quotes
    let mut escaped = query.replace('"', "'");

    // If the query contains spaces or special characters, wrap in double quotes
    // for phrase matching
    if escaped.contains(' ') || escaped.contains('\'') {
        // For phrase queries, wrap in double quotes
        escaped = format!("\"{}\"", escaped);
    }

    escaped
}

/// Calculate cosine similarity between two vectors
fn cosine_similarity(a: &[f32], b: &[f32]) -> f64 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }

    let mut dot_product: f64 = 0.0;
    let mut norm_a: f64 = 0.0;
    let mut norm_b: f64 = 0.0;

    for (x, y) in a.iter().zip(b.iter()) {
        let x_f64 = *x as f64;
        let y_f64 = *y as f64;
        dot_product += x_f64 * y_f64;
        norm_a += x_f64 * x_f64;
        norm_b += y_f64 * y_f64;
    }

    if norm_a == 0.0 || norm_b == 0.0 {
        return 0.0;
    }

    dot_product / (norm_a.sqrt() * norm_b.sqrt())
}

/// Convert binary blob back to f32 vector
fn bytes_to_f32_vec(bytes: &[u8]) -> Vec<f32> {
    let mut result = Vec::with_capacity(bytes.len() / 4);
    for chunk in bytes.chunks_exact(4) {
        let mut arr = [0u8; 4];
        arr.copy_from_slice(chunk);
        result.push(f32::from_le_bytes(arr));
    }
    result
}

/// Perform vector similarity search
///
/// # Arguments
/// * `pool` - Database connection pool
/// * `query_embedding` - The query vector to search for
/// * `book_id` - Optional book ID to restrict search
/// * `top_k` - Maximum number of results to return
///
/// # Returns
/// * `Result<Vec<SearchResult>, RetrievalError>` - Cosine similarity ranked results
pub async fn vector_search(
    pool: &SqlitePool,
    query_embedding: &[f32],
    book_id: Option<&str>,
    top_k: Option<usize>,
) -> Result<Vec<SearchResult>, RetrievalError> {
    let top_k = top_k.unwrap_or(DEFAULT_TOP_K);

    tracing::info!(
        "[Vector Search] Dimensions: {}, Book: {:?}, TopK: {}",
        query_embedding.len(),
        book_id,
        top_k
    );

    // Fetch all embeddings for the book
    let embeddings: Vec<(String, Vec<u8>)> = if let Some(bid) = book_id {
        sqlx::query_as(
            r#"
            SELECT ce.chunk_id, ce.embedding
            FROM chunk_embeddings ce
            JOIN chunks c ON ce.chunk_id = c.id
            WHERE c.book_id = ?
            "#,
        )
        .bind(bid)
        .fetch_all(pool)
        .await
        .map_err(|e| RetrievalError::DatabaseError(e.to_string()))?
    } else {
        sqlx::query_as(
            r#"
            SELECT ce.chunk_id, ce.embedding
            FROM chunk_embeddings ce
            "#,
        )
        .fetch_all(pool)
        .await
        .map_err(|e| RetrievalError::DatabaseError(e.to_string()))?
    };

    if embeddings.is_empty() {
        tracing::warn!("[Vector Search] No embeddings found");
        return Ok(Vec::new());
    }

    // Calculate cosine similarity for each chunk
    let mut results: Vec<SearchResult> = embeddings
        .into_iter()
        .map(|(chunk_id, embedding_bytes)| {
            let embedding = bytes_to_f32_vec(&embedding_bytes);
            let similarity = cosine_similarity(query_embedding, &embedding);
            SearchResult {
                chunk_id,
                score: similarity,
            }
        })
        .filter(|r| r.score > 0.0) // Filter out zero similarity
        .collect();

    // Sort by similarity descending
    results.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));

    // Take top_k
    results.truncate(top_k);

    tracing::info!(
        "[Vector Search] Found {} results, best score: {:.4}",
        results.len(),
        results.first().map(|r| r.score).unwrap_or(0.0)
    );

    Ok(results)
}

/// Perform vector similarity search with text query (generates embedding internally)
///
/// # Arguments
/// * `pool` - Database connection pool
/// * `query_text` - The text query to search for
/// * `book_id` - Optional book ID to restrict search
/// * `top_k` - Maximum number of results to return
///
/// # Returns
/// * `Result<Vec<SearchResult>, RetrievalError>` - Cosine similarity ranked results
pub async fn vector_search_with_query(
    pool: &SqlitePool,
    query_text: &str,
    book_id: Option<&str>,
    top_k: Option<usize>,
) -> Result<Vec<SearchResult>, RetrievalError> {
    tracing::info!("[Vector Search with Query] Query: '{}'", query_text);

    // Generate embedding for the query text
    let query_embedding = generate_query_embedding(query_text).await?;

    // Perform vector search with the generated embedding
    vector_search(pool, &query_embedding, book_id, top_k).await
}

/// Generate embedding for a query text using the same model as chunks
///
/// # Arguments
/// * `query_text` - The text to embed
///
/// # Returns
/// * `Result<Vec<f32>, RetrievalError>` - The embedding vector
async fn generate_query_embedding(query_text: &str) -> Result<Vec<f32>, RetrievalError> {
    let embeddings = call_embedding_api(vec![query_text.to_string()])
        .await
        .map_err(|e| RetrievalError::EmbeddingError(e.to_string()))?;

    if embeddings.is_empty() {
        return Err(RetrievalError::EmbeddingError(
            "No embedding generated for query".to_string(),
        ));
    }

    tracing::debug!("[Query Embedding] Generated embedding with {} dimensions", embeddings[0].len());

    Ok(embeddings[0].clone())
}

/// Perform Reciprocal Rank Fusion (RRF) to combine multiple retrieval results
///
/// RRF formula: score = sum(1 / (k + rank)) for each list where item appears
///
/// # Arguments
/// * `vector_results` - Results from vector similarity search
/// * `bm25_results` - Results from BM25 text search
/// * `k` - RRF constant (default 60)
///
/// # Returns
/// * `Vec<FusedResult>` - Fused and re-ranked results
pub fn reciprocal_rank_fusion(
    vector_results: &[SearchResult],
    bm25_results: &[SearchResult],
    k: Option<f64>,
) -> Vec<FusedResult> {
    let k = k.unwrap_or(RRF_K);

    // Build rank lookup maps
    let vector_ranks: HashMap<&str, usize> = vector_results
        .iter()
        .enumerate()
        .map(|(idx, r)| (r.chunk_id.as_str(), idx + 1))
        .collect();

    let bm25_ranks: HashMap<&str, usize> = bm25_results
        .iter()
        .enumerate()
        .map(|(idx, r)| (r.chunk_id.as_str(), idx + 1))
        .collect();

    // Collect all unique chunk IDs
    let mut all_chunks: Vec<&str> = vector_ranks.keys().copied().collect();
    for chunk_id in bm25_ranks.keys() {
        if !vector_ranks.contains_key(*chunk_id) {
            all_chunks.push(chunk_id);
        }
    }

    // Calculate RRF scores
    let mut fused_results: Vec<FusedResult> = all_chunks
        .into_iter()
        .map(|chunk_id| {
            let mut rrf_score = 0.0;
            let mut vector_score = None;
            let mut bm25_score = None;

            if let Some(&rank) = vector_ranks.get(chunk_id) {
                rrf_score += 1.0 / (k + rank as f64);
                vector_score = vector_results
                    .iter()
                    .find(|r| r.chunk_id == chunk_id)
                    .map(|r| r.score);
            }

            if let Some(&rank) = bm25_ranks.get(chunk_id) {
                rrf_score += 1.0 / (k + rank as f64);
                bm25_score = bm25_results
                    .iter()
                    .find(|r| r.chunk_id == chunk_id)
                    .map(|r| r.score);
            }

            FusedResult {
                chunk_id: chunk_id.to_string(),
                rrf_score,
                vector_score,
                bm25_score,
            }
        })
        .collect();

    // Sort by RRF score descending
    fused_results.sort_by(|a, b| {
        b.rrf_score
            .partial_cmp(&a.rrf_score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    tracing::info!(
        "[RRF] Fused {} vector + {} BM25 = {} results",
        vector_results.len(),
        bm25_results.len(),
        fused_results.len()
    );

    fused_results
}

/// Convert fused results to final retrieval results
pub fn fused_to_retrieval_results(fused: Vec<FusedResult>) -> Vec<RetrievalResult> {
    fused
        .into_iter()
        .map(|f| RetrievalResult {
            chunk_id: f.chunk_id,
            vector_score: f.vector_score,
            bm25_score: f.bm25_score,
            final_score: f.rrf_score,
        })
        .collect()
}

/// Rerank results using LM Studio LLM
///
/// # Arguments
/// * `query` - The search query (node name and description)
/// * `candidates` - Candidate chunks from RRF fusion (typically top 20)
/// * `passages` - The actual content of each candidate chunk
///
/// # Returns
/// * `Result<Vec<RerankResult>, RetrievalError>` - Reranked results with LLM scores
pub async fn rerank(
    query: &str,
    candidates: Vec<FusedResult>,
    passages: &HashMap<String, String>,
) -> Result<Vec<RerankResult>, RetrievalError> {
    // Take top candidates for reranking
    let candidates_to_rerank: Vec<FusedResult> = candidates
        .into_iter()
        .take(RERANK_TOP_K)
        .collect();

    if candidates_to_rerank.is_empty() {
        tracing::warn!("[Rerank] No candidates to rerank");
        return Ok(Vec::new());
    }

    tracing::info!(
        "[Rerank] Reranking {} candidates for query: '{}'",
        candidates_to_rerank.len(),
        query
    );

    // Build reranker prompt
    let prompt = build_reranker_prompt(query, &candidates_to_rerank, passages);

    // Call LM Studio API
    let reranked = call_reranker_api(&prompt, &candidates_to_rerank).await?;

    tracing::info!(
        "[Rerank] Completed reranking, returned {} results",
        reranked.len()
    );

    Ok(reranked)
}

/// Build prompt for reranker LLM
fn build_reranker_prompt(
    query: &str,
    candidates: &[FusedResult],
    passages: &HashMap<String, String>,
) -> String {
    let mut prompt = format!(
        r#"You are a relevance ranking assistant. Given a query and a list of passages, rank the passages by their relevance to the query.

Query: {}

Passages:
"#,
        query
    );

    for (idx, candidate) in candidates.iter().enumerate() {
        let content = passages
            .get(&candidate.chunk_id)
            .cloned()
            .unwrap_or_else(|| "[Content not available]".to_string());
        // Escape any triple quotes in content to avoid breaking the prompt
        let escaped_content = content.replace("```", "'''");
        prompt.push_str(&format!(
            "[{}] {}\n\n",
            idx + 1,
            escaped_content.chars().take(500).collect::<String>()
        ));
    }

    prompt.push_str(&format!(
        r#"
Rank the passages by relevance to the query. Return a JSON array with the ranked passage indices and relevance scores (0.0-1.0, where 1.0 is most relevant).

Expected JSON format:
[
  {{"index": 1, "score": 0.95}},
  {{"index": 3, "score": 0.82}},
  {{"index": 2, "score": 0.45}}
]

Important:
- Return ONLY valid JSON, no markdown code blocks
- Index is 1-based (the first passage is index 1)
- Score must be between 0.0 and 1.0
- Sort by score descending (most relevant first)
"#
    ));

    prompt
}

/// Reranker response item
#[derive(Debug, Deserialize)]
struct RerankerResponseItem {
    index: usize,
    score: f64,
}

/// Call LM Studio completions API for reranking
async fn call_reranker_api(
    prompt: &str,
    candidates: &[FusedResult],
) -> Result<Vec<RerankResult>, RetrievalError> {
    use reqwest::Client;
    use serde::{Deserialize, Serialize};
    use std::time::Duration;

    #[derive(Debug, Serialize)]
    struct ChatMessage {
        role: String,
        content: String,
    }

    #[derive(Debug, Serialize)]
    struct ChatRequest {
        model: String,
        messages: Vec<ChatMessage>,
        temperature: f32,
    }

    #[derive(Debug, Deserialize)]
    struct ChatResponse {
        choices: Vec<ChatChoice>,
    }

    #[derive(Debug, Deserialize)]
    struct ChatChoice {
        message: ChatMessageContent,
    }

    #[derive(Debug, Deserialize)]
    struct ChatMessageContent {
        content: String,
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| RetrievalError::ApiError(format!("Failed to create HTTP client: {}", e)))?;

    let request = ChatRequest {
        model: RERANKER_MODEL.to_string(),
        messages: vec![ChatMessage {
            role: "user".to_string(),
            content: prompt.to_string(),
        }],
        temperature: 0.1, // Low temperature for consistent rankings
    };

    tracing::debug!("[Rerank] Sending request to LM Studio");

    let response = client
        .post(LM_STUDIO_COMPLETIONS_URL)
        .header("Authorization", "Bearer lm-studio")
        .json(&request)
        .send()
        .await
        .map_err(|e| RetrievalError::ApiError(format!("Connection error: {}", e)))?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(RetrievalError::ApiError(format!(
            "API error {}: {}",
            status, body
        )));
    }

    let chat_response: ChatResponse = response
        .json()
        .await
        .map_err(|e| RetrievalError::ApiError(format!("Parse error: {}", e)))?;

    let content = chat_response
        .choices
        .first()
        .map(|c| c.message.content.clone())
        .ok_or_else(|| RetrievalError::ApiError("Empty response from LLM".to_string()))?;

    tracing::debug!("[Rerank] Raw response: {}", content);

    // Parse the JSON response
    parse_reranker_response(&content, candidates)
}

/// Parse reranker response into RerankResult structs
fn parse_reranker_response(
    content: &str,
    candidates: &[FusedResult],
) -> Result<Vec<RerankResult>, RetrievalError> {
    // Extract JSON from response
    let json_str = extract_json(content)?;

    let ranked_items: Vec<RerankerResponseItem> = serde_json::from_str(json_str)
        .map_err(|e| RetrievalError::RerankError(format!("Failed to parse JSON: {}", e)))?;

    // Build result lookup map
    let candidate_map: HashMap<usize, &FusedResult> = candidates
        .iter()
        .enumerate()
        .map(|(idx, c)| (idx + 1, c)) // 1-based index
        .collect();

    // Build reranked results
    let mut reranked: Vec<RerankResult> = ranked_items
        .into_iter()
        .filter_map(|item| {
            candidate_map.get(&item.index).map(|candidate| RerankResult {
                chunk_id: candidate.chunk_id.clone(),
                rerank_score: item.score.clamp(0.0, 1.0),
                vector_score: candidate.vector_score,
                bm25_score: candidate.bm25_score,
                rrf_score: Some(candidate.rrf_score),
            })
        })
        .collect();

    // Sort by rerank score descending
    reranked.sort_by(|a, b| {
        b.rerank_score
            .partial_cmp(&a.rerank_score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    Ok(reranked)
}

/// Extract JSON from a string that might have wrapper text
fn extract_json(content: &str) -> Result<&str, RetrievalError> {
    // Try to find JSON array
    if let Some(start) = content.find('[') {
        if let Some(end) = content.rfind(']') {
            if end > start {
                return Ok(&content[start..=end]);
            }
        }
    }

    // Try JSON object
    if let Some(start) = content.find('{') {
        if let Some(end) = content.rfind('}') {
            if end > start {
                return Ok(&content[start..=end]);
            }
        }
    }

    Err(RetrievalError::RerankError(
        "No JSON found in response".to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cosine_similarity_identical() {
        let a = vec![1.0, 2.0, 3.0];
        let b = vec![1.0, 2.0, 3.0];
        let sim = cosine_similarity(&a, &b);
        assert!((sim - 1.0).abs() < 0.0001);
    }

    #[test]
    fn test_cosine_similarity_orthogonal() {
        let a = vec![1.0, 0.0, 0.0];
        let b = vec![0.0, 1.0, 0.0];
        let sim = cosine_similarity(&a, &b);
        assert!(sim.abs() < 0.0001);
    }

    #[test]
    fn test_rrf_fusion() {
        let vector_results = vec![
            SearchResult {
                chunk_id: "chunk1".to_string(),
                score: 0.9,
            },
            SearchResult {
                chunk_id: "chunk2".to_string(),
                score: 0.8,
            },
        ];

        let bm25_results = vec![
            SearchResult {
                chunk_id: "chunk2".to_string(),
                score: 0.95,
            },
            SearchResult {
                chunk_id: "chunk3".to_string(),
                score: 0.85,
            },
        ];

        let fused = reciprocal_rank_fusion(&vector_results, &bm25_results, Some(60.0));

        // chunk2 appears in both, so should have highest score
        assert_eq!(fused[0].chunk_id, "chunk2");
        assert!(fused[0].rrf_score > fused[1].rrf_score);
    }

    #[test]
    fn test_escape_fts5_query() {
        assert_eq!(escape_fts5_query("hello"), "hello");
        assert_eq!(escape_fts5_query("hello world"), "\"hello world\"");
        assert_eq!(escape_fts5_query("test\"quote"), "\"test'quote\"");
    }

    #[test]
    fn test_bytes_to_f32_vec() {
        let f32_vec = vec![1.0f32, 2.0, 3.0];
        let bytes: Vec<u8> = f32_vec
            .iter()
            .flat_map(|f| f.to_le_bytes())
            .collect();
        let restored = bytes_to_f32_vec(&bytes);
        assert_eq!(f32_vec, restored);
    }

    #[test]
    fn test_extract_json_array() {
        let content = r#"Some text before [{"index": 1, "score": 0.9}] and after"#;
        let json = extract_json(content).unwrap();
        assert!(json.starts_with('['));
        assert!(json.ends_with(']'));
    }

    #[test]
    fn test_extract_json_object() {
        let content = r#"Some text before {"key": "value"} and after"#;
        let json = extract_json(content).unwrap();
        assert!(json.starts_with('{'));
        assert!(json.ends_with('}'));
    }

    #[test]
    fn test_parse_reranker_response() {
        let candidates = vec![
            FusedResult {
                chunk_id: "chunk1".to_string(),
                rrf_score: 0.8,
                vector_score: Some(0.9),
                bm25_score: Some(0.7),
            },
            FusedResult {
                chunk_id: "chunk2".to_string(),
                rrf_score: 0.6,
                vector_score: Some(0.7),
                bm25_score: Some(0.5),
            },
        ];

        let response = r#"[{"index": 2, "score": 0.95}, {"index": 1, "score": 0.82}]"#;
        let result = parse_reranker_response(response, &candidates).unwrap();

        assert_eq!(result.len(), 2);
        assert_eq!(result[0].chunk_id, "chunk2");
        assert_eq!(result[0].rerank_score, 0.95);
        assert_eq!(result[1].chunk_id, "chunk1");
        assert_eq!(result[1].rerank_score, 0.82);
    }

    #[test]
    fn test_build_reranker_prompt() {
        let candidates = vec![
            FusedResult {
                chunk_id: "chunk1".to_string(),
                rrf_score: 0.8,
                vector_score: Some(0.9),
                bm25_score: Some(0.7),
            },
        ];

        let mut passages = HashMap::new();
        passages.insert("chunk1".to_string(), "This is the content of chunk 1".to_string());

        let prompt = build_reranker_prompt("test query", &candidates, &passages);

        assert!(prompt.contains("test query"));
        assert!(prompt.contains("This is the content of chunk 1"));
        assert!(prompt.contains("JSON format"));
    }

    #[test]
    fn test_rerank_result_struct() {
        let result = RerankResult {
            chunk_id: "test_chunk".to_string(),
            rerank_score: 0.95,
            vector_score: Some(0.9),
            bm25_score: Some(0.8),
            rrf_score: Some(0.85),
        };

        assert_eq!(result.chunk_id, "test_chunk");
        assert_eq!(result.rerank_score, 0.95);
    }
}
