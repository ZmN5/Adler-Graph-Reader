use sqlx::SqlitePool;
use std::collections::HashMap;
use petgraph::graph::{NodeIndex, UnGraph};

/// Errors that can occur during core concept operations
#[derive(Debug)]
pub enum CoreConceptError {
    DatabaseError(String),
    #[allow(dead_code)]
    GraphError(String),
}

impl std::fmt::Display for CoreConceptError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CoreConceptError::DatabaseError(msg) => write!(f, "Database error: {}", msg),
            CoreConceptError::GraphError(msg) => write!(f, "Graph error: {}", msg),
        }
    }
}

impl std::error::Error for CoreConceptError {}

/// Node information for graph construction
#[derive(Debug, Clone)]
struct NodeInfo {
    id: String,
    #[allow(dead_code)]
    name: String,
    chunk_ids: Vec<String>,
}

/// Build a bipartite graph of nodes and chunks
/// Returns a graph where nodes and chunks are connected if the node appears in the chunk
fn build_node_chunk_graph(
    nodes: &[NodeInfo],
) -> (UnGraph<String, ()>, HashMap<String, NodeIndex>, HashMap<String, NodeIndex>) {
    let mut graph = UnGraph::<String, ()>::new_undirected();
    let mut node_indices: HashMap<String, NodeIndex> = HashMap::new();
    let mut chunk_indices: HashMap<String, NodeIndex> = HashMap::new();

    // First, add all nodes to the graph
    for node in nodes {
        let idx = graph.add_node(node.id.clone());
        node_indices.insert(node.id.clone(), idx);
    }

    // Add chunks and edges
    for node in nodes {
        for chunk_id in &node.chunk_ids {
            // Add chunk if not already present
            let chunk_idx = *chunk_indices.entry(chunk_id.clone()).or_insert_with(|| {
                graph.add_node(chunk_id.clone())
            });

            // Add edge between node and chunk
            let node_idx = node_indices[&node.id];
            graph.add_edge(node_idx, chunk_idx, ());
        }
    }

    (graph, node_indices, chunk_indices)
}

/// Detect communities using a simplified Louvain-like algorithm
/// Returns a HashMap mapping node_id -> community_id
fn detect_communities(
    graph: &UnGraph<String, ()>,
    node_indices: &HashMap<String, NodeIndex>,
) -> HashMap<String, usize> {
    let mut communities: HashMap<String, usize> = HashMap::new();

    // Initialize each node to its own community
    for (next_community_id, node_id) in node_indices.keys().enumerate() {
        communities.insert(node_id.clone(), next_community_id);
    }

    // Simple greedy community detection based on edge connectivity
    // In each iteration, try to merge nodes that are highly connected
    let max_iterations = 10;
    for _ in 0..max_iterations {
        let mut changed = false;

        for (node_id, node_idx) in node_indices {
            let current_comm = *communities.get(node_id).unwrap_or(&0);

            // Count neighbors in each community
            let mut neighbor_comm_counts: HashMap<usize, usize> = HashMap::new();
            for neighbor in graph.neighbors(*node_idx) {
                // Find which node_id this neighbor corresponds to
                for (nid, nidx) in node_indices {
                    if *nidx == neighbor && nid != node_id {
                        let Some(&comm) = communities.get(nid) else { continue };
                        *neighbor_comm_counts.entry(comm).or_insert(0) += 1;
                        break;
                    }
                }
            }

            // Find the community with most neighbors
            if let Some((best_comm, count)) = neighbor_comm_counts.iter().max_by_key(|(_, c)| *c) {
                if *count > 1 && *best_comm != current_comm {
                    communities.insert(node_id.clone(), *best_comm);
                    changed = true;
                }
            }
        }

        if !changed {
            break;
        }
    }

    // Renumber communities to be 0..n
    let mut comm_id_map: HashMap<usize, usize> = HashMap::new();
    let mut next_id = 0usize;
    for (_, comm_id) in communities.iter_mut() {
        let new_id = *comm_id_map.entry(*comm_id).or_insert_with(|| {
            let id = next_id;
            next_id += 1;
            id
        });
        *comm_id = new_id;
    }

    communities
}

/// Calculate community centrality (how central a node is within its community)
fn calculate_community_centrality(
    graph: &UnGraph<String, ()>,
    node_indices: &HashMap<String, NodeIndex>,
    communities: &HashMap<String, usize>,
) -> HashMap<String, f64> {
    let mut centrality_scores: HashMap<String, f64> = HashMap::new();

    // Group nodes by community
    let mut community_nodes: HashMap<usize, Vec<String>> = HashMap::new();
    for (node_id, comm_id) in communities {
        community_nodes.entry(*comm_id).or_default().push(node_id.clone());
    }

    // For each node, calculate its centrality within its community
    for (node_id, node_idx) in node_indices {
        let Some(&comm_id) = communities.get(node_id) else { continue };
        let Some(comm_nodes) = community_nodes.get(&comm_id) else { continue };

        // Count connections to other nodes in the same community
        let mut intra_community_degree = 0usize;
        for neighbor in graph.neighbors(*node_idx) {
            for (nid, nidx) in node_indices {
                if *nidx == neighbor && nid != node_id {
                    if communities.get(nid) == Some(&comm_id) {
                        intra_community_degree += 1;
                    }
                    break;
                }
            }
        }

        // Centrality = intra-community degree / (community size - 1)
        let comm_size = comm_nodes.len();
        let centrality = if comm_size > 1 {
            intra_community_degree as f64 / (comm_size - 1) as f64
        } else {
            1.0 // Single node community, maximum centrality
        };

        centrality_scores.insert(node_id.clone(), centrality);
    }

    centrality_scores
}

/// Calculate coverage density (how many unique chunks a node covers)
fn calculate_coverage_density(
    nodes: &[NodeInfo],
) -> HashMap<String, f64> {
    // Collect all unique chunks
    let mut all_chunks: std::collections::HashSet<String> = std::collections::HashSet::new();
    for node in nodes {
        for chunk_id in &node.chunk_ids {
            all_chunks.insert(chunk_id.clone());
        }
    }
    let total_chunks = all_chunks.len().max(1) as f64;

    let mut coverage_scores: HashMap<String, f64> = HashMap::new();
    for node in nodes {
        let coverage = node.chunk_ids.len() as f64 / total_chunks;
        coverage_scores.insert(node.id.clone(), coverage);
    }

    coverage_scores
}

/// Calculate enhanced scores combining PageRank, community centrality, and coverage
fn calculate_enhanced_scores(
    node_ids: &[String],
    pagerank_scores: &HashMap<String, f64>,
    community_scores: &HashMap<String, f64>,
    coverage_scores: &HashMap<String, f64>,
    frequency_scores: &HashMap<String, usize>,
) -> HashMap<String, f64> {
    // Normalize frequency scores
    let max_freq = frequency_scores.values().copied().max().unwrap_or(1) as f64;

    let mut enhanced_scores: HashMap<String, f64> = HashMap::new();

    for node_id in node_ids {
        let pagerank = *pagerank_scores.get(node_id).unwrap_or(&0.0);
        let community = *community_scores.get(node_id).unwrap_or(&0.0);
        let coverage = *coverage_scores.get(node_id).unwrap_or(&0.0);
        let frequency = *frequency_scores.get(node_id).unwrap_or(&0) as f64 / max_freq;

        // Weighted combination
        // 30% PageRank, 30% community centrality, 20% coverage, 20% frequency
        let enhanced_score = 0.3 * pagerank
            + 0.3 * community
            + 0.2 * coverage
            + 0.2 * frequency;

        enhanced_scores.insert(node_id.clone(), enhanced_score);
    }

    enhanced_scores
}

/// Identify core concepts using community detection algorithm (v2)
/// Returns the list of core concept node IDs
pub async fn identify_core_concepts_v2(
    pool: &SqlitePool,
    book_id: &str,
    top_n_percent: Option<f64>,
) -> Result<Vec<String>, CoreConceptError> {
    // Fetch all nodes for this book
    let node_rows: Vec<(String, String, Option<String>, String)> = sqlx::query_as(
        "SELECT id, name, description, source_chunk_ids FROM nodes WHERE book_id = ?"
    )
    .bind(book_id)
    .fetch_all(pool)
    .await
    .map_err(|e| CoreConceptError::DatabaseError(e.to_string()))?;

    if node_rows.is_empty() {
        tracing::info!("[{}] No nodes found for core concept identification", book_id);
        return Ok(vec![]);
    }

    // Build NodeInfo list
    let nodes: Vec<NodeInfo> = node_rows
        .into_iter()
        .map(|(id, name, _desc, chunk_ids_json)| {
            let chunk_ids: Vec<String> = serde_json::from_str(&chunk_ids_json).unwrap_or_default();
            NodeInfo {
                id,
                name,
                chunk_ids,
            }
        })
        .collect();

    let node_ids: Vec<String> = nodes.iter().map(|n| n.id.clone()).collect();

    tracing::info!("[{}] Identifying core concepts from {} nodes using community detection", book_id, node_ids.len());

    // Build node-chunk bipartite graph
    let (graph, node_indices, _chunk_indices) = build_node_chunk_graph(&nodes);

    // Detect communities
    let communities = detect_communities(&graph, &node_indices);
    tracing::info!("[{}] Detected {} communities", book_id, communities.values().max().map(|m| m + 1).unwrap_or(0));

    // Calculate community centrality scores
    let community_centrality = calculate_community_centrality(&graph, &node_indices, &communities);

    // Calculate coverage density scores
    let coverage_scores = calculate_coverage_density(&nodes);

    // Get frequency scores
    let frequency_scores = get_frequency_scores(pool, book_id).await?;

    // Calculate PageRank scores using petgraph
    let pagerank_map = calculate_pagerank_petgraph(&graph, &node_indices, &node_ids)?;

    // Calculate enhanced scores
    let enhanced_scores = calculate_enhanced_scores(
        &node_ids,
        &pagerank_map,
        &community_centrality,
        &coverage_scores,
        &frequency_scores,
    );

    // Sort by enhanced score descending
    let mut scored_nodes: Vec<(String, f64)> = enhanced_scores
        .into_iter()
        .collect();
    scored_nodes.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    // Determine how many nodes to mark as core
    let percent = top_n_percent.unwrap_or(0.1); // Default: top 10%
    let core_count = ((node_ids.len() as f64 * percent) as usize).max(1).min(node_ids.len());

    let core_node_ids: Vec<String> = scored_nodes
        .into_iter()
        .take(core_count)
        .map(|(id, score)| {
            tracing::debug!("Core concept candidate (v2): {} (score: {:.4})", id, score);
            id
        })
        .collect();

    tracing::info!("[{}] Identified {} core concepts out of {} total using v2 algorithm", book_id, core_node_ids.len(), node_ids.len());

    // Update database to mark core concepts
    // First, reset all nodes for this book to is_core = false
    sqlx::query("UPDATE nodes SET is_core = FALSE WHERE book_id = ?")
        .bind(book_id)
        .execute(pool)
        .await
        .map_err(|e| CoreConceptError::DatabaseError(e.to_string()))?;

    // Then, mark the selected nodes as core
    for node_id in &core_node_ids {
        sqlx::query("UPDATE nodes SET is_core = TRUE WHERE id = ?")
            .bind(node_id)
            .execute(pool)
            .await
            .map_err(|e| CoreConceptError::DatabaseError(e.to_string()))?;
    }

    Ok(core_node_ids)
}

/// Calculate PageRank using the existing pagerank implementation
fn calculate_pagerank_petgraph(
    graph: &UnGraph<String, ()>,
    node_indices: &HashMap<String, NodeIndex>,
    node_ids: &[String],
) -> Result<HashMap<String, f64>, CoreConceptError> {
    // Build edge list from the graph
    let mut edges: Vec<(String, String)> = Vec::new();
    for edge in graph.edge_indices() {
        let Some((a, b)) = graph.edge_endpoints(edge) else { continue };
        // Find node_ids for these indices
        let node_a = node_indices.iter().find(|(_, idx)| **idx == a).map(|(id, _)| id.clone());
        let node_b = node_indices.iter().find(|(_, idx)| **idx == b).map(|(id, _)| id.clone());
        if let (Some(a_id), Some(b_id)) = (node_a, node_b) {
            edges.push((a_id, b_id));
        }
    }

    // Use the existing calculate_pagerank function
    let scores = calculate_pagerank(node_ids, &edges, 0.85, 20);

    Ok(scores)
}

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
) -> Result<HashMap<String, usize>, CoreConceptError> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT id, source_chunk_ids FROM nodes WHERE book_id = ?"
    )
    .bind(book_id)
    .fetch_all(pool)
    .await
    .map_err(|e| CoreConceptError::DatabaseError(e.to_string()))?;

    let mut frequencies: HashMap<String, usize> = HashMap::new();

    for (node_id, chunk_ids_json) in rows {
        let chunk_ids: Vec<String> = serde_json::from_str(&chunk_ids_json).unwrap_or_default();
        frequencies.insert(node_id, chunk_ids.len());
    }

    Ok(frequencies)
}

/// Calculate composite scores and identify core concepts
/// Returns the list of core concept node IDs
/// This function now delegates to the v2 implementation using community detection
pub async fn identify_core_concepts(
    pool: &SqlitePool,
    book_id: &str,
    top_n_percent: Option<f64>,
    _fixed_count: Option<usize>,
) -> Result<Vec<String>, CoreConceptError> {
    // Delegate to the v2 implementation with community detection
    // The fixed_count parameter is deprecated in favor of top_n_percent
    identify_core_concepts_v2(pool, book_id, top_n_percent.or(Some(0.1))).await
}

/// Get core concepts with their details
/// Reserved for future API use - returns core concepts with full metadata and scores.
#[derive(Debug, serde::Serialize)]
#[allow(dead_code)]
pub struct CoreConcept {
    pub id: String,
    pub name: String,
    pub description: String,
    pub examples: Vec<String>,
    pub page_number: Option<i32>,
    pub frequency: usize,
    pub score: f64,
}

/// Fetch core concepts with their details for a book.
/// Reserved for future API endpoint - currently unused but kept for planned concept browsing feature.
#[allow(dead_code)]
#[allow(clippy::type_complexity)]
pub async fn get_core_concepts(
    pool: &SqlitePool,
    book_id: &str,
) -> Result<Vec<CoreConcept>, CoreConceptError> {
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
    .map_err(|e| CoreConceptError::DatabaseError(e.to_string()))?;

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
