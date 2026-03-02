"""
Graph models for knowledge representation.
"""

from typing import Optional

from pydantic import BaseModel, Field


class ThemeModel(BaseModel):
    """A theme extracted from a document."""

    id: int | None = None
    document_id: str
    name: str
    description: Optional[str] = None
    importance_score: float = Field(default=0.5, ge=0.0, le=1.0)
    source_chunks: list[int] = Field(default_factory=list)


class ConceptModel(BaseModel):
    """A concept with definition and examples."""

    id: int | None = None
    document_id: str
    theme_id: int | None = None
    name: str
    definition: str
    examples: list[str] = Field(default_factory=list)
    importance_score: float = Field(default=0.5, ge=0.0, le=1.0)
    source_chunk_ids: list[int] = Field(default_factory=list)
    embedding: Optional[list[float]] = None
    explanation: Optional[str] = None  # Detailed explanation
    category: Optional[str] = (
        "concept"  # concept, principle, method, tool, person, event
    )


class RelationModel(BaseModel):
    """A relationship between two concepts."""

    id: int | None = None
    document_id: str
    source_concept_id: int
    target_concept_id: int
    relation_type: str  # broader_than, narrower_than, part_of, implements, uses, produces, evaluates, improves, related_to, similar_to, prerequisite_for, causes, contradicts, supports
    strength: float = Field(default=0.5, ge=0.0, le=1.0)
    evidence: Optional[str] = None
    explanation: Optional[str] = None  # Explanation of why this relationship exists


class QAModel(BaseModel):
    """A question-answer pair with context."""

    id: int | None = None
    document_id: str
    session_id: str
    question: str
    focus_concept_id: Optional[int] = None
    context: Optional[str] = None
    answer: Optional[str] = None
    cited_concept_ids: list[int] = Field(default_factory=list)


class GraphData(BaseModel):
    """Complete graph data for a document."""

    themes: list[ThemeModel] = Field(default_factory=list)
    concepts: list[ConceptModel] = Field(default_factory=list)
    relations: list[RelationModel] = Field(default_factory=list)


class GraphNode(BaseModel):
    """A node in the knowledge graph for visualization."""

    id: str
    label: str
    node_type: str  # theme, concept
    importance: float = 0.5
    description: Optional[str] = None


class GraphEdge(BaseModel):
    """An edge in the knowledge graph for visualization."""

    source: str
    target: str
    relation_type: str
    strength: float = 0.5
    label: Optional[str] = None


class GraphVisualization(BaseModel):
    """Graph data formatted for visualization."""

    nodes: list[GraphNode] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)
