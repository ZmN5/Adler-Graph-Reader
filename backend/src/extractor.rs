use crate::llm_client::{ExtractedConcept, ExtractedRelation, LlmClient};
use sqlx::SqlitePool;
use std::sync::Arc;
use tokio::sync::Semaphore;

/// Process a single chunk through LLM and store results
async fn process_chunk(
    chunk_id: &str,
    chunk_content: &str,
    book_id: &str,
    language: &str,
    pool: &SqlitePool,
    llm: &LlmClient,
) -> Result<(usize, usize), String> {
    tracing::info!("[{}] Starting concept extraction for chunk (content length: {})", chunk_id, chunk_content.len());

    // Call LLM to extract concepts
    tracing::debug!("[{}] Calling LLM extract_concepts...", chunk_id);
    let response = llm
        .extract_concepts(chunk_id, chunk_content, language)
        .await
        .map_err(|e| {
            tracing::error!("[{}] LLM call failed: {}", chunk_id, e);
            e.to_string()
        })?;

    tracing::info!("[{}] LLM returned {} concepts, {} relations",
        chunk_id, response.concepts.len(), response.relations.len());

    let mut nodes_created = 0;
    let mut edges_created = 0;

    // Process concepts and create nodes
    for concept in &response.concepts {
        if let Err(e) = create_node_for_concept(pool, concept, chunk_id, book_id, language).await {
            tracing::warn!("Failed to create node: {}", e);
            continue;
        }
        nodes_created += 1;
    }

    // Process relations and create edges
    for relation in &response.relations {
        match create_edge_for_relation(pool, &relation, book_id, chunk_id).await {
            Ok(_) => edges_created += 1,
            Err(e) => tracing::warn!("Failed to create edge: {}", e),
        }
    }

    Ok((nodes_created, edges_created))
}

/// Create a node for an extracted concept, with deduplication
async fn create_node_for_concept(
    pool: &SqlitePool,
    concept: &ExtractedConcept,
    source_chunk_id: &str,
    book_id: &str,
    language: &str,
) -> Result<(), String> {
    // Check if similar node exists (case-insensitive substring match)
    if let Some(existing_id) = find_node_by_name(pool, &concept.name, book_id).await? {
        // Merge: update existing node's source_chunk_ids and examples
        merge_node_sources(pool, &existing_id, source_chunk_id, &concept.examples).await?;
        return Ok(());
    }

    // No similar node found, create new one
    let node_id = uuid::Uuid::new_v4().to_string();
    let created_at = chrono::Utc::now().to_rfc3339();
    let examples_json = serde_json::to_string(&concept.examples).map_err(|e| e.to_string())?;
    let source_chunk_ids_json = serde_json::to_string(&[source_chunk_id]).map_err(|e| e.to_string())?;

    sqlx::query(
        r#"
        INSERT INTO nodes (id, book_id, name, native_term, description, examples, source_chunk_ids, language, category, is_core, page_number, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&node_id)
    .bind(book_id)
    .bind(&concept.name)
    .bind(&concept.native_term)
    .bind(&concept.description)
    .bind(&examples_json)
    .bind(&source_chunk_ids_json)
    .bind(language)
    .bind(&concept.category)
    .bind(false)  // is_core defaults to false, will be updated by core concept identification
    .bind(concept.page_number)
    .bind(&created_at)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Merge source_chunk_id and examples into an existing node
async fn merge_node_sources(
    pool: &SqlitePool,
    node_id: &str,
    new_chunk_id: &str,
    new_examples: &[String],
) -> Result<(), String> {
    // Get existing source_chunk_ids and examples
    let (existing_chunk_ids, existing_examples): (String, String) = sqlx::query_as(
        "SELECT source_chunk_ids, examples FROM nodes WHERE id = ?"
    )
    .bind(node_id)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut chunk_ids: Vec<String> = serde_json::from_str(&existing_chunk_ids).unwrap_or_default();
    let mut examples: Vec<String> = serde_json::from_str(&existing_examples).unwrap_or_default();

    // Add new chunk_id if not already present
    if !chunk_ids.contains(&new_chunk_id.to_string()) {
        chunk_ids.push(new_chunk_id.to_string());
    }

    // Add new examples if not already present
    for example in new_examples {
        if !examples.contains(example) {
            examples.push(example.clone());
        }
    }

    let updated_chunk_ids = serde_json::to_string(&chunk_ids).map_err(|e| e.to_string())?;
    let updated_examples = serde_json::to_string(&examples).map_err(|e| e.to_string())?;

    sqlx::query("UPDATE nodes SET source_chunk_ids = ?, examples = ? WHERE id = ?")
        .bind(&updated_chunk_ids)
        .bind(&updated_examples)
        .bind(node_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Find a node by name within a book (case-insensitive substring match)
async fn find_node_by_name(
    pool: &SqlitePool,
    name: &str,
    book_id: &str,
) -> Result<Option<String>, String> {
    // Try exact match first
    let exact: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM nodes WHERE book_id = ? AND LOWER(name) = LOWER(?)"
    )
    .bind(book_id)
    .bind(name)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    if let Some((id,)) = exact {
        return Ok(Some(id));
    }

    // Try substring match (A contains B or B contains A)
    let similar: Option<(String,)> = sqlx::query_as(
        r#"
        SELECT id FROM nodes WHERE book_id = ? AND (
            LOWER(name) LIKE ('%' || LOWER(?) || '%') OR
            LOWER(?) LIKE ('%' || LOWER(name) || '%')
        )
        LIMIT 1
        "#
    )
    .bind(book_id)
    .bind(name)
    .bind(name)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(similar.map(|(id,)| id))
}

/// Create an edge for an extracted relation, with deduplication
async fn create_edge_for_relation(
    pool: &SqlitePool,
    relation: &ExtractedRelation,
    book_id: &str,
    source_chunk_id: &str,
) -> Result<(), String> {
    // Find or create source node
    let source_node_id = match find_node_by_name(pool, &relation.source_name, book_id).await? {
        Some(id) => {
            // Merge chunk source into existing node (relations don't have examples, use empty vec)
            merge_node_sources(pool, &id, source_chunk_id, &[]).await?;
            id
        }
        None => {
            // Create a new node for the source concept, using relation's explanation as description
            let node_id = uuid::Uuid::new_v4().to_string();
            let created_at = chrono::Utc::now().to_rfc3339();
            let examples_json = serde_json::to_string(&Vec::<String>::new()).map_err(|e| e.to_string())?;
            let source_chunk_ids_json = serde_json::to_string(&[source_chunk_id]).map_err(|e| e.to_string())?;

            sqlx::query(
                r#"
                INSERT INTO nodes (id, book_id, name, description, examples, source_chunk_ids, language, category, is_core, page_number, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 'zh', NULL, FALSE, NULL, ?)
                "#,
            )
            .bind(&node_id)
            .bind(book_id)
            .bind(&relation.source_name)
            .bind(&relation.explanation)
            .bind(&examples_json)
            .bind(&source_chunk_ids_json)
            .bind(&created_at)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;

            node_id
        }
    };

    // Find or create target node
    let target_node_id = match find_node_by_name(pool, &relation.target_name, book_id).await? {
        Some(id) => {
            // Merge chunk source into existing node (relations don't have examples, use empty vec)
            merge_node_sources(pool, &id, source_chunk_id, &[]).await?;
            id
        }
        None => {
            // Create a new node for the target concept, using relation's explanation as description
            let node_id = uuid::Uuid::new_v4().to_string();
            let created_at = chrono::Utc::now().to_rfc3339();
            let examples_json = serde_json::to_string(&Vec::<String>::new()).map_err(|e| e.to_string())?;
            let source_chunk_ids_json = serde_json::to_string(&[source_chunk_id]).map_err(|e| e.to_string())?;

            sqlx::query(
                r#"
                INSERT INTO nodes (id, book_id, name, description, examples, source_chunk_ids, language, category, is_core, page_number, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 'zh', NULL, FALSE, NULL, ?)
                "#,
            )
            .bind(&node_id)
            .bind(book_id)
            .bind(&relation.target_name)
            .bind(&relation.explanation)
            .bind(&examples_json)
            .bind(&source_chunk_ids_json)
            .bind(&created_at)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;

            node_id
        }
    };

    // Check if edge already exists to avoid duplicates
    let existing_edge: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM edges WHERE source_node_id = ? AND target_node_id = ? AND relation_type = ?"
    )
    .bind(&source_node_id)
    .bind(&target_node_id)
    .bind(&relation.relation_type)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;

    if let Some((existing_id,)) = existing_edge {
        // Edge already exists, merge source_chunk_id into it
        merge_edge_sources(pool, &existing_id, source_chunk_id).await?;
        return Ok(());
    }

    // Create the edge
    let edge_id = uuid::Uuid::new_v4().to_string();
    let created_at = chrono::Utc::now().to_rfc3339();
    let source_chunk_ids_json = serde_json::to_string(&[source_chunk_id]).map_err(|e| e.to_string())?;

    sqlx::query(
        r#"
        INSERT INTO edges (id, source_node_id, target_node_id, relation_type, source_chunk_ids, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&edge_id)
    .bind(&source_node_id)
    .bind(&target_node_id)
    .bind(&relation.relation_type)
    .bind(&source_chunk_ids_json)
    .bind(&created_at)
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// Merge source_chunk_id into an existing edge
async fn merge_edge_sources(
    pool: &SqlitePool,
    edge_id: &str,
    new_chunk_id: &str,
) -> Result<(), String> {
    let existing_chunk_ids: String = sqlx::query_scalar(
        "SELECT source_chunk_ids FROM edges WHERE id = ?"
    )
    .bind(edge_id)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut chunk_ids: Vec<String> = serde_json::from_str(&existing_chunk_ids).unwrap_or_default();

    if !chunk_ids.contains(&new_chunk_id.to_string()) {
        chunk_ids.push(new_chunk_id.to_string());
    }

    let updated_chunk_ids = serde_json::to_string(&chunk_ids).map_err(|e| e.to_string())?;

    sqlx::query("UPDATE edges SET source_chunk_ids = ? WHERE id = ?")
        .bind(&updated_chunk_ids)
        .bind(edge_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Extract concepts from all chunks of a book
pub async fn extract_concepts_from_book(
    pool: &SqlitePool,
    book_id: &str,
) -> Result<(usize, usize), String> {
    tracing::info!("[{}] Starting concept extraction for book", book_id);

    // Get book language configuration from books table
    // 'auto' defaults to 'en' for better internationalization
    let book_language: String = sqlx::query_scalar::<_, String>(
        "SELECT language FROM books WHERE id = ?"
    )
    .bind(book_id)
    .fetch_one(pool)
    .await
    .map_err(|e| e.to_string())?;

    // Convert 'auto' to default language 'en', keep 'zh' or 'en' as-is
    let language = match book_language.as_str() {
        "zh" => "zh".to_string(),
        _ => "en".to_string(), // 'auto' or 'en' defaults to English
    };

    tracing::info!("[{}] Book language: {} (using: {})", book_id, book_language, language);

    // Get all chunks for the book
    let chunks: Vec<(String, String)> = sqlx::query_as(
        "SELECT id, content FROM chunks WHERE book_id = ?"
    )
    .bind(book_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    tracing::info!("[{}] Found {} chunks to process", book_id, chunks.len());

    if chunks.is_empty() {
        tracing::warn!("[{}] No chunks found for book", book_id);
        return Ok((0, 0));
    }

    // Use semaphore to limit concurrent requests (avoid LM Studio overload)
    let pool = pool.clone();

    // Get extract concurrency from environment variable with default
    let extract_concurrency: usize = std::env::var("EXTRACT_CONCURRENCY")
        .unwrap_or_else(|_| "4".to_string())
        .parse()
        .unwrap_or(4);
    let semaphore = Arc::new(Semaphore::new(extract_concurrency));

    // Get LLM API base URL from environment variable with default
    let llm_api_url = std::env::var("LLM_API_BASE_URL")
        .unwrap_or_else(|_| "http://localhost:1234/v1".to_string());

    let mut handles = Vec::new();

    for (chunk_id, content) in chunks {
        let pool = pool.clone();
        let llm = LlmClient::new(&llm_api_url);
        let semaphore = semaphore.clone();
        let book_id = book_id.to_string();
        let language = language.clone();
        let content_len = content.len();

        let handle = tokio::spawn(async move {
            tracing::debug!("[{}] Acquired permit, processing chunk (content len: {})", chunk_id, content_len);
            let _permit = semaphore.acquire().await.unwrap();

            tracing::info!("[{}] Processing chunk...", chunk_id);
            let result = process_chunk(
                &chunk_id,
                &content,
                &book_id,
                &language,
                &pool,
                &llm,
            ).await;

            match &result {
                Ok((nodes, edges)) => {
                    tracing::info!("[{}] Chunk processed successfully: {} nodes, {} edges", chunk_id, nodes, edges);
                }
                Err(e) => {
                    tracing::error!("[{}] Chunk processing failed: {}", chunk_id, e);
                }
            }

            result
        });

        handles.push(handle);
    }

    // Wait for all tasks to complete
    let mut total_nodes = 0;
    let mut total_edges = 0;

    tracing::info!("[{}] Waiting for {} chunk tasks to complete...", book_id, handles.len());

    for handle in handles {
        match handle.await {
            Ok(Ok((nodes, edges))) => {
                total_nodes += nodes;
                total_edges += edges;
            }
            Ok(Err(e)) => {
                tracing::warn!("[{}] Chunk processing error: {}", book_id, e);
            }
            Err(e) => {
                tracing::warn!("[{}] Task join error: {}", book_id, e);
            }
        }
    }

    tracing::info!("[{}] Extraction complete: {} total nodes, {} total edges", book_id, total_nodes, total_edges);

    // Run core concept identification after extraction is complete
    if total_nodes > 0 {
        tracing::info!("[{}] Starting core concept identification after extraction", book_id);
        match crate::core_concept::identify_core_concepts(&pool, book_id, None, None).await {
            Ok(core_ids) => {
                tracing::info!("[{}] Core concept identification complete: {} core concepts identified", book_id, core_ids.len());
            }
            Err(e) => {
                tracing::warn!("[{}] Core concept identification failed: {}. Continuing with extraction results.", book_id, e);
                // Don't fail the entire extraction if core concept identification fails
            }
        }
    } else {
        tracing::warn!("[{}] No nodes extracted, skipping core concept identification", book_id);
    }

    Ok((total_nodes, total_edges))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_concept_structure() {
        let concept = ExtractedConcept {
            name: "Test".to_string(),
            description: "A test concept".to_string(),
            examples: vec!["example1".to_string()],
            category: Some("test".to_string()),
            page_number: Some(1),
        };
        assert_eq!(concept.name, "Test");
    }
}