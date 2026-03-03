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
- **LLM Model**: `qwen3.5-9b` (对话模型，必须与 LM Studio 中加载的模型名称完全匹配)
- **Embedding Model**: `text-embedding-nomic-embed-text-v1.5` (⚠️ **LM Studio 必须加载此模型**)

### 模型配置（重要！）
```python
# 默认配置在 src/adler_graph_reader/llm/client.py
DEFAULT_MODEL = "qwen3.5-9b"  # 主模型
FALLBACK_MODELS = ["qwen3.5-35b-a3b"]  # 失败时自动回退
DEFAULT_EMBED_MODEL = "text-embedding-nomic-embed-text-v1.5"

# 可通过环境变量覆盖
export ADLER_LLM_MODEL="qwen3.5-9b"
export ADLER_LLM_BASE_URL="http://localhost:1234/v1"
```

#### LM Studio 模型要求
必须在 LM Studio 中加载以下模型：
1. **对话模型**: `qwen3.5-9b` (id: qwen3.5-9b)
2. **Embedding 模型**: `text-embedding-nomic-embed-text-v1.5`

可用模型列表检查：`curl http://localhost:1234/v1/models`
- **Database**: knowledge.sqlite (SQLite + FTS5 + sqlite-vec)

### Embedding 配置（重要！）
```python
# 正确的 embedding 调用方式
client.embed(text)  # 使用 qwen3-embedding via LM Studio

# ❌ 禁止直接使用 sentence-transformers
# ❌ 禁止使用 openai/text-embedding-ada-002
# ❌ 禁止使用其他 embedding 模型
```

## Commands

### 环境要求
- **Python**: 3.12+
- **包管理器**: [uv](https://github.com/astral-sh/uv) (必须)
- **LM Studio**: http://localhost:1234/v1

### 安装依赖
```bash
# 使用 uv 安装所有依赖
uv sync

# 添加新依赖
uv add <package-name>

# 添加开发依赖
uv add --dev pytest ruff
```

### 运行 CLI
```bash
# 所有命令必须通过 uv run 执行
uv run adler --help
uv run adler init-db
uv run adler ingest <file.pdf>
uv run adler analyze <file.pdf> -o output/

# 代码质量检查（必须用 uv run）
uv run ruff check src/
uv run ruff format src/

# 运行测试
uv run pytest tests/ -v
```

### ⚠️ 常见错误
❌ ~~`ruff check src/`~~ → ✅ `uv run ruff check src/`
❌ ~~`python main.py`~~ → ✅ `uv run python main.py`

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
