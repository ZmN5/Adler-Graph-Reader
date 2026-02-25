# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Adler-Graph-Reader is a Python CLI tool that reads PDF/EPUB documents, extracts structured knowledge using local Qwen3 model (via Ollama), and generates an Obsidian-compatible Markdown knowledge base with bidirectional links.

### Core Philosophy (Zero-Bloat)
- No heavy frameworks (LangChain, LangGraph, LlamaIndex)
- Pure Python functional programming
- Direct Ollama API via OpenAI SDK
- Hybrid search: SQLite (FTS5 + sqlite-vec) instead of vector DBs

## Environment

- **Python**: 3.12+ (managed by uv)
- **Runtime**: Ollama (http://localhost:11434/v1)
- **Models**: qwen3 (14b/32b) for reasoning, gte-qwen2-1.5b for embeddings
- **Database**: knowledge.sqlite (SQLite + FTS5 + sqlite-vec)

## Commands

```bash
# Install dependencies
uv add pymupdf openai pydantic instructor sqlite-vec ebooklib

# Run the CLI
uv run adler --help
uv run adler init-db
uv run adler ingest <file.pdf>
uv run adler analyze <file.pdf> -o output/

# Or use python directly
uv run python main.py --help
```

## Architecture (SOLID Principles)

```
src/adler_graph_reader/
├── __init__.py           # Package entry
├── cli.py                # CLI interface (commands: init-db, ingest, analyze, search)
├── database.py            # SQLite + FTS5 + sqlite-vec initialization & queries
├── parser/               # Document parsing (Single Responsibility)
│   ├── __init__.py       # Abstract DocumentParser + Factory
│   ├── pdf.py            # PyMuPDF implementation
│   └── epub.py           # ebooklib implementation
├── llm/                  # LLM integration (Open/Closed for new models)
│   ├── __init__.py
│   ├── client.py         # OllamaClient (JSON mode via instructor)
│   └── models.py         # Pydantic response schemas
├── knowledge/            # Domain models (Interface Segregation)
│   ├── __init__.py
│   └── models.py         # BookAnalysis, ConceptNode, Argument
├── search/               # Hybrid search engine
│   ├── __init__.py
│   ├── engine.py         # HybridSearchEngine (BM25 + Vector + RRF + Rerank)
│   └── fusion.py         # Reciprocal Rank Fusion
└── output/               # Markdown generation
    ├── __init__.py
    ├── markdown.py       # MarkdownGenerator (pure file I/O)
    └── writer.py         # ObsidianWriter (YAML frontmatter + wikilinks)
```

### Module Design

- **parser**: Each format (PDF, EPUB) is a separate class implementing `DocumentParser`
- **llm**: `OllamaClient` wraps OpenAI SDK with instructor for structured output
- **knowledge**: Pure Pydantic models, no business logic
- **search**: `HybridSearchEngine` composes BM25 + vector + RRF + reranking
- **output**: Stateless generators, writer handles file I/O

### Database Schema

- **document_tree**: Hierarchical (parent_id for chapter/chunk tracking)
- **fts_chunks**: FTS5 virtual table for BM25 search
- **vec_chunks**: sqlite-vec (1536-dim) for semantic search

### Pipeline Stages

1. **Ingestion** (`ingest`): Parse → chunk with parent_id → FTS5 + embeddings
2. **Analysis** (`analyze`): Map-Reduce summarization → concept extraction
3. **Search** (`search`): Hybrid search with RRF fusion and LLM reranking
4. **Output**: Pure file I/O → Obsidian [[wikilinks]]
