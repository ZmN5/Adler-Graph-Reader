"""
MOBI/AZW3 parser implementation using mobi library.
Extracts text content while preserving chapter structure.
"""

import re
from pathlib import Path
from typing import Optional

from . import Chunk, DocumentParser, ParsedDocument
from ..chunking import create_simple_chunker


def is_heading(text: str) -> bool:
    """Check if text appears to be a heading."""
    text = text.strip()
    if len(text) < 3 or len(text) > 200:
        return False

    # Chapter patterns
    heading_patterns = [
        r"^Chapter\s+\d+",  # Chapter 1
        r"^第[一二三四五六七八九十\d]+章",  # Chinese: 第1章
        r"^[A-Z][A-Z\s]+$",  # ALL CAPS headings
        r"^\d+\.\s+[A-Z]",  # 1. Section Title
        r"^#{1,6}\s+",  # Markdown-style headings
    ]

    for pattern in heading_patterns:
        if re.match(pattern, text, re.IGNORECASE):
            return True

    # Short lines with no punctuation might be headings
    if len(text.split()) <= 6 and not any(c in text for c in ".!?"):
        return True

    return False


class MOBIParser(DocumentParser):
    """Parser for MOBI and AZW3 documents."""

    def __init__(self, file_path: Path):
        super().__init__(file_path)
        self._title: Optional[str] = None

    def get_title(self) -> str:
        """Extract title from filename (MOBI format has limited metadata access)."""
        if self._title:
            return self._title

        # Try to extract title from filename
        # Remove common suffixes like "- Kindle版", "(作者名)" etc.
        stem = self.file_path.stem
        # Clean up common patterns
        stem = re.sub(
            r"\s*[-–—]\s*(Kindle|Amazon|电子书).*", "", stem, flags=re.IGNORECASE
        )
        stem = re.sub(r"\s*\([^)]*\)\s*$", "", stem)  # Remove trailing parentheses
        self._title = stem.strip()
        return self._title

    def parse(self) -> ParsedDocument:
        """Parse MOBI/AZW3 into chunks with hierarchical structure."""
        try:
            import mobi
        except ImportError:
            raise ImportError(
                "The 'mobi' package is required to parse MOBI/AZW3 files. "
                "Install it with: uv add mobi"
            )

        # Extract content using mobi library
        tempdir, filepath = mobi.extract(str(self.file_path))

        try:
            # Read the extracted HTML content
            with open(filepath, "r", encoding="utf-8", errors="replace") as f:
                html_content = f.read()

            # Convert HTML to text
            full_text = self._clean_html(html_content)

            # Update title if found in metadata
            self._extract_title_from_html(html_content)

            # Use simple paragraph chunking
            splitter = create_simple_chunker(chunk_size=1000, overlap=100)
            simple_chunks = splitter.chunk(full_text)

            # Map chunks back to chapters
            chunks: list[Chunk] = []
            current_chapter: Optional[str] = None

            for chunk in simple_chunks:
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
                    "format": self.file_path.suffix.lower().lstrip("."),
                    "total_chunks": len(chunks),
                    "avg_chunk_chars": sum(len(c.content) for c in chunks) / len(chunks)
                    if chunks
                    else 0,
                },
            )
        finally:
            # Cleanup temp directory
            import shutil

            shutil.rmtree(tempdir, ignore_errors=True)

    def _clean_html(self, html_content: str) -> str:
        """Convert HTML to clean text."""
        import html

        # Remove script and style elements
        html_content = re.sub(
            r"<script[^>]*>.*?</script>",
            "",
            html_content,
            flags=re.DOTALL | re.IGNORECASE,
        )
        html_content = re.sub(
            r"<style[^>]*>.*?</style>",
            "",
            html_content,
            flags=re.DOTALL | re.IGNORECASE,
        )

        # Decode HTML entities
        text = html.unescape(html_content)

        # Remove remaining HTML tags
        text = re.sub(r"<[^>]+>", "", text)

        # Clean up whitespace
        text = re.sub(r"\n{3,}", "\n\n", text)
        text = re.sub(r" {2,}", " ", text)

        return text.strip()

    def _extract_title_from_html(self, html_content: str) -> None:
        """Try to extract title from HTML meta tags or heading."""
        # Try to find title in meta tag
        meta_match = re.search(
            r'<meta[^>]*name=["\']title["\'][^>]*content=["\']([^"\']+)',
            html_content,
            re.IGNORECASE,
        )
        if meta_match:
            self._title = meta_match.group(1).strip()
            return

        # Try to find title in dc:title meta
        dc_match = re.search(
            r'<meta[^>]*name=["\']DC.Title["\'][^>]*content=["\']([^"\']+)',
            html_content,
            re.IGNORECASE,
        )
        if dc_match:
            self._title = dc_match.group(1).strip()
            return

        # Try to find first h1 tag
        h1_match = re.search(
            r"<h1[^>]*>(.*?)</h1>", html_content, re.IGNORECASE | re.DOTALL
        )
        if h1_match:
            title = re.sub(r"<[^>]+>", "", h1_match.group(1))
            self._title = title.strip()
