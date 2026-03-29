# Intelligent Reading Concept Graph

智能阅读概念图谱系统 - 本地化知识管理工具，通过 LLM 将 EPUB/PDF 文档转化为结构化概念图谱。

## 功能特性

- **文档解析**: 支持 PDF 和 EPUB 格式自动解析
- **概念提取**: 调用本地 LLM (LM Studio) 自动提取概念和关系
- **知识图谱**: WebGL 加速的可视化概念图谱，支持缩放、拖拽、点击交互
- **全局视图**: 跨书籍的概念合并和聚合分析
- **来源追溯**: 点击概念节点可跳转回原文高亮显示
- **双语支持**: 中文/英文界面切换

## 系统要求

- **Rust** (stable, via rustup)
- **Node.js** 18+
- **LM Studio** (用于本地 LLM 概念提取)

## 快速开始

### 1. 启动 LM Studio

下载并启动 [LM Studio](https://lmstudio.ai/)，加载一个适合概念提取的模型（如 Llama 3.1）。

确保 LM Studio API 可访问地址: `http://localhost:1234/v1`

### 2. 启动后端

```bash
cd backend
cargo run
```

后端服务将运行在 `http://localhost:8080`

### 3. 启动前端

```bash
cd frontend
npm install
npm run dev
```

前端服务将运行在 `http://localhost:5173`

### 4. 开始使用

1. 打开浏览器访问 `http://localhost:5173`
2. 拖拽上传 PDF 或 EPUB 文件
3. 上传完成后点击 **Extract** 按钮触发概念提取
4. 等待提取完成（进度条会显示状态）
5. 点击图书卡片打开阅读器 + 图谱双栏视图
6. 点击图谱节点查看概念详情和来源引用

## 项目结构

```
reader-v3/
├── backend/                 # Rust + Axum 后端
│   ├── src/
│   │   ├── main.rs          # 服务器入口、路由、处理器
│   │   ├── llm_client.rs    # LM Studio API 客户端
│   │   ├── extractor.rs     # 概念提取管道
│   │   ├── pdf_parser.rs    # PDF 解析
│   │   └── epub_parser.rs   # EPUB 解析
│   └── Cargo.toml
├── frontend/                # React + TypeScript 前端
│   ├── src/
│   │   ├── components/      # UI 组件
│   │   ├── hooks/           # React Hooks
│   │   ├── lib/              # 工具函数、API 客户端
│   │   └── stores/           # Zustand 状态管理
│   └── package.json
├── data/                    # 数据存储
│   ├── books/               # 上传的图书文件
│   └── reader.db            # SQLite 数据库
└── README.md
```

## API 文档

### 图书管理

| 方法 | 路径 | 描述 |
|------|------|------|
| POST | `/api/books/upload` | 上传 PDF/EPUB 文件 |
| GET | `/api/books` | 获取图书列表 |
| GET | `/api/books/:id` | 获取图书详情 |
| DELETE | `/api/books/:id` | 删除图书 |
| GET | `/api/books/:id/chunks` | 获取图书分块 |
| POST | `/api/books/:id/parse` | 解析图书（生成 chunks） |
| POST | `/api/books/:id/extract` | 触发概念提取 |

### 知识图谱

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/books/:id/graph` | 获取单书概念图谱 |
| GET | `/api/graph/global` | 获取全局概念图谱 |
| GET | `/api/nodes/:id` | 获取节点详情 |

### 设置

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | `/api/settings/language` | 获取界面语言 |
| PUT | `/api/settings/language` | 设置界面语言 |

## 技术栈

### 后端
- **框架**: Axum 0.8
- **数据库**: SQLite + sqlx
- **文档解析**: pdf-extract, zip (EPUB)
- **LLM**: reqwest + OpenAI 兼容 API

### 前端
- **框架**: React 18 + TypeScript
- **构建**: Vite 6
- **样式**: Tailwind CSS + shadcn/ui
- **状态**: Zustand
- **图谱**: react-force-graph-2d (WebGL)
- **PDF**: pdf.js
- **EPUB**: epub.js

## 数据模型

```
books
├── id (UUID)
├── title
├── author
├── file_path
├── format (pdf/epub)
└── total_pages

chunks
├── id (UUID)
├── book_id (FK)
├── page_start
├── page_end
└── content

nodes
├── id (UUID)
├── name
├── description
├── examples (JSON array)
├── source_chunk_ids (JSON array)
└── language

edges
├── id (UUID)
├── source_node_id (FK)
├── target_node_id (FK)
└── relation_type
```

## 开发说明

### 后端开发

```bash
cd backend
cargo run              # 开发模式运行
cargo check            # 类型检查
cargo build            # 构建
```

### 前端开发

```bash
cd frontend
npm run dev            # 开发服务器
npm run build          # 生产构建
npm run typecheck      # 类型检查
```

### 数据库

SQLite 数据库文件位于 `./data/reader.db`，首次运行自动创建表结构。

### LLM 提示词

概念提取使用中文/英文双语提示词，根据设置的语言自动切换。系统提示词定义在 `backend/src/llm_client.rs`。

## 用户故事进度

| ID | 标题 | 状态 |
|----|------|------|
| US-001 ~ US-011 | 后端核心功能 | ✅ 完成 |
| US-012 ~ US-018 | 前端基础组件 | ✅ 完成 |
| US-019 ~ US-023 | 图谱与交互功能 | ✅ 完成 |

详见 [progress.txt](./progress.txt)。
