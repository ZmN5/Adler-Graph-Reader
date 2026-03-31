use reqwest::Client;
use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use std::time::Duration;

/// Default embedding model from LM Studio
const EMBEDDING_MODEL: &str = "mlx-community/Qwen3-Embedding-0.6B-4bit-DWQ";
const EMBEDDING_DIMENSIONS: usize = 1024;
const BATCH_SIZE: usize = 32;
const LM_STUDIO_EMBEDDING_URL: &str = "http://localhost:1234/v1/embeddings";

/// OpenAI-compatible embedding request
#[derive(Debug, Serialize)]
struct EmbeddingRequest {
    model: String,
    input: Vec<String>,
}

/// OpenAI-compatible embedding response
#[derive(Debug, Deserialize)]
struct EmbeddingResponse {
    data: Vec<EmbeddingData>,
    model: String,
    usage: Option<Usage>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingData {
    embedding: Vec<f32>,
    index: usize,
    object: String,
}

#[derive(Debug, Deserialize)]
struct Usage {
    prompt_tokens: usize,
    total_tokens: usize,
}

/// Represents a chunk that needs embedding
#[derive(Debug)]
struct ChunkForEmbedding {
    id: String,
    content: String,
}

/// Errors that can occur during embedding operations
#[derive(Debug)]
pub enum EmbeddingError {
    ConnectionError(String),
    ApiError(String),
    ParseError(String),
    DatabaseError(String),
    DimensionMismatch { expected: usize, got: usize },
}

impl std::fmt::Display for EmbeddingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EmbeddingError::ConnectionError(msg) => write!(f, "Connection error: {}", msg),
            EmbeddingError::ApiError(msg) => write!(f, "API error: {}", msg),
            EmbeddingError::ParseError(msg) => write!(f, "Parse error: {}", msg),
            EmbeddingError::DatabaseError(msg) => write!(f, "Database error: {}", msg),
            EmbeddingError::DimensionMismatch { expected, got } => {
                write!(f, "Dimension mismatch: expected {}, got {}", expected, got)
            }
        }
    }
}

impl std::error::Error for EmbeddingError {}

/// Call LM Studio embedding API
///
/// # Arguments
/// * `texts` - Vector of text strings to embed
///
/// # Returns
/// * `Result<Vec<Vec<f32>>, EmbeddingError>` - Vector of embedding vectors
pub async fn call_embedding_api(texts: Vec<String>) -> Result<Vec<Vec<f32>>, EmbeddingError> {
    if texts.is_empty() {
        return Ok(Vec::new());
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .expect("Failed to create HTTP client");

    let request = EmbeddingRequest {
        model: EMBEDDING_MODEL.to_string(),
        input: texts,
    };

    tracing::debug!(
        "[Embedding] Sending request for {} texts",
        request.input.len()
    );

    let response = client
        .post(LM_STUDIO_EMBEDDING_URL)
        .header("Authorization", "Bearer lm-studio")
        .header("Content-Type", "application/json")
        .json(&request)
        .send()
        .await
        .map_err(|e| {
            tracing::error!("[Embedding] Connection error: {}", e);
            EmbeddingError::ConnectionError(e.to_string())
        })?;

    tracing::debug!("[Embedding] Response status: {}", response.status());

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        tracing::error!("[Embedding] API error {}: {}", status, body);
        return Err(EmbeddingError::ApiError(format!(
            "API error {}: {}",
            status, body
        )));
    }

    let embedding_response: EmbeddingResponse = response.json().await.map_err(|e| {
        tracing::error!("[Embedding] Parse error: {}", e);
        EmbeddingError::ParseError(e.to_string())
    })?;

    // Validate dimensions and extract embeddings
    let mut embeddings = Vec::with_capacity(embedding_response.data.len());
    for data in embedding_response.data {
        if data.embedding.len() != EMBEDDING_DIMENSIONS {
            return Err(EmbeddingError::DimensionMismatch {
                expected: EMBEDDING_DIMENSIONS,
                got: data.embedding.len(),
            });
        }
        embeddings.push(data.embedding);
    }

    tracing::info!(
        "[Embedding] Successfully generated {} embeddings using model: {}",
        embeddings.len(),
        embedding_response.model
    );

    Ok(embeddings)
}

/// Generate embeddings for all chunks in a book that don't have embeddings yet
///
/// # Arguments
/// * `pool` - Database connection pool
/// * `book_id` - The book ID to generate embeddings for
///
/// # Returns
/// * `Result<usize, EmbeddingError>` - Number of chunks processed
pub async fn generate_chunk_embeddings(
    pool: &SqlitePool,
    book_id: &str,
) -> Result<usize, EmbeddingError> {
    tracing::info!(
        "[Embedding] Starting embedding generation for book: {}",
        book_id
    );

    // Fetch chunks without embeddings for this book using raw query
    let rows: Vec<(String, String)> = sqlx::query_as(
        r#"
        SELECT c.id, c.content
        FROM chunks c
        LEFT JOIN chunk_embeddings ce ON c.id = ce.chunk_id
        WHERE c.book_id = ? AND ce.chunk_id IS NULL
        ORDER BY c.page_start, c.paragraph_start
        "#
    )
    .bind(book_id)
    .fetch_all(pool)
    .await
    .map_err(|e| EmbeddingError::DatabaseError(e.to_string()))?;

    let chunks: Vec<ChunkForEmbedding> = rows
        .into_iter()
        .map(|(id, content)| ChunkForEmbedding { id, content })
        .collect();

    if chunks.is_empty() {
        tracing::info!("[Embedding] No chunks need embeddings for book: {}", book_id);
        return Ok(0);
    }

    tracing::info!(
        "[Embedding] Found {} chunks without embeddings",
        chunks.len()
    );

    let mut processed_count = 0usize;

    // Process in batches
    for batch in chunks.chunks(BATCH_SIZE) {
        let texts: Vec<String> = batch.iter().map(|c| c.content.clone()).collect();
        let chunk_ids: Vec<&str> = batch.iter().map(|c| c.id.as_str()).collect();

        // Call embedding API
        let embeddings = call_embedding_api(texts).await?;

        if embeddings.len() != batch.len() {
            return Err(EmbeddingError::ApiError(format!(
                "Mismatch: got {} embeddings for {} chunks",
                embeddings.len(),
                batch.len()
            )));
        }

        // Store embeddings in database
        for (i, (chunk_id, embedding)) in chunk_ids.iter().zip(embeddings.iter()).enumerate() {
            // Convert f32 array to binary blob
            let embedding_bytes: Vec<u8> = embedding
                .iter()
                .flat_map(|f: &f32| f.to_le_bytes())
                .collect();

            sqlx::query(
                r#"
                INSERT INTO chunk_embeddings (chunk_id, embedding, model_name, dimensions, created_at)
                VALUES (?, ?, ?, ?, datetime('now'))
                "#,
            )
            .bind(chunk_id)
            .bind(&embedding_bytes)
            .bind(EMBEDDING_MODEL)
            .bind(EMBEDDING_DIMENSIONS as i32)
            .execute(pool)
            .await
            .map_err(|e| {
                tracing::error!("[Embedding] Failed to store embedding for chunk {}: {}", chunk_id, e);
                EmbeddingError::DatabaseError(e.to_string())
            })?;

            processed_count += 1;
            tracing::debug!("[Embedding] Stored embedding for chunk {} ({}/{batch_size})",
                chunk_id, i + 1, batch_size = batch.len());
        }

        tracing::info!("[Embedding] Processed batch of {} chunks", batch.len());
    }

    tracing::info!(
        "[Embedding] Completed embedding generation for book: {}. Total processed: {}",
        book_id,
        processed_count
    );

    Ok(processed_count)
}

/// Generate embeddings for specific chunk IDs
///
/// # Arguments
/// * `pool` - Database connection pool
/// * `chunk_ids` - Vector of chunk IDs to generate embeddings for
///
/// # Returns
/// * `Result<usize, EmbeddingError>` - Number of chunks processed
pub async fn generate_embeddings_for_chunks(
    pool: &SqlitePool,
    chunk_ids: &[String],
) -> Result<usize, EmbeddingError> {
    if chunk_ids.is_empty() {
        return Ok(0);
    }

    tracing::info!(
        "[Embedding] Starting embedding generation for {} specific chunks",
        chunk_ids.len()
    );

    // Build the query with IN clause manually for chunk_ids
    let mut chunks: Vec<ChunkForEmbedding> = Vec::new();
    for chunk_id in chunk_ids {
        let row: Option<(String, String)> = sqlx::query_as(
            r#"
            SELECT c.id, c.content
            FROM chunks c
            LEFT JOIN chunk_embeddings ce ON c.id = ce.chunk_id
            WHERE c.id = ? AND ce.chunk_id IS NULL
            "#
        )
        .bind(chunk_id)
        .fetch_optional(pool)
        .await
        .map_err(|e: sqlx::Error| EmbeddingError::DatabaseError(e.to_string()))?;

        if let Some((id, content)) = row {
            chunks.push(ChunkForEmbedding { id, content });
        }
    }

    if chunks.is_empty() {
        tracing::info!("[Embedding] No chunks need embeddings");
        return Ok(0);
    }

    let mut processed_count = 0usize;

    // Process in batches
    for batch in chunks.chunks(BATCH_SIZE) {
        let texts: Vec<String> = batch.iter().map(|c| c.content.clone()).collect();
        let batch_chunk_ids: Vec<&str> = batch.iter().map(|c| c.id.as_str()).collect();

        let embeddings = call_embedding_api(texts).await?;

        for (chunk_id, embedding) in batch_chunk_ids.iter().zip(embeddings.iter()) {
            let embedding_bytes: Vec<u8> = embedding
                .iter()
                .flat_map(|f: &f32| f.to_le_bytes())
                .collect();

            sqlx::query(
                r#"
                INSERT INTO chunk_embeddings (chunk_id, embedding, model_name, dimensions, created_at)
                VALUES (?, ?, ?, ?, datetime('now'))
                "#,
            )
            .bind(chunk_id)
            .bind(&embedding_bytes)
            .bind(EMBEDDING_MODEL)
            .bind(EMBEDDING_DIMENSIONS as i32)
            .execute(pool)
            .await
            .map_err(|e: sqlx::Error| EmbeddingError::DatabaseError(e.to_string()))?;

            processed_count += 1;
        }

        tracing::info!("[Embedding] Processed batch of {} chunks", batch.len());
    }

    Ok(processed_count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_embedding_to_bytes_conversion() {
        let embedding: Vec<f32> = vec![1.0, 2.0, 3.0, 4.0];
        let bytes: Vec<u8> = embedding.iter().flat_map(|f| f.to_le_bytes()).collect();

        // Each f32 is 4 bytes
        assert_eq!(bytes.len(), 16);

        // Verify we can convert back
        let mut restored: Vec<f32> = Vec::new();
        for i in 0..4 {
            let mut bytes_array = [0u8; 4];
            bytes_array.copy_from_slice(&bytes[i * 4..(i + 1) * 4]);
            restored.push(f32::from_le_bytes(bytes_array));
        }
        assert_eq!(restored, vec![1.0, 2.0, 3.0, 4.0]);
    }
}
