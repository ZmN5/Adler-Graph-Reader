"""
EPUB parser implementation using ebooklib with Chonkie semantic chunking.
"""

import html
import re
from pathlib import Path
from typing import Optional, Union

import ebooklib
from ebooklib.epub import EpubBook

from . import Chunk, DocumentParser, ParsedDocument
from ..chunking import create_chonkie_splitter


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


def is_heading(text: str) -> bool:
    """Check if text appears to be a heading."""
    text = text.strip()
    if len(text) < 3 or len(text) > 200:
        return False

    # Short lines without ending punctuation
    if len(text.split()) <= 10 and not any(c in text for c in ".!?"):
        return True

    # Numbered headings like "1. Introduction"
    if re.match(r"^\d+[\.\s]+", text):
        return True

    return False


class EPUBParser(DocumentParser):
    """Parser for EPUB documents using ebooklib with Chonkie chunking."""

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
        """Parse EPUB into chunks with hierarchical structure using Chonkie."""
        if self.book is None:
            self.book = ebooklib.epub.read_epub(self.file_path)

        # Collect all document content
        full_text_parts: list[tuple[str, str]] = []  # (chapter_hint, text)
        current_chapter_hint = ""

        # Get all items in reading order
        items = list(self.book.get_items())

        for item in items:
            # Only process document content
            item_type = item.get_type()
            if item_type not in (0, ebooklib.ITEM_DOCUMENT, ebooklib.ITEM_NAVIGATION):
                continue

            content = clean_html_text(item.get_content())
            if not content.strip():
                continue

            # Try to extract chapter name from content
            lines = content.split("\n")
            first_line = lines[0].strip() if lines else ""

            if is_heading(first_line):
                current_chapter_hint = first_line

            full_text_parts.append((current_chapter_hint, content))

        # Combine all text for semantic chunking
        full_text = "\n\n".join([text for _, text in full_text_parts])

        # Use Chonkie for semantic chunking
        splitter = create_chonkie_splitter()
        semantic_chunks = splitter.chunk(full_text)

        # Map chunks back to chapters
        chunks: list[Chunk] = []
        current_chapter: Optional[str] = None

        for chunk in semantic_chunks:
            content = chunk.text

            # Check if this chunk starts with a heading
            first_line = content.split("\n")[0].strip()
            if is_heading(first_line):
                current_chapter = first_line
                chunks.append(
                    Chunk(
                        content=content,
                        chapter_title=current_chapter,
                        level=1,
                    )
                )
            else:
                # Regular content chunk
                chunks.append(
                    Chunk(
                        content=content,
                        chapter_title=current_chapter,
                        level=2 if current_chapter else 1,
                    )
                )

        return ParsedDocument(
            title=self.get_title(),
            chunks=chunks,
            metadata={
                "file_path": str(self.file_path),
                "total_chunks": len(chunks),
                "avg_chunk_tokens": sum(c.token_count for c in semantic_chunks) / len(semantic_chunks) if semantic_chunks else 0,
            },
        )
