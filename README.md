# Adler Graph Reader - 艾德勒图谱阅读器

📚 **从 PDF/EPUB 书籍中提取结构化知识图谱的 Python CLI 工具**

受 [Mortimer Adler《如何阅读一本书》](https://www.amazon.com/How-Read-Book-Mortimer-Adler/dp/0671212095) 启发，帮助你从被动阅读转向主动知识构建。

---

## ✨ 特性

- 📖 **多格式支持** - PDF / EPUB 文档解析
- 🧠 **AI 知识提取** - 使用本地 Qwen3 模型提取主题、概念、关系
- 🔍 **混合搜索** - SQLite FTS5 全文搜索 + sqlite-vec 向量语义搜索
- 🕸️ **知识图谱** - 自动生成概念间的 bidirectional 关系网络（12种关系类型）
- 💬 **智能问答** - 基于提取的知识图谱回答问题
- 🖥️ **Web UI** - Streamlit 可视化界面，支持图谱浏览和搜索
- 📝 **Obsidian 输出** - 生成带双向链接的 Markdown 笔记
- 📤 **批量处理** - 支持批量导入和批量构建知识图谱
- 📊 **进度跟踪** - SQLite 持久化存储，支持断点续传
- 🔧 **LM Studio 集成** - 支持本地 LLM 推理和向量 Embedding
- 🔄 **双模式 Embedding** - `lmstudio` / `local` / `auto` 三种模式，自动回退

---

## 🚀 快速开始

### 环境要求

- Python 3.12+
- [uv](https://github.com/astral-sh/uv) 包管理器
- [LM Studio](https://lmstudio.ai) (推荐) 或 [Ollama](https://ollama.ai)
- 本地 LLM 模型（如 qwen3.5-35b-a3b）

### 安装

```bash
# 克隆项目
cd Adler-Graph-Reader

# 安装依赖
uv sync

# 验证安装
uv run adler --help
```

### 配置 LM Studio（推荐）

```bash
# 在 LM Studio 中下载模型
# 推荐模型：qwen3.5-35b-a3b
# Embedding 模型：nomic-embed-text-v1.5

# 启动 LM Studio 本地服务器（默认 http://localhost:1234/v1）
# 或使用 Ollama
ollama serve
```

### 批量导入书籍

```bash
# 批量导入整个目录的书籍
uv run adler ingest --batch books/

# 对所有已导入的书籍构建知识图谱
uv run adler build-graph --all
```

---

## 📖 使用指南

### 1️⃣ 初始化数据库

```bash
uv run adler init-db
```

### 2️⃣ 导入书籍

```bash
# 导入 PDF 或 EPUB
uv run adler ingest books/my-book.pdf
uv run adler ingest books/learning-python.epub --title "Learning Python"
```

### 3️⃣ 构建知识图谱

```bash
# 完整流程：导入 + 提取主题 + 概念 + 关系
uv run adler build-graph books/how-to-read-a-book.pdf

# 或对已导入的文档提取
uv run adler build-graph -d "How to Read a Book"
```

### 4️⃣ 查看知识图谱

```bash
# 文本格式
uv run adler graph -d "How to Read a Book"

# JSON 格式
uv run adler graph -d "How to Read a Book" --format json

# 可视化数据
uv run adler graph -d "How to Read a Book" --format viz
```

### 5️⃣ 提问与探索

```bash
# 提问（自动创建会话）
uv run adler qa "什么是分析阅读？" -d "How to Read a Book"

# 指定会话 ID（保持对话上下文）
uv run adler qa "如何应用这个方法？" -d "How to Read a Book" -s session-123
```

### 6️⃣ 启动 Web UI

```bash
# 默认端口 8501
uv run adler ui

# 指定端口
uv run adler ui --port 9000

# 不自动打开浏览器
uv run adler ui --no-browser
```

然后访问 http://localhost:8501

---

## 🏗️ 架构设计

### 核心模块

```
src/adler_graph_reader/
├── cli.py                # CLI 入口（ingest/analyze/build-graph/qa/search/ui）
├── database.py           # SQLite + FTS5 + sqlite-vec 初始化与查询
├── parser/               # 文档解析
│   ├── pdf.py            # PyMuPDF 实现
│   └── epub.py           # ebooklib 实现
├── llm/                  # LLM 集成
│   ├── client.py         # OllamaClient（OpenAI SDK + instructor）
│   └── models.py         # Pydantic 响应模型
├── knowledge/            # 知识提取
│   ├── extractor.py      # 主题/概念/关系提取器
│   └── models.py         # 领域模型（Theme/Concept/Relation）
├── search/               # 搜索引擎
│   ├── engine.py         # 混合搜索（BM25 + Vector + RRF）
│   └── fusion.py         # 倒数排名融合
└── output/               # 输出生成
    ├── markdown.py       # Markdown 生成器
    └── writer.py         # Obsidian 写入器（YAML + 双向链接）
```

### 数据流程

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   PDF/EPUB  │ ──▶ │   Parser    │ ──▶ │   Chunks    │
└─────────────┘     └─────────────┘     └─────────────┘
                                              │
                                              ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Obsidian   │ ◀── │   Output    │ ◀── │   LLM       │
│   Markdown  │     │  Generator  │     │  Extract    │
└─────────────┘     └─────────────┘     └─────────────┘
                                              │
                                              ▼
                                      ┌─────────────┐
                                      │   SQLite    │
                                      │ FTS5 + vec  │
                                      └─────────────┘
```

### 数据库 Schema

| 表名 | 描述 |
|------|------|
| `document_tree` |  hierarchical 文档结构（book → chapter → chunk） |
| `fts_chunks` | FTS5 虚拟表（BM25 全文搜索） |
| `vec_chunks` | sqlite-vec 虚拟表（1536 维向量） |
| `themes` | 提取的主题 |
| `concepts` | 提取的概念（带定义和示例） |
| `concept_relations` | 概念间关系（relates_to/similar_to/broader_than 等） |
| `qa_sessions` | 问答会话历史 |

---

## 🛠️ 开发指南

### 运行测试

```bash
# 安装测试依赖
uv add --dev pytest pytest-cov

# 运行测试
uv run pytest tests/ -v --cov=src

# 运行特定测试
uv run pytest tests/test_extractor.py -v
```

### 代码质量

```bash
# 格式化
uv run ruff format src/

# Lint
uv run ruff check src/
```

### 添加新功能

1. 在 `src/adler_graph_reader/` 下创建新模块
2. 在 `cli.py` 中添加新命令
3. 编写单元测试
4. 更新文档

---

## 📚 示例书籍

项目包含示例书籍在 `books/` 目录：

```bash
books/
├── how-to-read-a-book.pdf      # 《如何阅读一本书》
├── thinking-fast-and-slow.epub # 《思考，快与慢》
└── ...
```

---

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

### 待办事项

- [x] 添加更多单元测试 (37个测试全部通过)
- [x] 支持更多 LLM 后端（LM Studio 集成）
- [x] 改进 Web UI 的图谱可视化（D3.js / Cytoscape）
- [x] 支持批量导入书籍
- [ ] 添加知识图谱导出（GraphML / GEXF）
- [ ] 支持更多文档格式（MOBI, AZW3, TXT）
- [ ] 添加 API 服务（FastAPI）

---

## 📄 许可证

MIT License

---

## 🙏 致谢

- [Mortimer Adler](https://www.amazon.com/How-Read-Book-Mortimer-Adler/dp/0671212095) - 《如何阅读一本书》
- [Ollama](https://ollama.ai) - 本地 LLM 运行
- [Qwen3](https://github.com/QwenLM/Qwen) - 阿里通义千问模型
- [sqlite-vec](https://github.com/asg017/sqlite-vec) - SQLite 向量搜索
- [Streamlit](https://streamlit.io) - Web UI 框架

---

**🦞 由 何二时 构建**
