"""Graph visualization and export routes for the API."""

import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, status

from ...database import get_admin_connection, get_themes, get_concepts, get_relations
from ...knowledge.graph import KnowledgeGraph
from ..models import (
    GraphDataResponse,
    GraphExportRequest,
    GraphExportResponse,
    GraphStatsResponse,
    GraphVisualizationResponse,
    GraphNode,
    GraphEdge,
)

router = APIRouter(prefix="/graph", tags=["graph"])


@router.get(
    "",
    response_model=GraphDataResponse,
    summary="Get graph data for all documents or specific document",
    description="Retrieve complete graph data (nodes and edges) for visualizing the knowledge graph. If document_id is provided, returns data for that document only.",
)
async def get_graph_data(document_id: str | None = Query(None, description="Optional document ID to filter by")):
    """Get graph data for a document.

    Args:
        document_id: The document ID

    Returns:
        Complete graph data with themes, concepts, relations
    """
    conn = None
    try:
        conn = get_admin_connection()

        # Get themes directly from database
        themes = get_themes(conn, document_id)
        themes_data = [
            {
                "id": t["id"],
                "name": t["name"],
                "description": t.get("description"),
                "importance_score": t.get("importance_score", 0.5),
            }
            for t in themes
        ]

        # Get concepts directly from database
        concepts = get_concepts(conn, document_id)
        concepts_data = [
            {
                "id": c["id"],
                "name": c["name"],
                "definition": c["definition"],
                "category": c.get("category", "concept"),
                "importance_score": c.get("importance_score", 0.5),
                "theme_id": c.get("theme_id"),
            }
            for c in concepts
        ]

        # Get relations directly from database
        relations = get_relations(conn, document_id)
        relations_data = [
            {
                "id": r["id"],
                "source_concept_id": r["source_concept_id"],
                "target_concept_id": r["target_concept_id"],
                "relation_type": r["relation_type"],
                "strength": r.get("strength", 0.5),
                "evidence": r.get("evidence"),
            }
            for r in relations
        ]

        return GraphDataResponse(
            document_id=document_id if document_id else "all",
            themes=themes_data,
            concepts=concepts_data,
            relations=relations_data,
            stats={
                "theme_count": len(themes_data),
                "concept_count": len(concepts_data),
                "relation_count": len(relations_data),
            },
        )

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve graph data: {str(e)}",
        )
    finally:
        if conn:
            conn.close()


@router.get(
    "/visualization",
    response_model=GraphVisualizationResponse,
    summary="Get graph in visualization format",
    description="Get graph formatted for D3.js or other visualization libraries.",
)
async def get_graph_visualization(
    document_id: str | None = Query(None, description="Optional document ID to filter by"),
    include_themes: bool = Query(True, description="Include theme nodes"),
    min_importance: float = Query(
        0.0, ge=0.0, le=1.0, description="Minimum importance score"
    ),
):
    """Get graph formatted for visualization libraries like D3.js.

    Args:
        document_id: The document ID
        include_themes: Whether to include theme nodes
        min_importance: Minimum importance score for filtering

    Returns:
        Graph in nodes/edges format
    """
    conn = None
    try:
        conn = get_admin_connection()
        kg = KnowledgeGraph(conn)

        # Get graph data
        graph = kg.to_visualization(document_id)

        # Filter by importance if specified
        nodes = []
        node_ids = set()

        for node in graph.nodes:
            if node.importance >= min_importance:
                if node.node_type == "theme" and not include_themes:
                    continue

                node_data = GraphNode(
                    id=node.id,
                    label=node.label,
                    node_type=node.node_type,
                    importance=node.importance,
                    description=node.description,
                    metadata=getattr(node, "metadata", {}),
                )
                nodes.append(node_data)
                node_ids.add(node.id)

        # Filter edges to only include existing nodes
        edges = []
        for edge in graph.edges:
            if edge.source in node_ids and edge.target in node_ids:
                edge_data = GraphEdge(
                    source=edge.source,
                    target=edge.target,
                    relation_type=edge.relation_type,
                    strength=edge.strength,
                    label=getattr(edge, "label", edge.relation_type),
                    metadata=getattr(edge, "metadata", {}),
                )
                edges.append(edge_data)

        return GraphVisualizationResponse(
            nodes=nodes,
            edges=edges,
        )

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve graph visualization: {str(e)}",
        )
    finally:
        if conn:
            conn.close()


@router.get(
    "/stats",
    response_model=GraphStatsResponse,
    summary="Get graph statistics",
    description="Get statistical information about the knowledge graph.",
)
async def get_graph_stats(document_id: str | None = Query(None, description="Optional document ID to filter by")):
    """Get statistics about the knowledge graph.

    Args:
        document_id: The document ID

    Returns:
        Graph statistics including node counts, edge types, density, etc.
    """
    conn = None
    try:
        conn = get_admin_connection()

        # Get all data directly from database
        themes = get_themes(conn, document_id)
        concepts = get_concepts(conn, document_id)
        relations = get_relations(conn, document_id)

        # Calculate statistics
        total_nodes = len(themes) + len(concepts)
        total_edges = len(relations)

        # Node type distribution
        node_types = {"theme": len(themes), "concept": len(concepts)}

        # Edge type distribution
        edge_types = {}
        for rel in relations:
            rel_type = rel["relation_type"]
            edge_types[rel_type] = edge_types.get(rel_type, 0) + 1

        # Calculate average degree
        avg_degree = (2 * total_edges) / total_nodes if total_nodes > 0 else 0

        # Calculate graph density
        max_edges = total_nodes * (total_nodes - 1) if total_nodes > 1 else 1
        density = total_edges / max_edges if max_edges > 0 else 0

        return GraphStatsResponse(
            document_id=document_id,
            total_nodes=total_nodes,
            total_edges=total_edges,
            node_types=node_types,
            edge_types=edge_types,
            avg_degree=avg_degree,
            density=density,
        )

    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to retrieve graph stats: {str(e)}",
        )
    finally:
        if conn:
            conn.close()


@router.post(
    "/export",
    response_model=GraphExportResponse,
    summary="Export graph to various formats",
    description="Export the knowledge graph to JSON, GraphML, GEXF, or DOT format.",
)
async def export_graph(request: GraphExportRequest):
    """Export graph to various formats.

    Args:
        request: Export request with document_id and format

    Returns:
        Exported graph data as string
    """
    conn = None
    try:
        conn = get_admin_connection()
        kg = KnowledgeGraph(conn)

        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = Path(tmpdir) / f"graph.{request.format}"

            if request.format == "json":
                kg.export_json(
                    request.document_id,
                    output_path,
                    include_metadata=request.include_metadata,
                )
            elif request.format == "graphml":
                kg.export_graphml(request.document_id, output_path)
            elif request.format == "gexf":
                kg.export_gexf(request.document_id, output_path)
            elif request.format == "dot":
                kg.export_dot(request.document_id, output_path)
            else:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Unsupported format: {request.format}",
                )

            content = output_path.read_text(encoding="utf-8")
            size_bytes = len(content.encode("utf-8"))

            return GraphExportResponse(
                document_id=request.document_id,
                format=request.format,
                data=content,
                filename=f"{request.document_id}_graph.{request.format}",
                size_bytes=size_bytes,
            )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to export graph: {str(e)}",
        )
    finally:
        if conn:
            conn.close()


@router.get(
    "/export/{document_id}",
    response_model=GraphExportResponse,
    summary="Export graph via GET request",
    description="Alternative export endpoint using GET method with query parameters.",
)
async def export_graph_get(
    document_id: str,
    format: str = Query("json", description="Export format (json, graphml, gexf, dot)"),
    include_metadata: bool = Query(True, description="Include metadata in export"),
):
    """Export graph via GET request.

    This is an alternative to the POST endpoint for easier browser access.

    Args:
        document_id: The document ID
        format: Export format (json, graphml, gexf, dot)
        include_metadata: Whether to include metadata

    Returns:
        Exported graph data as string
    """
    request = GraphExportRequest(
        document_id=document_id,
        format=format,  # type: ignore
        include_metadata=include_metadata,
    )
    return await export_graph(request)
