"""
TXT parser implementation with intelligent chapter detection.
Supports plain text files with various chapter formatting patterns.
"""

import re
from pathlib import Path
from typing import Optional

from . import Chunk, DocumentParser, ParsedDocument
from ..chunking import create_simple_chunker


# Chapter detection patterns (ordered by priority)
CHAPTER_PATTERNS = [
    # Chinese chapter patterns
    r"^第[一二三四五六七八九十百千万\d]+章\s*[:：]?\s*(.+)?",  # 第一章, 第1章
    r"^第[一二三四五六七八九十百千万\d]+节\s*[:：]?\s*(.+)?",  # 第一节, 第1节
    r"^第[一二三四五六七八九十百千万\d]+卷\s*[:：]?\s*(.+)?",  # 第一卷, 第1卷
    r"^[一二三四五六七八九十]+、\s*(.+)",  # 一、二、
    # English chapter patterns
    r"^Chapter\s+[IVX\d]+\s*[:：.]?\s*(.+)?",  # Chapter 1, Chapter I
    r"^Section\s+\d+\s*[:：.]?\s*(.+)?",  # Section 1
    r"^Part\s+[IVX\d]+\s*[:：.]?\s*(.+)?",  # Part 1, Part I
    # Numbered headings (handles 1.1, 1.1.1, 1., etc.)
    r"^\d+(\.\d+)*\.?\s+(.+)",  # 1.1, 1.1.1, 1.
]


def is_chapter_heading(text: str) -> tuple[bool, Optional[str]]:
    """
    Check if text appears to be a chapter heading.
    Returns (is_heading, extracted_title).
    """
    text = text.strip()
    if len(text) < 3 or len(text) > 200:
        return False, None

    for pattern in CHAPTER_PATTERNS:
        match = re.match(pattern, text, re.IGNORECASE)
        if match:
            # Try to extract the chapter title from groups
            title = None
            for group in match.groups():
                if group and group.strip():
                    title = group.strip()
                    break
            return True, title or text

    # Heuristic: Short lines without ending punctuation might be headings
    if len(text.split()) <= 10 and not any(c in text for c in ".!?:;"):
        # But should have some substance
        if len(text) >= 5 and text[0].isalnum():
            return True, text

    return False, None


def detect_encoding(file_path: Path) -> str:
    """Detect file encoding, fallback to utf-8."""
    # Common encodings to try
    encodings = ["utf-8", "gbk", "gb2312", "big5", "utf-16", "ascii"]

    for encoding in encodings:
        try:
            with open(file_path, "r", encoding=encoding) as f:
                f.read(1024)  # Try reading first 1KB
                return encoding
        except (UnicodeDecodeError, UnicodeError):
            continue

    # Default fallback
    return "utf-8"


class TXTParser(DocumentParser):
    """Parser for plain text documents with intelligent chapter detection."""

    def __init__(self, file_path: Path):
        super().__init__(file_path)
        self._title: Optional[str] = None
        self._encoding: Optional[str] = None

    def get_title(self) -> str:
        """Extract title from filename or first line."""
        if self._title:
            return self._title

        # Try to get title from first non-empty line
        encoding = self._get_encoding()
        try:
            with open(self.file_path, "r", encoding=encoding, errors="replace") as f:
                for line in f:
                    line = line.strip()
                    if line and len(line) > 3 and len(line) < 100:
                        # Skip common metadata lines
                        if not re.match(
                            r"^(作者|Author|译者|Translated by|出版社|Publisher)",
                            line,
                            re.IGNORECASE,
                        ):
                            self._title = line
                            return self._title
        except Exception:
            pass

        # Fall back to filename
        stem = self.file_path.stem
        # Clean up common patterns
        stem = re.sub(r"\s*\([^)]*\)\s*$", "", stem)  # Remove trailing parentheses
        self._title = stem.strip()
        return self._title

    def _get_encoding(self) -> str:
        """Get file encoding, detecting if necessary."""
        if self._encoding is None:
            self._encoding = detect_encoding(self.file_path)
        return self._encoding

    def parse(self) -> ParsedDocument:
        """Parse TXT into chunks with hierarchical structure."""
        encoding = self._get_encoding()

        # Read full text
        with open(self.file_path, "r", encoding=encoding, errors="replace") as f:
            full_text = f.read()

        # Normalize line endings
        full_text = full_text.replace("\r\n", "\n").replace("\r", "\n")

        # Try to extract title from first line if not already set
        lines = full_text.split("\n")
        for line in lines:
            line = line.strip()
            if line and len(line) > 3 and len(line) < 100:
                if not re.match(
                    r"^(作者|Author|译者|Translated by)", line, re.IGNORECASE
                ):
                    self._title = line
                    break

        # Split into paragraphs
        paragraphs = re.split(r"\n\s*\n", full_text.strip())

        # Identify chapters and their content
        chapters: list[tuple[str, list[str]]] = []
        current_chapter = "Introduction"
        current_content: list[str] = []

        for para in paragraphs:
            para = para.strip()
            if not para:
                continue

            # Check if this paragraph is a chapter heading
            first_line = para.split("\n")[0].strip()
            is_heading, chapter_title = is_chapter_heading(first_line)

            if is_heading:
                # Save previous chapter
                if current_content:
                    chapters.append((current_chapter, current_content))
                # Start new chapter
                current_chapter = chapter_title or first_line
                # If paragraph has more content beyond the heading, keep it
                remaining_lines = para.split("\n")[1:]
                if remaining_lines:
                    current_content = ["\n".join(remaining_lines).strip()]
                else:
                    current_content = []
            else:
                current_content.append(para)

        # Don't forget the last chapter
        if current_content:
            chapters.append((current_chapter, current_content))

        # If no chapters detected, treat entire document as one chapter
        if not chapters:
            chapters = [("Content", [full_text])]

        # Combine chapter content and chunk
        all_chunks: list[Chunk] = []

        for chapter_title, content_parts in chapters:
            chapter_text = "\n\n".join(content_parts)
            if not chapter_text.strip():
                continue

            # Use simple chunking for each chapter
            splitter = create_simple_chunker(chunk_size=1000, overlap=100)
            chapter_chunks = splitter.chunk(chapter_text)

            for i, chunk in enumerate(chapter_chunks):
                all_chunks.append(
                    Chunk(
                        content=chunk.text,
                        chapter_title=chapter_title,
                        level=1 if i == 0 else 2,
                    )
                )

        return ParsedDocument(
            title=self.get_title(),
            chunks=all_chunks,
            metadata={
                "file_path": str(self.file_path),
                "format": "txt",
                "encoding": encoding,
                "total_chunks": len(all_chunks),
                "detected_chapters": len(chapters),
                "avg_chunk_chars": sum(len(c.content) for c in all_chunks)
                / len(all_chunks)
                if all_chunks
                else 0,
            },
        )
