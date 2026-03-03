"""Tests for document parser module."""

import pytest

from adler_graph_reader.parser import Chunk, ParsedDocument, create_parser
from adler_graph_reader.parser.pdf import PDFParser
from adler_graph_reader.parser.epub import EPUBParser


class TestChunk:
    """Test Chunk dataclass."""

    def test_chunk_creation(self):
        """Test creating a Chunk instance."""
        chunk = Chunk(
            content="Test content",
            page_number=1,
            chapter_title="Chapter 1",
            level=1,
        )

        assert chunk.content == "Test content"
        assert chunk.page_number == 1
        assert chunk.chapter_title == "Chapter 1"
        assert chunk.level == 1

    def test_chunk_defaults(self):
        """Test Chunk with default values."""
        chunk = Chunk(content="Test content")

        assert chunk.content == "Test content"
        assert chunk.page_number is None
        assert chunk.chapter_title is None
        assert chunk.level == 0


class TestParsedDocument:
    """Test ParsedDocument dataclass."""

    def test_parsed_document_creation(self):
        """Test creating a ParsedDocument instance."""
        chunks = [
            Chunk(content="Chunk 1", page_number=1),
            Chunk(content="Chunk 2", page_number=2),
        ]

        doc = ParsedDocument(
            title="Test Document",
            chunks=chunks,
            metadata={"author": "Test Author"},
        )

        assert doc.title == "Test Document"
        assert len(doc.chunks) == 2
        assert doc.metadata["author"] == "Test Author"


class TestCreateParser:
    """Test parser factory function."""

    def test_create_pdf_parser(self, tmp_path):
        """Test creating a PDF parser."""
        pdf_file = tmp_path / "test.pdf"
        pdf_file.touch()

        parser = create_parser(pdf_file)

        assert isinstance(parser, PDFParser)

    def test_create_epub_parser(self, tmp_path):
        """Test creating an EPUB parser."""
        epub_file = tmp_path / "test.epub"
        epub_file.touch()

        parser = create_parser(epub_file)

        assert isinstance(parser, EPUBParser)

    def test_unsupported_format(self, tmp_path):
        """Test that unsupported formats raise ValueError."""
        doc_file = tmp_path / "test.doc"
        doc_file.touch()

        with pytest.raises(ValueError, match="Unsupported file format"):
            create_parser(doc_file)

    def test_create_mobi_parser(self, tmp_path):
        """Test creating a MOBI parser."""
        mobi_file = tmp_path / "test.mobi"
        mobi_file.touch()

        parser = create_parser(mobi_file)

        from adler_graph_reader.parser.mobi import MOBIParser

        assert isinstance(parser, MOBIParser)

    def test_create_azw3_parser(self, tmp_path):
        """Test creating an AZW3 parser."""
        azw3_file = tmp_path / "test.azw3"
        azw3_file.touch()

        parser = create_parser(azw3_file)

        from adler_graph_reader.parser.mobi import MOBIParser

        assert isinstance(parser, MOBIParser)

    def test_create_txt_parser(self, tmp_path):
        """Test creating a TXT parser."""
        txt_file = tmp_path / "test.txt"
        txt_file.touch()

        parser = create_parser(txt_file)

        from adler_graph_reader.parser.txt import TXTParser

        assert isinstance(parser, TXTParser)


class TestPDFParser:
    """Test PDF parser functionality."""

    def test_pdf_parser_init(self, tmp_path):
        """Test PDF parser initialization."""
        pdf_file = tmp_path / "test.pdf"
        pdf_file.touch()

        parser = PDFParser(pdf_file)

        assert parser.file_path == pdf_file


class TestEPUBParser:
    """Test EPUB parser functionality."""

    def test_epub_parser_init(self, tmp_path):
        """Test EPUB parser initialization."""
        epub_file = tmp_path / "test.epub"
        epub_file.touch()

        parser = EPUBParser(epub_file)

        assert parser.file_path == epub_file


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
