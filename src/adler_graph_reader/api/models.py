"""
Pydantic models for API request/response schemas.
"""

from typing import Any, Optional

from pydantic import BaseModel, Field


# ===== Health Check =====
class HealthResponse(BaseModel):
    """Health check response."""

    status: str = "ok"
    version: str = "0.1.0"
    database: str = "connected"


# ===== Document Models =====
class DocumentSummary(BaseModel):
    """Document summary for listing."""

    id: str
    title: str
    chunk_count: int
    theme_count: int
    concept_count: int
    relation_count: int


class DocumentListResponse(BaseModel):
    """Response for listing documents."""

    documents: list[DocumentSummary]
    total: int


class DocumentDetail(BaseModel):
    """Detailed document information."""

    id: str
    title: str
    chunk_count: int
    themes: list[dict[str, Any]]
    concepts: list[dict[str, Any]]
    relations: list[dict[str, Any]]


# ===== Concept Models =====
class ConceptSummary(BaseModel):
    """Concept summary for listing."""

    id: int
    name: str
    definition: str
    category: str
    importance_score: float


class ConceptListResponse(BaseModel):
    """Response for listing concepts."""

    concepts: list[ConceptSummary]
    total: int
    page: int
    page_size: int


class ConceptDetail(BaseModel):
    """Detailed concept information."""

    id: int
    document_id: str
    theme_id: Optional[int]
    name: str
    definition: str
    explanation: Optional[str]
    examples: list[str]
    category: str
    importance_score: float
    source_chunk_ids: list[int]


# ===== Relation Models =====
class RelationSummary(BaseModel):
    """Relation summary for listing."""

    id: int
    source_concept_id: int
    target_concept_id: int
    relation_type: str
    strength: float


class RelationListResponse(BaseModel):
    """Response for listing relations."""

    relations: list[RelationSummary]
    total: int


# ===== Search Models =====
class SearchRequest(BaseModel):
    """Hybrid search request."""

    query: str = Field(..., min_length=1, description="Search query")
    document_id: Optional[str] = Field(None, description="Filter by document ID")
    top_k: int = Field(5, ge=1, le=20, description="Number of results")
    use_reranker: bool = Field(True, description="Use LLM reranking")


class SearchResultItem(BaseModel):
    """Single search result."""

    tree_id: int
    content: str
    score: float
    context: list[str]
    page_number: Optional[int]


class SearchResponse(BaseModel):
    """Search response."""

    query: str
    results: list[SearchResultItem]
    total: int


# ===== Query (QA) Models =====
class QueryRequest(BaseModel):
    """Natural language query request."""

    question: str = Field(..., min_length=1, description="Question to ask")
    document_id: str = Field(..., description="Document ID")
    session_id: Optional[str] = Field(None, description="Session ID (optional)")


class QueryResponse(BaseModel):
    """Query response with answer."""

    id: int
    question: str
    answer: str
    session_id: str
    focus_concept_id: Optional[int]
    cited_concept_ids: list[int]
    confidence: float


# ===== Graph Models =====
class GraphNode(BaseModel):
    """Graph node for visualization."""

    id: str
    label: str
    node_type: str  # theme, concept
    importance: float
    description: Optional[str]


class GraphEdge(BaseModel):
    """Graph edge for visualization."""

    source: str
    target: str
    relation_type: str
    strength: float
    label: Optional[str]


class GraphDataResponse(BaseModel):
    """Complete graph data response."""

    nodes: list[GraphNode]
    edges: list[GraphEdge]
    node_count: int
    edge_count: int


# ===== Export Models =====
class ExportRequest(BaseModel):
    """Graph export request."""

    document_id: str = Field(..., description="Document ID")
    format: str = Field("json", pattern="^(json|graphml|gexf|dot)$")
    include_metadata: bool = Field(True, description="Include metadata in export")


class ExportResponse(BaseModel):
    """Graph export response."""

    document_id: str
    format: str
    data: str | dict[str, Any]
    filename: str


# ===== Pagination Models =====
class PaginationParams(BaseModel):
    """Common pagination parameters."""

    page: int = Field(1, ge=1, description="Page number")
    page_size: int = Field(20, ge=1, le=100, description="Items per page")


class ConceptSearchParams(PaginationParams):
    """Concept search parameters."""

    q: Optional[str] = Field(None, description="Search query for concept names")
    category: Optional[str] = Field(None, description="Filter by category")
    document_id: Optional[str] = Field(None, description="Filter by document ID")
