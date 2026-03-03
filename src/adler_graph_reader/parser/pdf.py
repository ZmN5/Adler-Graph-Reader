"""
PDF parser implementation using PyMuPDF (fitz) with Chonkie semantic chunking.
"""

import re
from pathlib import Path
from typing import Optional

import fitz  # PyMuPDF

from . import Chunk, DocumentParser, ParsedDocument
from ..chunking import create_chonkie_splitter


# Heuristic patterns for detecting chapter/section headings
HEADING_PATTERNS = [
    r"^Chapter\s+\d+",  # Chapter 1
    r"^第[一二三四五六七八九十\d]+章",  # Chinese: 第1章
    r"^[A-Z][A-Z\s]+$",  # ALL CAPS headings
    r"^\d+\.\s+[A-Z]",  # 1. Section Title
    r"^#{1,6}\s+",  # Markdown-style headings
]


def is_heading(text: str) -> bool:
    """Check if text appears to be a heading."""
    text = text.strip()
    if len(text) < 3 or len(text) > 200:
        return False

    for pattern in HEADING_PATTERNS:
        if re.match(pattern, text, re.IGNORECASE):
            return True

    # Short lines with no punctuation might be headings
    if len(text.split()) <= 6 and not any(c in text for c in ".!?"):
        return True

    return False


def extract_chapters_from_text(text: str) -> list[tuple[str, str]]:
    """
    Extract chapter boundaries from full text.
    Returns list of (chapter_title, chapter_content) tuples.
    """
    chapters: list[tuple[str, str]] = []
    current_chapter = "Introduction"
    current_content: list[str] = []

    paragraphs = re.split(r"\n\s*\n", text.strip())

    for para in paragraphs:
        para = para.strip()
        if not para:
            continue

        if is_heading(para):
            # Save previous chapter
            if current_content:
                chapters.append((current_chapter, "\n\n".join(current_content)))
            # Start new chapter
            current_chapter = para
            current_content = []
        else:
            current_content.append(para)

    # Don't forget the last chapter
    if current_content:
        chapters.append((current_chapter, "\n\n".join(current_content)))

    return chapters


class PDFParser(DocumentParser):
    """Parser for PDF documents using PyMuPDF with Chonkie chunking."""

    def __init__(self, file_path: Path):
        super().__init__(file_path)
        self.doc: Optional[fitz.Document] = None

    def __enter__(self):
        self.doc = fitz.open(self.file_path)
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.doc:
            self.doc.close()

    def get_title(self) -> str:
        """Extract title from PDF metadata or filename."""
        if self.doc is None:
            self.doc = fitz.open(self.file_path)

        # Try metadata first
        meta = self.doc.metadata
        if meta.get("title") and meta["title"] != meta.get(""):
            return meta["title"]

        # Fall back to filename
        return self.file_path.stem

    def parse(self) -> ParsedDocument:
        """Parse PDF into chunks with hierarchical structure using Chonkie."""
        if self.doc is None:
            self.doc = fitz.open(self.file_path)

        # First pass: extract full text and track page numbers
        full_text_parts: list[tuple[int, str]] = []  # (page_num, text)

        for page_num, page in enumerate(self.doc):
            text = page.get_text("text")
            if text.strip():
                full_text_parts.append((page_num + 1, text))

        # Combine all text for semantic chunking
        full_text = "\n\n".join([text for _, text in full_text_parts])

        # Use Chonkie for semantic chunking
        splitter = create_chonkie_splitter()
        semantic_chunks = splitter.chunk(full_text)

        # Map chunks back to pages and chapters
        chunks: list[Chunk] = []
        current_chapter: Optional[str] = None

        for chunk in semantic_chunks:
            content = chunk.text

            # Find which page this chunk belongs to (approximate)
            page_number = 1
            accumulated_text = ""
            for p_num, p_text in full_text_parts:
                accumulated_text += p_text + "\n\n"
                if content in accumulated_text or accumulated_text.find(content[:100]) != -1:
                    page_number = p_num
                    break

            # Check if this chunk starts with a heading
            first_line = content.split("\n")[0].strip()
            if is_heading(first_line):
                current_chapter = first_line
                chunks.append(
                    Chunk(
                        content=content,
                        page_number=page_number,
                        chapter_title=current_chapter,
                        level=1,
                    )
                )
            else:
                # Regular content chunk
                chunks.append(
                    Chunk(
                        content=content,
                        page_number=page_number,
                        chapter_title=current_chapter,
                        level=2 if current_chapter else 1,
                    )
                )

        return ParsedDocument(
            title=self.get_title(),
            chunks=chunks,
            metadata={
                "pages": len(self.doc),
                "file_path": str(self.file_path),
                "total_chunks": len(chunks),
                "avg_chunk_tokens": sum(c.token_count for c in semantic_chunks) / len(semantic_chunks) if semantic_chunks else 0,
            },
        )
