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


class ConceptListRequest(BaseModel):
    """Request for listing concepts with pagination and search."""

    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=100)
    search: Optional[str] = None
    theme_id: Optional[int] = None


class ConceptListResponse(BaseModel):
    """Paginated list of concepts."""

    concepts: list[dict[str, Any]]
    total: int
    page: int
    page_size: int


class ConceptDetailResponse(BaseModel):
    """Concept detail with neighbors."""

    concept: dict[str, Any]
    neighbors: list[dict[str, Any]]
    relations: list[dict[str, Any]]


# ===== Relations =====


class RelationListResponse(BaseModel):
    """List of relations."""

    relations: list[dict[str, Any]]
    total: int


# ===== Search =====


class SearchRequest(BaseModel):
    """Hybrid search request."""

    query: str = Field(..., min_length=1, max_length=1000)
    document_id: str
    top_k: int = Field(default=10, ge=1, le=50)
    use_reranker: bool = True


class SearchResultItem(BaseModel):
    """Single search result."""

    tree_id: int
    content: str
    score: float
    context: list[str]
    page_number: Optional[int] = None


class SearchResponse(BaseModel):
    """Search results response."""

    query: str
    results: list[SearchResultItem]
    total: int


# ===== Query (QA) =====


class QueryRequest(BaseModel):
    """Natural language query request."""

    question: str = Field(..., min_length=1, max_length=2000)
    document_id: str
    session_id: Optional[str] = None


class QueryResponse(BaseModel):
    """Query answer response."""

    question: str
    answer: str
    session_id: str
    confidence: float
    cited_concept_ids: list[int]
    focus_concept_id: Optional[int] = None


# ===== Graph =====


class GraphDataResponse(BaseModel):
    """Complete graph data response."""

    document_id: str
    themes: list[dict[str, Any]]
    concepts: list[dict[str, Any]]
    relations: list[dict[str, Any]]
    stats: dict[str, int]


class GraphVisualizationResponse(BaseModel):
    """Graph visualization format response."""

    nodes: list[dict[str, Any]]
    edges: list[dict[str, Any]]


class GraphExportRequest(BaseModel):
    """Graph export request."""

    document_id: str
    format: Literal["json", "graphml", "gexf", "dot"] = "json"


class GraphExportResponse(BaseModel):
    """Graph export response."""

    document_id: str
    format: str
    data: str
    filename: str


# ===== Error Responses =====


class ErrorResponse(BaseModel):
    """Error response."""

    error: str
    detail: Optional[str] = None
