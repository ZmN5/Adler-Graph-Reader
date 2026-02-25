"""
Obsidian file writer.
"""

import re
from pathlib import Path

from .markdown import MarkdownContent, MarkdownGenerator


def format_frontmatter(frontmatter: dict) -> str:
    """Convert frontmatter dict to YAML string."""
    lines = ["---"]
    for key, value in frontmatter.items():
        if isinstance(value, list):
            lines.append(f"{key}:")
            for item in value:
                lines.append(f"  - {item}")
        else:
            lines.append(f"{key}: {value}")
    lines.append("---")
    lines.append("")
    return "\n".join(lines)


class ObsidianWriter:
    """Write generated Markdown files to Obsidian vault."""

    def __init__(self, output_dir: Path):
        self.output_dir = Path(output_dir)
        self.generator = MarkdownGenerator()
        self.known_concepts: list[str] = []

    def write_book(
        self,
        title: str,
        book_content: MarkdownContent,
        concept_pages: list[MarkdownContent],
    ) -> Path:
        """Write book index and concept pages to disk."""
        # Create book directory
        book_dir = self.output_dir / title
        book_dir.mkdir(parents=True, exist_ok=True)

        # Collect all concept names for cross-linking
        self.known_concepts = [
            re.sub(r'\.md$', "", cp.filename)
            for cp in concept_pages
        ]

        # Write book index
        index_path = book_dir / book_content.filename
        self._write_file(
            index_path,
            book_content.content,
            book_content.frontmatter,
        )

        # Write concept pages with wikilinks applied
        for cp in concept_pages:
            # Apply wikilinks to content
            linked_content = self.generator.add_wikilinks(
                cp.content,
                self.known_concepts,
            )

            concept_path = book_dir / cp.filename
            self._write_file(
                concept_path,
                linked_content,
                cp.frontmatter,
            )

        return book_dir

    def _write_file(
        self,
        path: Path,
        content: str,
        frontmatter: dict,
    ) -> None:
        """Write content with frontmatter to a file."""
        fm = format_frontmatter(frontmatter)
        full_content = fm + content
        path.write_text(full_content, encoding="utf-8")
