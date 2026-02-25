"""
Knowledge extraction models.
"""

from typing import Optional

from pydantic import BaseModel, Field


class Argument(BaseModel):
    """Represents an argument about a concept."""
    proposition: str = Field(description="Core proposition about the concept")
    reasoning: str = Field(description="Logical reasoning process")
    evidence_source: str = Field(description="Supporting evidence or page ref")


class ConceptNode(BaseModel):
    """A key concept extracted from the book."""
    name: str = Field(description="Concept name")
    definition: str = Field(description="Author's definition from context")
    arguments: list[Argument] = Field(default_factory=list, description="Supporting arguments")
    related_concepts: list[str] = Field(
        default_factory=list,
        description="Related concept names for linking"
    )


class ChapterSummary(BaseModel):
    """Summary of a single chapter."""
    title: str = Field(description="Chapter title")
    summary: str = Field(description="Chapter summary in 1-2 sentences")
    key_concepts: list[str] = Field(default_factory=list, description="Key concepts mentioned")


class BookAnalysis(BaseModel):
    """Complete book analysis from Map-Reduce."""
    category: str = Field(description="Book category/field")
    core_thesis: str = Field(description="Main argument in 1-3 sentences")
    outline: str = Field(description="Book outline")
    core_question: str = Field(description="Core question author addresses")
    chapters: list[ChapterSummary] = Field(
        default_factory=list,
        description="Chapter summaries"
    )
