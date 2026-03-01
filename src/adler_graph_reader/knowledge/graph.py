"""
Knowledge graph management and QA tracking.
"""

import sqlite3
import uuid
from pathlib import Path
from typing import Any, Optional

from .. import database
from .extractor import ConceptExtractor, QAExtractor, RelationExtractor, ThemeExtractor
from .graph_models import (
    ConceptModel,
    GraphData,
    GraphEdge,
    GraphNode,
    GraphVisualization,
    QAModel,
    RelationModel,
    ThemeModel,
)


class KnowledgeGraph:
    """Manage the knowledge graph for a document."""

    def __init__(self, conn: Optional[sqlite3.Connection] = None):
        self.conn = conn or database.get_admin_connection()

    def extract_themes(self, document_id: str) -> list[ThemeModel]:
        """Extract and store themes for a document."""
        extractor = ThemeExtractor()
        themes = extractor.extract(self.conn, document_id)

        # Store in database
        stored_themes = []
        for theme in themes:
            theme_id = database.insert_theme(
                self.conn,
                document_id=theme.document_id,
                name=theme.name,
                description=theme.description,
                importance_score=theme.importance_score,
                source_chunks=theme.source_chunks,
            )
            theme.id = theme_id
            stored_themes.append(theme)

        return stored_themes

    def extract_concepts(
        self,
        document_id: str,
        theme_ids: Optional[list[int]] = None,
    ) -> list[ConceptModel]:
        """Extract and store concepts for a document."""
        extractor = ConceptExtractor()
        concepts = extractor.extract(self.conn, document_id, theme_ids)

        # Store in database
        stored_concepts = []
        for concept in concepts:
            concept_id = database.insert_concept(
                self.conn,
                document_id=concept.document_id,
                name=concept.name,
                definition=concept.definition,
                theme_id=concept.theme_id,
                examples=concept.examples,
                importance_score=concept.importance_score,
                source_chunk_ids=concept.source_chunk_ids,
                embedding=concept.embedding,
                explanation=concept.explanation,
                category=concept.category,
            )
            concept.id = concept_id
            stored_concepts.append(concept)

        return stored_concepts

    def extract_relations(
        self,
        document_id: str,
        concepts: Optional[list[ConceptModel]] = None,
    ) -> list[RelationModel]:
        """Extract and store concept relations."""
        if concepts is None:
            concepts_data = database.get_concepts(self.conn, document_id)
            concepts = [
                ConceptModel(
                    id=c["id"],
                    document_id=c["document_id"],
                    theme_id=c.get("theme_id"),
                    name=c["name"],
                    definition=c["definition"],
                    examples=c.get("examples", []),
                    importance_score=c.get("importance_score", 0.5),
                    source_chunk_ids=c.get("source_chunk_ids", []),
                )
                for c in concepts_data
            ]

        extractor = RelationExtractor()
        relations = extractor.extract(self.conn, document_id, concepts)

        # Store in database
        stored_relations = []
        for rel in relations:
            rel_id = database.insert_relation(
                self.conn,
                document_id=rel.document_id,
                source_concept_id=rel.source_concept_id,
                target_concept_id=rel.target_concept_id,
                relation_type=rel.relation_type,
                strength=rel.strength,
                evidence=rel.evidence,
                explanation=rel.explanation,
            )
            rel.id = rel_id
            stored_relations.append(rel)

        return stored_relations

    def get_graph(self, document_id: str) -> GraphData:
        """Get complete graph data for a document."""
        graph_data = database.get_document_graph(self.conn, document_id)

        themes = [
            ThemeModel(
                id=t["id"],
                document_id=t["document_id"],
                name=t["name"],
                description=t.get("description"),
                importance_score=t.get("importance_score", 0.5),
                source_chunks=t.get("source_chunks", []),
            )
            for t in graph_data["themes"]
        ]

        concepts = [
            ConceptModel(
                id=c["id"],
                document_id=c["document_id"],
                theme_id=c.get("theme_id"),
                name=c["name"],
                definition=c["definition"],
                examples=c.get("examples", []),
                importance_score=c.get("importance_score", 0.5),
                source_chunk_ids=c.get("source_chunk_ids", []),
            )
            for c in graph_data["concepts"]
        ]

        relations = [
            RelationModel(
                id=r["id"],
                document_id=r["document_id"],
                source_concept_id=r["source_concept_id"],
                target_concept_id=r["target_concept_id"],
                relation_type=r["relation_type"],
                strength=r.get("strength", 0.5),
                evidence=r.get("evidence"),
            )
            for r in graph_data["relations"]
        ]

        return GraphData(
            themes=themes,
            concepts=concepts,
            relations=relations,
        )

    def to_visualization(self, document_id: str) -> GraphVisualization:
        """Convert graph to visualization format."""
        graph = self.get_graph(document_id)

        nodes = []
        # Add theme nodes
        for theme in graph.themes:
            nodes.append(
                GraphNode(
                    id=f"theme_{theme.id}",
                    label=theme.name,
                    node_type="theme",
                    importance=theme.importance_score,
                    description=theme.description,
                )
            )

        # Add concept nodes
        for concept in graph.concepts:
            nodes.append(
                GraphNode(
                    id=f"concept_{concept.id}",
                    label=concept.name,
                    node_type="concept",
                    importance=concept.importance_score,
                    description=concept.definition[:100],
                )
            )

        edges = []
        # Add relation edges
        for rel in graph.relations:
            edges.append(
                GraphEdge(
                    source=f"concept_{rel.source_concept_id}",
                    target=f"concept_{rel.target_concept_id}",
                    relation_type=rel.relation_type,
                    strength=rel.strength,
                    label=rel.relation_type,
                )
            )

        # Add theme-concept edges
        for concept in graph.concepts:
            if concept.theme_id:
                edges.append(
                    GraphEdge(
                        source=f"theme_{concept.theme_id}",
                        target=f"concept_{concept.id}",
                        relation_type="has_concept",
                        strength=1.0,
                    )
                )

        return GraphVisualization(nodes=nodes, edges=edges)

    def find_concept(self, document_id: str, name: str) -> Optional[ConceptModel]:
        """Find a concept by name."""
        concepts = database.get_concepts(self.conn, document_id)
        for c in concepts:
            if c["name"].lower() == name.lower():
                return ConceptModel(
                    id=c["id"],
                    document_id=c["document_id"],
                    theme_id=c.get("theme_id"),
                    name=c["name"],
                    definition=c["definition"],
                    examples=c.get("examples", []),
                    importance_score=c.get("importance_score", 0.5),
                    source_chunk_ids=c.get("source_chunk_ids", []),
                )
        return None

    def get_concept_neighbors(
        self,
        document_id: str,
        concept_id: int,
    ) -> dict[str, Any]:
        """Get neighboring concepts and their relations."""
        relations = database.get_concept_relations(self.conn, concept_id)
        concept_ids = set()
        for rel in relations:
            if rel["source_concept_id"] != concept_id:
                concept_ids.add(rel["source_concept_id"])
            if rel["target_concept_id"] != concept_id:
                concept_ids.add(rel["target_concept_id"])

        neighbors = []
        for cid in concept_ids:
            concept = database.get_concept_by_id(self.conn, cid)
            if concept:
                neighbors.append(concept)

        return {
            "relations": relations,
            "neighbors": neighbors,
        }

    def export_dot(
        self,
        document_id: str,
        output_path: Path,
        layout: str = "dot",
    ) -> Path:
        """Export graph to Graphviz DOT format."""
        from ..output.visualization import GraphvizExporter

        graph_data = self.get_graph(document_id)

        exporter = GraphvizExporter(title=document_id)
        return exporter.export(
            themes=[t.model_dump() for t in graph_data.themes],
            concepts=[c.model_dump() for c in graph_data.concepts],
            relations=[r.model_dump() for r in graph_data.relations],
            output_path=output_path,
            layout=layout,
        )

    def export_json(
        self,
        document_id: str,
        output_path: Path,
        include_metadata: bool = True,
    ) -> Path:
        """Export graph to JSON format."""
        from ..output.visualization import GraphJSONExporter

        graph_data = self.get_graph(document_id)

        exporter = GraphJSONExporter()
        return exporter.export(
            themes=[t.model_dump() for t in graph_data.themes],
            concepts=[c.model_dump() for c in graph_data.concepts],
            relations=[r.model_dump() for r in graph_data.relations],
            output_path=output_path,
            include_metadata=include_metadata,
        )

    def export_networkx(self, document_id: str):
        """Export to NetworkX graph object."""
        from ..output.visualization import GraphJSONExporter

        graph_data = self.get_graph(document_id)

        exporter = GraphJSONExporter()
        return exporter.export_networkx(
            themes=[t.model_dump() for t in graph_data.themes],
            concepts=[c.model_dump() for c in graph_data.concepts],
            relations=[r.model_dump() for r in graph_data.relations],
        )

    def export_svg(
        self,
        document_id: str,
        output_path: Path,
    ) -> Path:
        """Export graph to SVG format (requires Graphviz)."""
        from ..output.visualization import GraphvizExporter

        graph_data = self.get_graph(document_id)

        exporter = GraphvizExporter(title=document_id)
        return exporter.export_svg(
            themes=[t.model_dump() for t in graph_data.themes],
            concepts=[c.model_dump() for c in graph_data.concepts],
            relations=[r.model_dump() for r in graph_data.relations],
            output_path=output_path,
        )

    def close(self) -> None:
        """Close the database connection."""
        self.conn.close()


class QATracker:
    """Track question-answer sessions."""

    def __init__(self, conn: Optional[sqlite3.Connection] = None):
        self.conn = conn or database.get_connection()

    def create_session(self) -> str:
        """Create a new QA session and return session ID."""
        return str(uuid.uuid4())

    def ask(
        self,
        document_id: str,
        question: str,
        session_id: str,
    ) -> dict[str, Any]:
        """Ask a question and get an answer."""
        extractor = QAExtractor()
        result = extractor.answer(self.conn, document_id, question, session_id)

        # Store the QA in database
        qa_id = database.insert_qa(
            self.conn,
            document_id=document_id,
            session_id=session_id,
            question=question,
            focus_concept_id=result.get("focus_concept_id"),
            context=result.get("context"),
            answer=result.get("answer"),
            cited_concept_ids=result.get("cited_concept_ids"),
        )

        result["id"] = qa_id
        return result

    def get_history(self, session_id: str) -> list[QAModel]:
        """Get QA history for a session."""
        history = database.get_qa_history(self.conn, session_id)
        return [
            QAModel(
                id=h["id"],
                document_id=h["document_id"],
                session_id=h["session_id"],
                question=h["question"],
                focus_concept_id=h.get("focus_concept_id"),
                context=h.get("context"),
                answer=h.get("answer"),
                cited_concept_ids=h.get("cited_concept_ids", []),
            )
            for h in history
        ]

    def close(self) -> None:
        """Close the database connection."""
        self.conn.close()
