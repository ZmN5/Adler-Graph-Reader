"""
Pydantic models for LLM responses.
"""

from __future__ import annotations


from pydantic import BaseModel, Field


class Argument(BaseModel):
    """Represents an argument/proposition about a concept."""

    proposition: str = Field(description="Author's core proposition about this concept")
    reasoning: str = Field(
        description="Logical reasoning process (premise -> conclusion)"
    )
    evidence_source: str = Field(description="Supporting evidence or page number")


class ConceptNode(BaseModel):
    """Represents a key concept extracted from the book."""

    concept_name: str = Field(description="Name of the concept")
    definition: str = Field(
        description="Author's specific definition derived from context"
    )
    arguments: list[Argument] = Field(
        default_factory=list,
        description="Key arguments/propositions about this concept",
    )
    related_concepts: list[str] = Field(
        default_factory=list, description="Other concept names for linking (wikilinks)"
    )


class BookSummary(BaseModel):
    """Summary of the entire book from Map-Reduce analysis."""

    category: str = Field(description="Book category/field")
    core_thesis: str = Field(
        description="1-3 sentence summary of the book's main argument", max_length=500
    )
    outline: str = Field(description="Tree-structured outline of the book")
    core_question: str = Field(description="Core question the author attempts to solve")


class ConceptExtraction(BaseModel):
    """Container for multiple concept extractions."""

    concepts: list[ConceptNode] = Field(
        default_factory=list, description="List of extracted concepts with arguments"
    )


class Theme(BaseModel):
    """A major theme/topic in the document."""

    name: str = Field(description="Theme name/title")
    description: str = Field(description="Theme description (1-2 sentences)")
    importance_score: float = Field(
        default=0.5, ge=0.0, le=1.0, description="Importance score from 0 to 1"
    )


class ThemeExtraction(BaseModel):
    """Theme extraction from document content."""

    themes: list[Theme] = Field(
        default_factory=list,
        description="List of major themes extracted from the content",
    )


class ConceptExtractionWithExamples(BaseModel):
    """Concept extraction with definitions and examples."""

    concepts: list[ConceptWithExamples] = Field(
        default_factory=list,
        description="List of concepts with definitions and examples",
    )


class EnhancedConceptExtraction(BaseModel):
    """Enhanced concept extraction for knowledge graph."""

    concepts: list[EnhancedConcept] = Field(
        default_factory=list,
        min_length=1,
        max_length=30,
        description="List of enhanced concepts (10-30 key concepts)",
    )


class ConceptWithExamples(BaseModel):
    """A concept with definition and examples."""

    name: str = Field(description="Concept name")
    definition: str = Field(description="Concept definition (1-2 sentences)")
    examples: list[str] = Field(
        default_factory=list, description="2-3 concrete examples of the concept"
    )
    importance_score: float = Field(
        default=0.5, ge=0.0, le=1.0, description="Importance score from 0 to 1"
    )


class EnhancedConcept(BaseModel):
    """Enhanced concept with rich metadata for knowledge graph."""

    name: str = Field(description="Concept name (single term or short phrase)")
    definition: str = Field(
        description="Clear, precise definition (1-3 sentences)", max_length=500
    )
    explanation: str = Field(
        default="",
        description="Detailed explanation expanding on the definition",
        max_length=300,
    )
    examples: list[str] = Field(
        default_factory=list,
        max_length=5,
        description="Concrete examples (0-5 items)",
    )
    importance_score: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="Global importance in the document (0-1)",
    )
    category: str = Field(
        default="concept",
        description="Type: concept, principle, method, tool, person, event",
    )


class ConceptRelationExtraction(BaseModel):
    """Extract relationships between concepts."""

    relations: list[ConceptRelation] = Field(
        default_factory=list, description="List of relationships between concepts"
    )


class ConceptRelation(BaseModel):
    """A relationship between two concepts."""

    source_concept: str = Field(description="Source concept name")
    target_concept: str = Field(description="Target concept name")
    relation_type: str = Field(
        description="Relationship type: broader_than, narrower_than, related_to, similar_to, prerequisite_for, causes"
    )
    strength: float = Field(
        default=0.5, ge=0.0, le=1.0, description="Relationship strength from 0 to 1"
    )
    evidence: str | None = Field(
        default=None, description="Evidence for this relationship from the text"
    )


class EnhancedConceptRelation(BaseModel):
    """Enhanced relationship with rich metadata."""

    source_concept: str = Field(description="Source concept name")
    target_concept: str = Field(description="Target concept name")
    relation_type: str = Field(
        description="Type: broader_than, narrower_than, part_of, implements, uses, produces, evaluates, improves, related_to, similar_to, prerequisite_for, causes, contradicts, supports"
    )
    strength: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="Relationship strength (0.3=weak, 0.7=strong)",
    )
    evidence: str = Field(
        description="Quote or paraphrase from text supporting this relation",
        max_length=300,
    )
    explanation: str = Field(
        description="Brief explanation of why this relationship exists", max_length=200
    )


class EnhancedRelationExtraction(BaseModel):
    """Container for multiple enhanced relations."""

    relations: list[EnhancedConceptRelation] = Field(
        default_factory=list,
        min_length=1,
        max_length=100,
        description="List of concept relationships (up to 100 relations per batch)",
    )


class QAResponse(BaseModel):
    """Response for a QA question about the book."""

    answer: str = Field(description="Answer to the question")
    cited_concepts: list[str] = Field(
        default_factory=list, description="Concept names used in the answer"
    )
    confidence: float = Field(
        default=0.5, ge=0.0, le=1.0, description="Confidence score for the answer"
    )
