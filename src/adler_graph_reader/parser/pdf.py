"""
PDF parser implementation using PyMuPDF (fitz).
"""

import re
from pathlib import Path
from typing import Optional

import fitz  # PyMuPDF

from . import Chunk, DocumentParser, ParsedDocument


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


def split_into_paragraphs(text: str) -> list[str]:
    """Split text into natural paragraphs."""
    # Split on double newlines or single newlines with indentation
    paragraphs = re.split(r"\n\s*\n|\n(?=\s*[A-Z])", text.strip())
    return [p.strip() for p in paragraphs if p.strip()]


class PDFParser(DocumentParser):
    """Parser for PDF documents using PyMuPDF."""

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
        """Parse PDF into chunks with hierarchical structure."""
        if self.doc is None:
            self.doc = fitz.open(self.file_path)

        chunks: list[Chunk] = []
        current_chapter: Optional[str] = None

        for page_num, page in enumerate(self.doc):
            text = page.get_text("text")
            paragraphs = split_into_paragraphs(text)

            for para in paragraphs:
                if is_heading(para):
                    # Start a new chapter
                    current_chapter = para
                    chunks.append(
                        Chunk(
                            content=para,
                            page_number=page_num + 1,
                            chapter_title=para,
                            level=1,
                        )
                    )
                else:
                    # Content chunk
                    chunks.append(
                        Chunk(
                            content=para,
                            page_number=page_num + 1,
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
            },
        )
