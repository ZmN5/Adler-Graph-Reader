use axum::{
    Json,
    extract::{Path, State},
};
use sqlx::SqlitePool;
use serde::Serialize;

use super::{AppError};

#[derive(Serialize)]
pub struct GraphNode {
    pub id: String,
    pub name: String,
    pub description: String,
    pub examples: Vec<String>,
    pub source_chunk_ids: Vec<String>,
    pub is_core: bool,
    pub category: Option<String>,
}

#[derive(Serialize)]
pub struct GraphEdge {
    pub id: String,
    pub source_node_id: String,
    pub target_node_id: String,
    pub relation_type: String,
}

#[derive(Serialize)]
pub struct GraphResponse {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
}

pub async fn get_book_graph(
    Path(book_id): Path<String>,
    pool: State<SqlitePool>,
) -> Result<Json<GraphResponse>, AppError> {
    // Verify book exists
    let book_exists: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM books WHERE id = ?"
    )
    .bind(&book_id)
    .fetch_optional(&*pool)
    .await?;

    if book_exists.is_none() {
        return Err(AppError::NotFound("Book not found".to_string()));
    }

    // Fetch all nodes for this book
    let node_rows: Vec<(String, String, Option<String>, String, String, bool, Option<String>)> = sqlx::query_as(
        "SELECT id, name, description, examples, source_chunk_ids, is_core, category FROM nodes WHERE book_id = ?"
    )
    .bind(&book_id)
    .fetch_all(&*pool)
    .await?;

    // Get node IDs for edge filtering
    let node_ids: Vec<String> = node_rows.iter().map(|(id, _, _, _, _, _, _)| id.clone()).collect();

    // Fetch all edges where both source and target belong to this book
    let edge_rows: Vec<(String, String, String, String)> = if node_ids.is_empty() {
        vec![]
    } else {
        // Build query with placeholders for node IDs
        let placeholders: Vec<&str> = node_ids.iter().map(|_| "?").collect();
        let query = format!(
            "SELECT id, source_node_id, target_node_id, relation_type FROM edges WHERE source_node_id IN ({}) AND target_node_id IN ({})",
            placeholders.join(","),
            placeholders.join(",")
        );
        let mut query_builder = sqlx::query_as::<_, (String, String, String, String)>(&query);
        for id in &node_ids {
            query_builder = query_builder.bind(id);
        }
        for id in &node_ids {
            query_builder = query_builder.bind(id);
        }
        query_builder.fetch_all(&*pool).await?
    };

    let nodes: Vec<GraphNode> = node_rows
        .into_iter()
        .map(|(id, name, description, examples, source_chunk_ids, is_core, category)| {
            let examples: Vec<String> = serde_json::from_str(&examples)
                .map_err(|e| tracing::warn!("Failed to parse examples JSON for node '{}': {}", name, e))
                .unwrap_or_default();
            let source_chunk_ids: Vec<String> = serde_json::from_str(&source_chunk_ids)
                .map_err(|e| tracing::warn!("Failed to parse source_chunk_ids JSON for node '{}': {}", name, e))
                .unwrap_or_default();
            GraphNode {
                id,
                name,
                description: description.unwrap_or_default(),
                examples,
                source_chunk_ids,
                is_core,
                category,
            }
        })
        .collect();

    let edges: Vec<GraphEdge> = edge_rows
        .into_iter()
        .map(|(id, source_node_id, target_node_id, relation_type)| GraphEdge {
            id,
            source_node_id,
            target_node_id,
            relation_type,
        })
        .collect();

    Ok(Json(GraphResponse { nodes, edges }))
}

pub async fn get_global_graph(
    pool: State<SqlitePool>,
) -> Result<Json<GraphResponse>, AppError> {
    // Fetch all nodes
    let node_rows: Vec<(String, String, Option<String>, String, String, bool, Option<String>)> = sqlx::query_as(
        "SELECT id, name, description, examples, source_chunk_ids, is_core, category FROM nodes"
    )
    .fetch_all(&*pool)
    .await?;

    // Fetch all edges
    let edge_rows: Vec<(String, String, String, String)> = sqlx::query_as(
        "SELECT id, source_node_id, target_node_id, relation_type FROM edges"
    )
    .fetch_all(&*pool)
    .await?;

    let nodes: Vec<GraphNode> = node_rows
        .into_iter()
        .map(|(id, name, description, examples, source_chunk_ids, is_core, category)| {
            let examples: Vec<String> = serde_json::from_str(&examples)
                .map_err(|e| tracing::warn!("Failed to parse examples JSON for node '{}': {}", name, e))
                .unwrap_or_default();
            let source_chunk_ids: Vec<String> = serde_json::from_str(&source_chunk_ids)
                .map_err(|e| tracing::warn!("Failed to parse source_chunk_ids JSON for node '{}': {}", name, e))
                .unwrap_or_default();
            GraphNode {
                id,
                name,
                description: description.unwrap_or_default(),
                examples,
                source_chunk_ids,
                is_core,
                category,
            }
        })
        .collect();

    let edges: Vec<GraphEdge> = edge_rows
        .into_iter()
        .map(|(id, source_node_id, target_node_id, relation_type)| GraphEdge {
            id,
            source_node_id,
            target_node_id,
            relation_type,
        })
        .collect();

    Ok(Json(GraphResponse { nodes, edges }))
}

#[derive(Serialize)]
pub struct NodeDetails {
    pub id: String,
    pub book_id: Option<String>,
    pub name: String,
    pub native_term: Option<String>,
    pub description: String,
    pub examples: Vec<String>,
    pub source_chunk_ids: Vec<String>,
    pub language: String,
    pub category: Option<String>,
    pub page_number: Option<i32>,
}

pub async fn get_node(
    Path(node_id): Path<String>,
    pool: State<SqlitePool>,
) -> Result<Json<NodeDetails>, AppError> {
    let row: (String, Option<String>, String, Option<String>, Option<String>, String, String, String, Option<String>, Option<i32>) = sqlx::query_as(
        "SELECT id, book_id, name, native_term, description, examples, source_chunk_ids, language, category, page_number FROM nodes WHERE id = ?"
    )
    .bind(&node_id)
    .fetch_one(&*pool)
    .await
    .map_err(|_| AppError::NotFound("Node not found".to_string()))?;

    let examples: Vec<String> = serde_json::from_str(&row.5)
        .map_err(|e| tracing::warn!("Failed to parse examples JSON for node '{}': {}", row.2, e))
        .unwrap_or_default();
    let source_chunk_ids: Vec<String> = serde_json::from_str(&row.6)
        .map_err(|e| tracing::warn!("Failed to parse source_chunk_ids JSON for node '{}': {}", row.2, e))
        .unwrap_or_default();

    Ok(Json(NodeDetails {
        id: row.0,
        book_id: row.1,
        name: row.2,
        native_term: row.3,
        description: row.4.unwrap_or_default(),
        examples,
        source_chunk_ids,
        language: row.7,
        category: row.8,
        page_number: row.9,
    }))
}

// Extraction-related types
#[derive(Serialize)]
pub struct ExtractResponse {
    pub status: String,
    pub nodes_count: usize,
    pub edges_count: usize,
    pub core_concepts_count: usize,
}

pub async fn extract_book(
    Path(book_id): Path<String>,
    pool: State<SqlitePool>,
) -> Result<Json<ExtractResponse>, AppError> {
    // Verify book exists
    let book_exists: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM books WHERE id = ?"
    )
    .bind(&book_id)
    .fetch_optional(&*pool)
    .await?;

    if book_exists.is_none() {
        return Err(AppError::NotFound("Book not found".to_string()));
    }

    // Check if book has chunks
    let chunk_count: Option<i64> = sqlx::query_scalar(
        "SELECT COUNT(*) FROM chunks WHERE book_id = ?"
    )
    .bind(&book_id)
    .fetch_optional(&*pool)
    .await?;

    if chunk_count.unwrap_or(0) == 0 {
        return Err(AppError::BadRequest(format!(
            "Book has no chunks. Please parse the book first via POST /api/books/{}/parse.",
            book_id
        )));
    }

    // Run extraction
    match crate::extractor::extract_concepts_from_book(&pool, &book_id).await {
        Ok((nodes_count, edges_count)) => {
            // Get core concepts count after extraction
            let core_count: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM nodes WHERE book_id = ? AND is_core = TRUE"
            )
            .bind(&book_id)
            .fetch_one(&*pool)
            .await
            .unwrap_or(0);

            // Get model config for embedding
            let model_config = crate::config::get_model_config(&pool)
                .await
                .unwrap_or_else(|_| crate::config::ModelConfig {
                    embedding_model: "text-embedding-qwen3-embedding-0.6b".to_string(),
                    embedding_url: "http://localhost:1234/v1/embeddings".to_string(),
                    llm_model: "qwen3.5-9b".to_string(),
                    llm_api_url: "http://localhost:1234/v1".to_string(),
                    reranker_model: "qwen3.5-9b".to_string(),
                    api_key: "lm-studio".to_string(),
                });

            // Auto-rebuild FTS index and generate embeddings after extraction
            let _fts_count = crate::embedding::rebuild_fts_index(&pool, &book_id)
                .await
                .unwrap_or(0);
            let _embedding_count = crate::embedding::generate_chunk_embeddings(
                &pool,
                &book_id,
                &model_config.embedding_model,
                &model_config.embedding_url,
                &model_config.api_key,
            )
            .await
            .unwrap_or(0);

            tracing::info!(
                "[extract_book] Auto-built indexes for book {}: fts={}, embeddings={}",
                book_id, _fts_count, _embedding_count
            );

            Ok(Json(ExtractResponse {
                status: "completed".to_string(),
                nodes_count,
                edges_count,
                core_concepts_count: core_count as usize,
            }))
        }
        Err(e) => Err(AppError::Internal(format!("Extraction failed: {}", e))),
    }
}

// Core concept-related types
#[derive(Serialize)]
pub struct IdentifyCoreConceptsResponse {
    pub status: String,
    pub core_concepts_count: usize,
}

pub async fn get_core_concepts(
    Path(book_id): Path<String>,
    pool: State<SqlitePool>,
) -> Result<Json<Vec<GraphNode>>, AppError> {
    // Verify book exists
    let book_exists: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM books WHERE id = ?"
    )
    .bind(&book_id)
    .fetch_optional(&*pool)
    .await?;

    if book_exists.is_none() {
        return Err(AppError::NotFound("Book not found".to_string()));
    }

    // Get core concepts - query returns nodes with is_core = TRUE
    let node_rows: Vec<(String, String, Option<String>, String, String, bool, Option<String>)> = sqlx::query_as(
        "SELECT id, name, description, examples, source_chunk_ids, is_core, category FROM nodes WHERE book_id = ? AND is_core = TRUE ORDER BY name"
    )
    .bind(&book_id)
    .fetch_all(&*pool)
    .await?;

    let nodes: Vec<GraphNode> = node_rows
        .into_iter()
        .map(|(id, name, description, examples, source_chunk_ids, is_core, category)| {
            let examples: Vec<String> = serde_json::from_str(&examples)
                .map_err(|e| tracing::warn!("Failed to parse examples JSON for node '{}': {}", name, e))
                .unwrap_or_default();
            let source_chunk_ids: Vec<String> = serde_json::from_str(&source_chunk_ids)
                .map_err(|e| tracing::warn!("Failed to parse source_chunk_ids JSON for node '{}': {}", name, e))
                .unwrap_or_default();
            GraphNode {
                id,
                name,
                description: description.unwrap_or_default(),
                examples,
                source_chunk_ids,
                is_core,
                category,
            }
        })
        .collect();

    Ok(Json(nodes))
}

pub async fn identify_core_concepts(
    Path(book_id): Path<String>,
    pool: State<SqlitePool>,
) -> Result<Json<IdentifyCoreConceptsResponse>, AppError> {
    // Verify book exists
    let book_exists: Option<(String,)> = sqlx::query_as(
        "SELECT id FROM books WHERE id = ?"
    )
    .bind(&book_id)
    .fetch_optional(&*pool)
    .await?;

    if book_exists.is_none() {
        return Err(AppError::NotFound("Book not found".to_string()));
    }

    // Check if book has nodes
    let node_count: Option<i64> = sqlx::query_scalar(
        "SELECT COUNT(*) FROM nodes WHERE book_id = ?"
    )
    .bind(&book_id)
    .fetch_optional(&*pool)
    .await?;

    if node_count.unwrap_or(0) == 0 {
        return Err(AppError::BadRequest("Book has no concepts to analyze. Extract concepts first.".to_string()));
    }

    // Run core concept identification
    let core_ids = crate::core_concept::identify_core_concepts(&pool, &book_id, None, None)
        .await?;

    Ok(Json(IdentifyCoreConceptsResponse {
        status: "completed".to_string(),
        core_concepts_count: core_ids.len(),
    }))
}
