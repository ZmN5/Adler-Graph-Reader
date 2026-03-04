"""Pydantic models for API requests and responses."""

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


# ===== Health Check =====


class HealthResponse(BaseModel):
    """Health check response."""

    status: str = "ok"
    version: str = "0.1.0"
    database: bool = True


# ===== Documents =====


class DocumentInfo(BaseModel):
    """Document information."""

    document_id: str
    chunk_count: int
    theme_count: int
    concept_count: int
    relation_count: int


class DocumentListResponse(BaseModel):
    """List of documents response."""

    documents: list[DocumentInfo]
    total: int


class DocumentDetailResponse(BaseModel):
    """Document detail response."""

    document_id: str
    chunks: list[dict[str, Any]]
    themes: list[dict[str, Any]]
    concepts: list[dict[str, Any]]
    relations: list[dict[str, Any]]


# ===== Concepts =====


class ConceptFilter(BaseModel):
    """Filter options for concept listing."""

    category: Optional[str] = None
    theme_id: Optional[int] = None
    min_importance: Optional[float] = Field(None, ge=0.0, le=1.0)


class ConceptListRequest(BaseModel):
    """Request for listing concepts with pagination and search."""

    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=100)
    search: Optional[str] = None
    theme_id: Optional[int] = None
    category: Optional[str] = None
    sort_by: Literal["importance", "name", "created"] = "importance"
    sort_order: Literal["asc", "desc"] = "desc"


class ConceptListResponse(BaseModel):
    """Paginated list of concepts."""

    concepts: list[dict[str, Any]]
    total: int
    page: int
    page_size: int
    has_more: bool = False


class RelatedConcept(BaseModel):
    """Related concept information."""

    id: int
    name: str
    definition: str
    category: str
    importance_score: float
    relation_type: Optional[str] = None
    relation_strength: Optional[float] = None


class ConceptRelationDetail(BaseModel):
    """Detailed concept relation."""

    id: int
    source_concept_id: int
    target_concept_id: int
    relation_type: str
    strength: float
    evidence: Optional[str] = None
    explanation: Optional[str] = None


class ConceptDetailResponse(BaseModel):
    """Concept detail with neighbors."""

    concept: dict[str, Any]
    neighbors: list[RelatedConcept]
    relations: list[ConceptRelationDetail]
    related_documents: list[str] = []


class ConceptRelatedRequest(BaseModel):
    """Request for getting related concepts."""

    max_depth: int = Field(default=1, ge=1, le=3)
    limit: int = Field(default=20, ge=1, le=50)
    relation_types: Optional[list[str]] = None


class ConceptRelatedResponse(BaseModel):
    """Response with related concepts graph."""

    concept_id: int
    nodes: list[dict[str, Any]]
    edges: list[dict[str, Any]]
    total_nodes: int
    total_edges: int


# ===== Relations =====


class RelationFilterRequest(BaseModel):
    """Request for filtering relations."""

    document_id: Optional[str] = None
    source_concept_id: Optional[int] = None
    target_concept_id: Optional[int] = None
    relation_type: Optional[str] = None
    min_strength: Optional[float] = Field(None, ge=0.0, le=1.0)
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=100)


class RelationListResponse(BaseModel):
    """List of relations."""

    relations: list[dict[str, Any]]
    total: int
    page: int
    page_size: int
    has_more: bool = False


# ===== Search =====


class SearchType(str):
    """Search type options."""

    FTS = "fts"
    VECTOR = "vector"
    HYBRID = "hybrid"


class SearchRequest(BaseModel):
    """Hybrid search request."""

    query: str = Field(..., min_length=1, max_length=1000)
    document_id: str | None = None
    top_k: int = Field(default=10, ge=1, le=50)
    use_reranker: bool = True
    search_type: Literal["fts", "vector", "hybrid"] = "hybrid"
    include_context: bool = True


class CitedChunk(BaseModel):
    """Chunk citation in search results."""

    tree_id: int
    content: str
    score: float
    page_number: Optional[int] = None
    chapter: Optional[str] = None


class SearchResultItem(BaseModel):
    """Single search result."""

    tree_id: int
    content: str
    score: float
    context: list[str]
    page_number: Optional[int] = None
    chapter: Optional[str] = None
    fts_score: Optional[float] = None
    vector_score: Optional[float] = None


class SearchResponse(BaseModel):
    """Search results response."""

    query: str
    document_id: str | None = None
    results: list[SearchResultItem]
    total: int
    search_type: str = "hybrid"
    took_ms: Optional[int] = None


# ===== Query (QA) =====


class QueryContext(BaseModel):
    """Context information for QA."""

    chunks: list[CitedChunk]
    concepts: list[dict[str, Any]]


class QueryRequest(BaseModel):
    """Natural language query request."""

    question: str = Field(..., min_length=1, max_length=2000)
    document_id: str
    session_id: Optional[str] = None
    include_citations: bool = True
    max_context_chunks: int = Field(default=5, ge=1, le=10)


class QueryResponse(BaseModel):
    """Query answer response."""

    question: str
    answer: str
    session_id: str
    confidence: float
    cited_concept_ids: list[int]
    cited_chunks: list[CitedChunk]
    focus_concept_id: Optional[int] = None
    context_summary: Optional[str] = None


class QueryHistoryRequest(BaseModel):
    """Request for query history."""

    session_id: str
    limit: int = Field(default=10, ge=1, le=50)


class QueryHistoryResponse(BaseModel):
    """Query history response."""

    session_id: str
    queries: list[dict[str, Any]]
    total: int


# ===== Graph =====


class GraphNode(BaseModel):
    """Graph node for visualization."""

    id: str
    label: str
    node_type: Literal["theme", "concept", "document"]
    importance: float
    description: Optional[str] = None
    metadata: dict[str, Any] = {}


class GraphEdge(BaseModel):
    """Graph edge for visualization."""

    source: str
    target: str
    relation_type: str
    strength: float
    label: Optional[str] = None
    metadata: dict[str, Any] = {}


class GraphDataResponse(BaseModel):
    """Complete graph data response."""

    document_id: str
    themes: list[dict[str, Any]]
    concepts: list[dict[str, Any]]
    relations: list[dict[str, Any]]
    stats: dict[str, int]


class GraphVisualizationResponse(BaseModel):
    """Graph visualization format response."""

    nodes: list[GraphNode]
    edges: list[GraphEdge]
    layout: Optional[dict[str, Any]] = None


class GraphExportRequest(BaseModel):
    """Graph export request."""

    document_id: str
    format: Literal["json", "graphml", "gexf", "dot"] = "json"
    include_metadata: bool = True


class GraphExportResponse(BaseModel):
    """Graph export response."""

    document_id: str
    format: str
    data: str
    filename: str
    size_bytes: int


class GraphStatsResponse(BaseModel):
    """Graph statistics response."""

    document_id: str
    total_nodes: int
    total_edges: int
    node_types: dict[str, int]
    edge_types: dict[str, int]
    avg_degree: float
    density: float


# ===== Error Responses =====


class ErrorResponse(BaseModel):
    """Error response."""

    error: str
    detail: Optional[str] = None
    code: Optional[str] = None
