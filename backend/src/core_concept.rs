use sqlx::SqlitePool;
use std::collections::HashMap;

/// Calculate PageRank scores for nodes in a graph
/// Returns a HashMap mapping node_id -> PageRank score
fn calculate_pagerank(
    node_ids: &[String],
    edges: &[(String, String)], // (source_id, target_id) pairs
    damping_factor: f64,
    iterations: usize,
) -> HashMap<String, f64> {
    let n = node_ids.len();
    if n == 0 {
        return HashMap::new();
    }

    // Build adjacency list: node -> nodes it points to
    let mut outgoing: HashMap<String, Vec<String>> = HashMap::new();
    let mut incoming: HashMap<String, Vec<String>> = HashMap::new();

    for (source, target) in edges {
        outgoing.entry(source.clone()).or_default().push(target.clone());
        incoming.entry(target.clone()).or_default().push(source.clone());
    }

    // Initialize PageRank scores uniformly
    let initial_score = 1.0 / n as f64;
    let mut scores: HashMap<String, f64> = node_ids
        .iter()
        .map(|id| (id.clone(), initial_score))
        .collect();

    // Power iteration
    for _ in 0..iterations {
        let mut new_scores: HashMap<String, f64> = HashMap::new();

        for node_id in node_ids {
            let incoming_score: f64 = incoming
                .get(node_id)
                .unwrap_or(&vec![])
                .iter()
                .map(|source_id| {
                    let out_degree = outgoing.get(source_id).map(|v| v.len()).unwrap_or(0);
                    if out_degree > 0 {
                        scores.get(source_id).unwrap_or(&0.0) / out_degree as f64
                    } else {
                        0.0
                    }
                })
                .sum();

            let new_score = (1.0 - damping_factor) / n as f64 + damping_factor * incoming_score;
            new_scores.insert(node_id.clone(), new_score);
        }

        scores = new_scores;
    }

    scores
}

/// Get frequency scores for nodes (how many chunks reference each node)
async fn get_frequency_scores(
    pool: &SqlitePool,
    book_id: &str,
) -> Result<HashMap<String, usize>, String> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT id, source_chunk_ids FROM nodes WHERE book_id = ?"
    )
    .bind(book_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    let mut frequencies: HashMap<String, usize> = HashMap::new();

    for (node_id, chunk_ids_json) in rows {
        let chunk_ids: Vec<String> = serde_json::from_str(&chunk_ids_json).unwrap_or_default();
        frequencies.insert(node_id, chunk_ids.len());
    }

    Ok(frequencies)
}

/// Calculate composite scores and identify core concepts
/// Returns the list of core concept node IDs
pub async fn identify_core_concepts(
    pool: &SqlitePool,
    book_id: &str,
    top_n_percent: Option<f64>,
    fixed_count: Option<usize>,
) -> Result<Vec<String>, String> {
    // Fetch all nodes for this book
    let node_rows: Vec<(String, String, Option<String>, String)> = sqlx::query_as(
        "SELECT id, name, description, source_chunk_ids FROM nodes WHERE book_id = ?"
    )
    .bind(book_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    if node_rows.is_empty() {
        tracing::info!("[{}] No nodes found for core concept identification", book_id);
        return Ok(vec![]);
    }

    let node_ids: Vec<String> = node_rows.iter().map(|(id, _, _, _)| id.clone()).collect();
    let node_names: HashMap<String, String> = node_rows
        .iter()
        .map(|(id, name, _, _)| (id.clone(), name.clone()))
        .collect();

    tracing::info!("[{}] Identifying core concepts from {} nodes", book_id, node_ids.len());

    // Get frequency scores
    let frequency_scores = get_frequency_scores(pool, book_id).await?;

    // Fetch all edges for PageRank calculation
    let edge_rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT source_node_id, target_node_id FROM edges WHERE source_node_id IN (SELECT id FROM nodes WHERE book_id = ?) AND target_node_id IN (SELECT id FROM nodes WHERE book_id = ?)"
    )
    .bind(book_id)
    .bind(book_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    // Calculate PageRank scores
    let pagerank_scores = calculate_pagerank(&node_ids, &edge_rows, 0.85, 20);

    // Normalize scores to 0-1 range
    let max_freq = frequency_scores.values().copied().max().unwrap_or(1) as f64;
    let max_pagerank = pagerank_scores.values().copied().max_by(|a, b| a.partial_cmp(b).unwrap()).unwrap_or(1.0);

    // Calculate composite scores
    // Weight: 50% frequency, 50% PageRank
    let mut scored_nodes: Vec<(String, f64)> = node_ids
        .iter()
        .map(|id| {
            let freq_norm = *frequency_scores.get(id).unwrap_or(&0) as f64 / max_freq;
            let pagerank_norm = pagerank_scores.get(id).unwrap_or(&0.0) / max_pagerank;
            let composite_score = 0.5 * freq_norm + 0.5 * pagerank_norm;
            (id.clone(), composite_score)
        })
        .collect();

    // Sort by composite score descending
    scored_nodes.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());

    // Determine how many nodes to mark as core
    let core_count = if let Some(count) = fixed_count {
        count.min(node_ids.len())
    } else if let Some(percent) = top_n_percent {
        ((node_ids.len() as f64 * percent) as usize).max(1).min(node_ids.len())
    } else {
        // Default: top 20% or at least 5, at most 20
        ((node_ids.len() as f64 * 0.2) as usize).max(5).min(20).min(node_ids.len())
    };

    let core_node_ids: Vec<String> = scored_nodes
        .into_iter()
        .take(core_count)
        .map(|(id, score)| {
            tracing::debug!("Core concept candidate: {} (score: {:.4})", node_names.get(&id).unwrap_or(&id), score);
            id
        })
        .collect();

    tracing::info!("[{}] Identified {} core concepts out of {} total", book_id, core_node_ids.len(), node_ids.len());

    // Update database to mark core concepts
    // First, reset all nodes for this book to is_core = false
    sqlx::query("UPDATE nodes SET is_core = FALSE WHERE book_id = ?")
        .bind(book_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    // Then, mark the selected nodes as core
    for node_id in &core_node_ids {
        sqlx::query("UPDATE nodes SET is_core = TRUE WHERE id = ?")
            .bind(node_id)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;
    }

    Ok(core_node_ids)
}

/// Get core concepts with their details
#[derive(Debug, serde::Serialize)]
pub struct CoreConcept {
    pub id: String,
    pub name: String,
    pub description: String,
    pub examples: Vec<String>,
    pub page_number: Option<i32>,
    pub frequency: usize,
    pub score: f64,
}

pub async fn get_core_concepts(
    pool: &SqlitePool,
    book_id: &str,
) -> Result<Vec<CoreConcept>, String> {
    let rows: Vec<(String, String, Option<String>, String, Option<i32>, String)> = sqlx::query_as(
        r#"
        SELECT id, name, description, examples, page_number, source_chunk_ids
        FROM nodes
        WHERE book_id = ? AND is_core = TRUE
        ORDER BY name
        "#
    )
    .bind(book_id)
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;

    // Calculate scores for sorting
    let frequency_scores = get_frequency_scores(pool, book_id).await?;

    let mut concepts: Vec<CoreConcept> = rows
        .into_iter()
        .map(|(id, name, description, examples, page_number, _chunk_ids)| {
            let examples: Vec<String> = serde_json::from_str(&examples).unwrap_or_default();
            let frequency = frequency_scores.get(&id).copied().unwrap_or(0);
            CoreConcept {
                id,
                name,
                description: description.unwrap_or_default(),
                examples,
                page_number,
                frequency,
                score: 0.0, // Will be updated if needed
            }
        })
        .collect();

    // Sort by frequency (descending) as a simple ranking
    concepts.sort_by(|a, b| b.frequency.cmp(&a.frequency));

    Ok(concepts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pagerank_simple() {
        // Create a simple graph: A -> B, B -> C, C -> A (cycle)
        let node_ids = vec!["A".to_string(), "B".to_string(), "C".to_string()];
        let edges = vec![
            ("A".to_string(), "B".to_string()),
            ("B".to_string(), "C".to_string()),
            ("C".to_string(), "A".to_string()),
        ];

        let scores = calculate_pagerank(&node_ids, &edges, 0.85, 100);

        // All nodes should have similar scores in a cycle
        assert!(scores.contains_key("A"));
        assert!(scores.contains_key("B"));
        assert!(scores.contains_key("C"));

        let a_score = scores.get("A").unwrap();
        let b_score = scores.get("B").unwrap();
        let c_score = scores.get("C").unwrap();

        // Scores should be positive and sum to approximately 1
        assert!(*a_score > 0.0);
        assert!(*b_score > 0.0);
        assert!(*c_score > 0.0);

        let sum = *a_score + *b_score + *c_score;
        assert!((sum - 1.0).abs() < 0.01);
    }

    #[test]
    fn test_pagerank_empty() {
        let node_ids: Vec<String> = vec![];
        let edges: Vec<(String, String)> = vec![];
        let scores = calculate_pagerank(&node_ids, &edges, 0.85, 20);
        assert!(scores.is_empty());
    }

    #[test]
    fn test_pagerank_single_node() {
        let node_ids = vec!["A".to_string()];
        let edges: Vec<(String, String)> = vec![];
        let scores = calculate_pagerank(&node_ids, &edges, 0.85, 20);
        // Single node with no edges has PageRank = (1-damping)/n = 0.15
        assert!(scores.contains_key("A"));
        let score = *scores.get("A").unwrap();
        assert!(score > 0.0 && score <= 1.0);
    }
}
