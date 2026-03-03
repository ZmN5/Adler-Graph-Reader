# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Adler-Graph-Reader is a Python CLI tool that reads PDF/EPUB documents, extracts structured knowledge using local LLM (via LM Studio/Ollama), and generates an Obsidian-compatible Markdown knowledge base with bidirectional links.

### Core Philosophy (Zero-Bloat)
- No heavy frameworks (LangChain, LangGraph, LlamaIndex)
- Pure Python functional programming
- OpenAI-compatible API (LM Studio, Ollama, etc.)
- Hybrid search: SQLite (FTS5 + sqlite-vec) instead of vector DBs

## Environment

- **Python**: 3.12+ (managed by uv)
- **Runtime**: LM Studio (http://localhost:1234/v1)
- **Models**: Any locally loaded model in LM Studio
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

## Code Quality Standards (NO Dirty Code)

### ❌ 禁止事项
- **重复设计/实现**: 同一功能不得有多个独立实现（如两个 FastAPI 服务）
- **代码复制**: 相同逻辑必须提取为共享函数/类
- **临时方案长期化**: TODO/FIXME 必须在下一个迭代解决
- **未使用的代码**: 废弃代码立即删除，不要注释保留

### ✅ 架构原则
- **Single Source of Truth**: 每个功能只有一个官方实现位置
- **DRY (Don't Repeat Yourself)**: 提取公共逻辑到 `utils/` 或共享模块
- **Explicit over Implicit**: 配置显式化，拒绝魔法值
- **Composition over Inheritance**: 优先组合而非继承

### 🔍 Code Review Checklist
提交前必须检查：
- [ ] 是否有类似功能的现有实现？
- [ ] 是否复制了其他模块的代码？
- [ ] 新增 API 端点是否与现有端点重叠？
- [ ] 是否可以复用现有数据模型？
- [ ] 单元测试是否覆盖新增代码？

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
- **llm**: `OllamaClient` wraps OpenAI SDK for LM Studio/Ollama compatibility (instructor for structured output)
- **knowledge**: Pure Pydantic models, no business logic
- **search**: `HybridSearchEngine` composes BM25 + vector + RRF fusion (no reranking)
- **output**: Stateless generators, writer handles file I/O

### Database Schema

- **document_tree**: Hierarchical (parent_id for chapter/chunk tracking)
- **fts_chunks**: FTS5 virtual table for BM25 search
- **vec_chunks**: sqlite-vec (1536-dim) for semantic search

### Pipeline Stages

1. **Ingestion** (`ingest`): Parse → chunk with parent_id → FTS5 + embeddings
2. **Analysis** (`analyze`): Map-Reduce summarization → concept extraction
3. **Search** (`search`): Hybrid search with RRF fusion (no LLM reranking)
4. **Output**: Pure file I/O → Obsidian [[wikilinks]]
