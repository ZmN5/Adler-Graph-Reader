"""
Pydantic models for LLM responses.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class Argument(BaseModel):
    """Represents an argument/proposition about a concept."""
    proposition: str = Field(description="Author's core proposition about this concept")
    reasoning: str = Field(description="Logical reasoning process (premise -> conclusion)")
    evidence_source: str = Field(description="Supporting evidence or page number")


class ConceptNode(BaseModel):
    """Represents a key concept extracted from the book."""
    concept_name: str = Field(description="Name of the concept")
    definition: str = Field(
        description="Author's specific definition derived from context"
    )
    arguments: list[Argument] = Field(
        default_factory=list,
        description="Key arguments/propositions about this concept"
    )
    related_concepts: list[str] = Field(
        default_factory=list,
        description="Other concept names for linking (wikilinks)"
    )


class BookSummary(BaseModel):
    """Summary of the entire book from Map-Reduce analysis."""
    category: str = Field(description="Book category/field")
    core_thesis: str = Field(
        description="1-3 sentence summary of the book's main argument",
        max_length=500
    )
    outline: str = Field(description="Tree-structured outline of the book")
    core_question: str = Field(description="Core question the author attempts to solve")


class ConceptExtraction(BaseModel):
    """Container for multiple concept extractions."""
    concepts: list[ConceptNode] = Field(
        default_factory=list,
        description="List of extracted concepts with arguments"
    )


class Theme(BaseModel):
    """A major theme/topic in the document."""
    name: str = Field(description="Theme name/title")
    description: str = Field(description="Theme description (1-2 sentences)")
    importance_score: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="Importance score from 0 to 1"
    )


class ThemeExtraction(BaseModel):
    """Theme extraction from document content."""
    themes: list[Theme] = Field(
        default_factory=list,
        description="List of major themes extracted from the content"
    )


class ConceptExtractionWithExamples(BaseModel):
    """Concept extraction with definitions and examples."""
    concepts: list[ConceptWithExamples] = Field(
        default_factory=list,
        description="List of concepts with definitions and examples"
    )


class ConceptWithExamples(BaseModel):
    """A concept with definition and examples."""
    name: str = Field(description="Concept name")
    definition: str = Field(description="Concept definition")
    examples: list[str] = Field(
        default_factory=list,
        description="Examples of the concept"
    )
    importance_score: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="Importance score from 0 to 1"
    )


class ConceptRelationExtraction(BaseModel):
    """Extract relationships between concepts."""
    relations: list[ConceptRelation] = Field(
        default_factory=list,
        description="List of relationships between concepts"
    )


class ConceptRelation(BaseModel):
    """A relationship between two concepts."""
    source_concept: str = Field(description="Source concept name")
    target_concept: str = Field(description="Target concept name")
    relation_type: str = Field(
        description="Relationship type: relates_to, contradicts, supports, prerequisite_for, broader_than, similar_to"
    )
    strength: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="Relationship strength from 0 to 1"
    )
    evidence: str | None = Field(
        default=None,
        description="Evidence for this relationship from the text"
    )


class QAResponse(BaseModel):
    """Response for a QA question about the book."""
    answer: str = Field(description="Answer to the question")
    cited_concepts: list[str] = Field(
        default_factory=list,
        description="Concept names used in the answer"
    )
    confidence: float = Field(
        default=0.5,
        ge=0.0,
        le=1.0,
        description="Confidence score for the answer"
    )
