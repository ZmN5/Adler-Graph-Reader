"""Graph visualization and export routes for the API."""

import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, status

from ...database import get_admin_connection
from ...knowledge.graph import KnowledgeGraph
from ..models import (
    GraphDataResponse,
    GraphExportRequest,
    GraphExportResponse,
)

router = APIRouter(prefix="/graph", tags=["graph"])


@router.get(
    "/{document_id}",
    response_model=GraphDataResponse,
    summary="Get graph data for visualization",
    description="Retrieve complete graph data (nodes and edges) for visualizing the knowledge graph.",
)
async def get_graph_data(document_id: str):
    """Get graph data for a document.

    Args:
        document_id: The document ID

    Returns:
        Complete graph data with themes, concepts, relations
    """
    conn = None
    try:
        conn = get_admin_connection()
        kg = KnowledgeGraph(conn)

        # Get themes
        themes = kg.get_themes(document_id)
        themes_data = [
            {
                "id": t.id,
                "name": t.name,
                "description": t.description,
                "importance_score": t.importance_score,
            }
            for t in themes
        ]

        # Get concepts
        concepts = kg.get_concepts(document_id)
        concepts_data = [
            {
                "id": c.id,
                "name": c.name,
                "definition": c.definition,
                "category": c.category,
                "importance_score": c.importance_score,
                "theme_id": c.theme_id,
            }
            for c in concepts
        ]

        # Get relations
        relations = kg.get_relations(document_id)
        relations_data = [
            {
                "id": r.id,
                "source_concept_id": r.source_concept_id,
                "target_concept_id": r.target_concept_id,
                "relation_type": r.relation_type,
                "strength": r.strength,
                "evidence": r.evidence,
            }
            for r in relations
        ]

        return GraphDataResponse(
            document_id=document_id,
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
                kg.export_json(request.document_id, output_path)
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

            return GraphExportResponse(
                document_id=request.document_id,
                format=request.format,
                data=content,
                filename=f"{request.document_id}_graph.{request.format}",
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
