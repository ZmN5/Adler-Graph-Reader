use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use tokio::process::Command;

const BATCH_SIZE: usize = 32;

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
}

#[derive(Debug, Deserialize)]
struct EmbeddingData {
    embedding: Vec<f32>,
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
}

impl std::fmt::Display for EmbeddingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EmbeddingError::ConnectionError(msg) => write!(f, "Connection error: {}", msg),
            EmbeddingError::ApiError(msg) => write!(f, "API error: {}", msg),
            EmbeddingError::ParseError(msg) => write!(f, "Parse error: {}", msg),
            EmbeddingError::DatabaseError(msg) => write!(f, "Database error: {}", msg),
        }
    }
}

impl std::error::Error for EmbeddingError {}

/// Rebuild FTS5 index for all chunks in a book
///
/// This function deletes existing FTS entries for the book and rebuilds them
/// by inserting all current chunks into the chunks_fts table.
///
/// # Arguments
/// * `pool` - Database connection pool
/// * `book_id` - The book ID to rebuild FTS index for
///
/// # Returns
/// * `Result<usize, EmbeddingError>` - Number of FTS entries created
pub async fn rebuild_fts_index(
    pool: &SqlitePool,
    book_id: &str,
) -> Result<usize, EmbeddingError> {
    tracing::info!(
        "[FTS] Starting FTS index rebuild for book: {}",
        book_id
    );

    // Fetch all chunks for this book
    let chunks: Vec<(String, String)> = sqlx::query_as(
        r#"
        SELECT c.id, c.content
        FROM chunks c
        WHERE c.book_id = ?
        ORDER BY c.page_start, c.paragraph_start
        "#,
    )
    .bind(book_id)
    .fetch_all(pool)
    .await
    .map_err(|e| EmbeddingError::DatabaseError(e.to_string()))?;

    if chunks.is_empty() {
        tracing::info!("[FTS] No chunks found for book: {}", book_id);
        return Ok(0);
    }

    tracing::info!("[FTS] Found {} chunks for book: {}", chunks.len(), book_id);

    // Delete existing FTS entries for chunks in this book by chunk_id
    for (chunk_id, _content) in &chunks {
        sqlx::query(
            r#"
            DELETE FROM chunks_fts WHERE chunk_id = ?
            "#,
        )
        .bind(chunk_id)
        .execute(pool)
        .await
        .map_err(|e| EmbeddingError::DatabaseError(e.to_string()))?;
    }

    tracing::info!("[FTS] Deleted existing FTS entries for book: {}", book_id);

    // Insert all chunks into FTS table with chunk_id and content columns
    let mut count = 0usize;
    for (chunk_id, content) in &chunks {
        sqlx::query(
            r#"
            INSERT INTO chunks_fts(chunk_id, content)
            VALUES (?, ?)
            "#,
        )
        .bind(chunk_id)
        .bind(content)
        .execute(pool)
        .await
        .map_err(|e| EmbeddingError::DatabaseError(e.to_string()))?;
        count += 1;
    }

    tracing::info!(
        "[FTS] Rebuilt FTS index for book: {}. Total entries: {}",
        book_id,
        count
    );

    Ok(count)
}

/// Call LM Studio embedding API
///
/// # Arguments
/// * `texts` - Vector of text strings to embed
/// * `model` - Embedding model name
/// * `url` - Embedding API URL
///
/// # Returns
/// * `Result<Vec<Vec<f32>>, EmbeddingError>` - Vector of embedding vectors
pub async fn call_embedding_api(
    texts: Vec<String>,
    model: &str,
    url: &str,
    api_key: &str,
) -> Result<Vec<Vec<f32>>, EmbeddingError> {
    if texts.is_empty() {
        return Ok(Vec::new());
    }

    let request = EmbeddingRequest {
        model: model.to_string(),
        input: texts.clone(),
    };

    let request_body = serde_json::to_string(&request).unwrap_or_default();
    tracing::info!(
        "[Embedding] Sending request for {} texts to {} (model: {})",
        texts.len(),
        url,
        model
    );
    tracing::debug!("[Embedding] Request body ({}): {}", texts.len(), &request_body[..request_body.len().min(200)]);

    // Use curl subprocess to avoid reqwest/LM Studio compatibility issues
    let auth_header = format!("Authorization: Bearer {}", api_key);
    let output = Command::new("curl")
        .args([
            "-s", "-m", "60", "-X", "POST", url,
            "-H", "Content-Type: application/json",
            "-H", &auth_header,
            "--data-binary", &request_body,
            "--noproxy", "*",
        ])
        .output()
        .await
        .map_err(|e| {
            tracing::error!("[Embedding] curl execution error: {}", e);
            EmbeddingError::ConnectionError(format!("curl failed: {}", e))
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    tracing::warn!("[Embedding] curl exit status: {}, stdout_len: {}, stderr: {}",
        output.status, stdout.len(), &stderr[..stderr.len().min(100)]);

    if !output.status.success() {
        tracing::error!("[Embedding] curl failed with status {}: {}", output.status, stderr);
        return Err(EmbeddingError::ApiError(format!(
            "curl failed: {}",
            stderr
        )));
    }

    if stdout.is_empty() {
        tracing::error!("[Embedding] curl returned empty response");
        return Err(EmbeddingError::ApiError("empty response from embedding API".to_string()));
    }

    let embedding_response: EmbeddingResponse = serde_json::from_str(&stdout).map_err(|e| {
        tracing::error!("[Embedding] Parse error: {} | body: {}", e, &stdout[..stdout.len().min(200)]);
        EmbeddingError::ParseError(format!("{}: {}", e, &stdout[..stdout.len().min(200)]))
    })?;

    // Validate dimensions and extract embeddings
    let mut embeddings = Vec::with_capacity(embedding_response.data.len());
    let mut expected_dim: Option<usize> = None;
    for data in embedding_response.data {
        if let Some(dim) = expected_dim {
            if data.embedding.len() != dim {
                tracing::warn!(
                    "[Embedding] Dimension mismatch within batch: expected {}, got {}",
                    dim,
                    data.embedding.len()
                );
            }
        } else {
            expected_dim = Some(data.embedding.len());
        }
        embeddings.push(data.embedding);
    }

    if let Some(dim) = expected_dim {
        tracing::info!("[Embedding] Detected embedding dimension: {}", dim);
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
/// * `embedding_model` - Embedding model name
/// * `embedding_url` - Embedding API URL
///
/// # Returns
/// * `Result<usize, EmbeddingError>` - Number of chunks processed
pub async fn generate_chunk_embeddings(
    pool: &SqlitePool,
    book_id: &str,
    embedding_model: &str,
    embedding_url: &str,
    api_key: &str,
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
        let embeddings = call_embedding_api(texts, embedding_model, embedding_url, api_key).await?;

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
            .bind(embedding_model)
            .bind(embedding.len() as i32)
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
/// * `embedding_model` - Embedding model name
/// * `embedding_url` - Embedding API URL
///
/// # Returns
/// * `Result<usize, EmbeddingError>> - Number of chunks processed
#[allow(dead_code)]
pub async fn generate_embeddings_for_chunks(
    pool: &SqlitePool,
    chunk_ids: &[String],
    embedding_model: &str,
    embedding_url: &str,
    api_key: &str,
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

        let embeddings = call_embedding_api(texts, embedding_model, embedding_url, api_key).await?;

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
            .bind(embedding_model)
            .bind(embedding.len() as i32)
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
