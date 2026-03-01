"""
EPUB parser implementation using ebooklib.
"""

import html
import re
from pathlib import Path
from typing import Optional, Union

import ebooklib
from ebooklib.epub import EpubBook

from . import Chunk, DocumentParser, ParsedDocument


def clean_html_text(html_content: Union[str, bytes]) -> str:
    """Convert HTML to clean text."""
    # Handle bytes input
    if isinstance(html_content, bytes):
        html_content = html_content.decode("utf-8", errors="replace")

    # Remove script and style elements
    html_content = re.sub(
        r"<script[^>]*>.*?</script>", "", html_content, flags=re.DOTALL | re.IGNORECASE
    )
    html_content = re.sub(
        r"<style[^>]*>.*?</style>", "", html_content, flags=re.DOTALL | re.IGNORECASE
    )

    # Decode HTML entities
    text = html.unescape(html_content)

    # Remove remaining HTML tags
    text = re.sub(r"<[^>]+>", "", text)

    # Clean up whitespace
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = re.sub(r" {2,}", " ", text)

    return text.strip()


class EPUBParser(DocumentParser):
    """Parser for EPUB documents using ebooklib."""

    def __init__(self, file_path: Path):
        super().__init__(file_path)
        self.book: Optional[EpubBook] = None

    def __enter__(self):
        self.book = ebooklib.epub.read_epub(self.file_path)
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        # ebooklib doesn't require explicit closing
        pass

    def get_title(self) -> str:
        """Extract title from EPUB metadata."""
        if self.book is None:
            self.book = ebooklib.epub.read_epub(self.file_path)

        title = self.book.get_metadata("DC", "title")
        if title:
            return title[0][0]

        return self.file_path.stem

    def parse(self) -> ParsedDocument:
        """Parse EPUB into chunks with hierarchical structure."""
        if self.book is None:
            self.book = ebooklib.epub.read_epub(self.file_path)

        chunks: list[Chunk] = []
        current_chapter: Optional[str] = None

        # Get all items in reading order
        items = list(self.book.get_items())

        for item in items:
            # Only process document content (type 0 = document/unknown in this version)
            # Filter out images, styles, fonts, etc.
            item_type = item.get_type()
            if item_type not in (0, ebooklib.ITEM_DOCUMENT, ebooklib.ITEM_NAVIGATION):
                continue

            content = clean_html_text(item.get_content())

            # Split into paragraphs
            paragraphs = content.split("\n\n")
            for para in paragraphs:
                para = para.strip()
                if not para:
                    continue

                # Check if it's a heading (short, no punctuation, possibly numbered)
                lines = para.split("\n")
                first_line = lines[0].strip()

                # Simple heuristic: short lines without ending punctuation
                if len(first_line) < 100 and len(first_line.split()) <= 10:
                    if not any(c in first_line for c in ".!?"):
                        current_chapter = first_line
                        chunks.append(
                            Chunk(
                                content=first_line,
                                chapter_title=first_line,
                                level=1,
                            )
                        )
                        # If there are more lines, treat as chapter intro
                        if len(lines) > 1:
                            intro = "\n".join(lines[1:]).strip()
                            if intro:
                                chunks.append(
                                    Chunk(
                                        content=intro,
                                        chapter_title=current_chapter,
                                        level=2,
                                    )
                                )
                        continue

                # Regular content
                chunks.append(
                    Chunk(
                        content=para,
                        chapter_title=current_chapter,
                        level=2 if current_chapter else 1,
                    )
                )

        return ParsedDocument(
            title=self.get_title(),
            chunks=chunks,
            metadata={
                "file_path": str(self.file_path),
            },
        )
