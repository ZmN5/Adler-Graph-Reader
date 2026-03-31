use sqlx::SqlitePool;
use std::collections::HashMap;

/// Default number of top results to return
const DEFAULT_TOP_K: usize = 50;
/// RRF fusion constant
const RRF_K: f64 = 60.0;

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

/// Errors that can occur during retrieval operations
#[derive(Debug)]
pub enum RetrievalError {
    DatabaseError(String),
    EmbeddingError(String),
    ApiError(String),
}

impl std::fmt::Display for RetrievalError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            RetrievalError::DatabaseError(msg) => write!(f, "Database error: {}", msg),
            RetrievalError::EmbeddingError(msg) => write!(f, "Embedding error: {}", msg),
            RetrievalError::ApiError(msg) => write!(f, "API error: {}", msg),
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
    if escaped.contains(' ') {
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
}
