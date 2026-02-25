"""
Markdown generation utilities.
"""

import re
from dataclasses import dataclass
from pathlib import Path

from ..knowledge.models import BookAnalysis, ConceptNode


@dataclass
class MarkdownContent:
    """Represents generated markdown content."""
    filename: str
    content: str
    frontmatter: dict


def sanitize_filename(name: str) -> str:
    """Convert a string to a safe filename."""
    # Replace invalid characters
    name = re.sub(r'[<>:"/\\|?*]', "", name)
    # Replace spaces with underscores
    name = name.replace(" ", "_")
    # Limit length
    return name[:100]


def to_wikilink(name: str) -> str:
    """Convert a concept name to Obsidian wikilink format."""
    # Remove special characters and convert to [[Name]]
    clean = re.sub(r'[<>:"/\\|?*\[\]]', "", name)
    return f"[[{clean}]]"


class MarkdownGenerator:
    """Generate Obsidian-compatible Markdown content."""

    def generate_book_index(
        self,
        title: str,
        analysis: BookAnalysis,
    ) -> MarkdownContent:
        """Generate the main book index page."""
        # Build frontmatter
        frontmatter = {
            "type": "book",
            "category": analysis.category,
            "tags": ["book", analysis.category.lower()],
        }

        # Build content
        content_lines = [
            f"# {title}",
            "",
            f"**分类**: {analysis.category}",
            f"**核心问题**: {analysis.core_question}",
            "",
            "## 核心主旨",
            "",
            analysis.core_thesis,
            "",
            "## 大纲",
            "",
            analysis.outline,
            "",
            "## 章节概要",
            "",
        ]

        for ch in analysis.chapters:
            content_lines.extend([
                f"### {ch.title}",
                "",
                ch.summary,
                "",
                f"**关键概念**: {', '.join(ch.key_concepts)}" if ch.key_concepts else "",
                "",
            ])

        # Add concept index
        content_lines.extend([
            "## 概念索引",
            "",
            "(由分析阅读阶段提取)",
            "",
        ])

        return MarkdownContent(
            filename=f"00_{sanitize_filename(title)}.md",
            content="\n".join(content_lines),
            frontmatter=frontmatter,
        )

    def generate_concept_page(
        self,
        concept: ConceptNode,
    ) -> MarkdownContent:
        """Generate a concept page with bidirectional links."""
        frontmatter = {
            "type": "concept",
            "tags": ["concept"],
        }

        # Convert related concepts to wikilinks
        related_links = [
            to_wikilink(name) for name in concept.related_concepts
        ]

        content_lines = [
            f"# {concept.name}",
            "",
            f"> **定义**: {concept.definition}",
            "",
            "## 论证",
            "",
        ]

        for i, arg in enumerate(concept.arguments, 1):
            content_lines.extend([
                f"### 论点 {i}: {arg.proposition}",
                "",
                f"**推理过程**: {arg.reasoning}",
                "",
                f"**证据来源**: {arg.evidence_source}",
                "",
            ])

        if related_links:
            content_lines.extend([
                "## 相关概念",
                "",
                ", ".join(related_links),
                "",
            ])

        return MarkdownContent(
            filename=f"{sanitize_filename(concept.name)}.md",
            content="\n".join(content_lines),
            frontmatter=frontmatter,
        )

    def add_wikilinks(self, content: str, known_concepts: list[str]) -> str:
        """
        Replace concept mentions with wikilinks.
        Must be called after all concept pages are generated.
        """
        result = content

        for concept in known_concepts:
            # Skip if already a wikilink
            pattern = rf'\b({re.escape(concept)})\b'
            result = re.sub(
                pattern,
                rf'[[\1]]',
                result,
            )

        return result
