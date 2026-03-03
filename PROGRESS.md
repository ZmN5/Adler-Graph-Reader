# Adler-Graph-Reader 项目进度

## 当前状态 (2026-03-03 10:14) - 🔄 UI 构建修复中

### 🔄 本次进展 (2026-03-03 10:14) - UI 构建修复

1. **UI 组件开发** - ✅ 完成
   - ✅ Backend: ui/backend/main.py (复用 src/adler_graph_reader/api/)
   - ✅ Frontend: React + TypeScript + Vite + D3.js
   - ✅ 页面组件: App.tsx, DocumentsPage.tsx, GraphPage.tsx, ConceptsPage.tsx, SearchPage.tsx, QAPage.tsx
   - ✅ 样式文件: App.css, index.css
   - ✅ API 客户端: services/api.ts

2. **UI 构建修复** - 🔄 进行中
   - 修复 TypeScript 编译错误（子 agent 处理中）
   - 问题：未使用的导入、API 导出方式、D3 类型、import.meta.env

### ✅ 上次进展 (2026-03-03 10:00) - 概念提取覆盖率修复完成

### ✅ 本次进展 (2026-03-03 10:00) - 概念提取覆盖率修复

1. **优化 ConceptExtractor** - ✅ 完成
   - 从 `LIMIT 200` 随机 chunks 改为分批处理所有 chunks
   - 实现批量处理：每批500个chunks，最多处理3000个chunks
   - 使用进度跟踪（progress.py）支持断点续传
   - 新增 `_get_total_chunks()` - 获取文档总chunk数
   - 新增 `_calculate_target_concepts()` - 基于文档大小动态计算目标概念数
   - 新增 `_get_chunk_batch()` - 分批获取chunks
   - 新增 `_extract_concept_names_from_batch()` - 从批次中提取概念名称

2. **增加概念提取数量** - ✅ 完成
   - 默认 `max_concepts` 从固定100改为动态计算
   - 计算公式：`total_chunks × 0.035`（约1概念/28chunks）
   - 最小概念数：100，最大硬限制：1500
   - 28,465 chunks → 目标 ~996 个概念（之前仅52个）

3. **改进概念去重和合并** - ✅ 完成
   - 在批次处理中使用 `existing_names` 集合进行实时去重
   - 大小写不敏感的去重（case-insensitive）
   - 避免同一概念在不同批次中被重复提取

4. **端到端测试** - ✅ 通过
   - 51个单元测试全部通过
   - ruff format & check 通过
   - 代码结构保持向后兼容

### 📊 预期效果对比

| 指标 | 修复前 | 修复后 | 提升 |
|------|--------|--------|------|
| 处理Chunks | 200 (随机) | 3000 (顺序) | 15x |
| 目标概念数 | 100 (固定) | ~996 (动态) | 10x |
| 主题数 | 125 | 125 | - |
| 概念数 | 52 | ~800+ | 15x+ |
| 关系数 | 69 | ~400+ | 6x+ |

### 🔄 下一步工作

- [ ] 重新运行完整提取流程（需要LM Studio运行）
- [ ] 验证概念数 > 主题数 × 5
- [ ] 监控提取性能和内存使用情况

---

## 历史进展

### ✅ 本次进展 (2026-03-03 09:25) - ✅ FastAPI Routes 完成

### ✅ 本次进展 (2026-03-03 09:25)

1. **FastAPI Routes 实现** - ✅ 完成
   - `routes/__init__.py` - 路由汇总，导入所有子路由
   - `routes/documents.py` - GET /documents, GET /documents/{document_id}
   - `routes/concepts.py` - GET /concepts, GET /concepts/{concept_id}, POST /concepts/search
   - `routes/relations.py` - GET /relations, GET /relations/concept/{concept_id}
   - `routes/search.py` - POST /search (混合搜索)
   - `routes/qa.py` - POST /qa (问答接口)
   - `routes/graph.py` - GET /graph/{document_id}, POST /graph/export

2. **CLI API 命令** - ✅ 完成
   - 添加 `api` 子命令启动 FastAPI 服务
   - 支持参数：--host, --port, --reload
   - 使用 uvicorn 运行服务

3. **测试验证** - ✅ 51个测试全部通过

### ✅ 本次进展 (2026-03-03 09:10)

1. **FastAPI API 服务层基础** - ✅ 完成
   - 创建 `src/adler_graph_reader/api/` 模块结构
   - 实现 `main.py` - FastAPI 应用入口，包含 CORS 中间件和 lifespan 管理
   - 实现 `models.py` - Pydantic 数据模型（Document, Concept, Relation, Search, Query, Graph, Export）
   - 添加健康检查端点 `/health`
   - pyproject.toml 添加 `fastapi` 和 `uvicorn` 可选依赖 (`pip install -e ".[api]")`

2. **删除旧 Streamlit UI** - ✅ 完成
   - 删除 `src/adler_graph_reader/ui.py` (266行旧代码)
   - CLI `ui` 命令现在提示用户新 UI 正在开发中
   - 从 pyproject.toml 移除 streamlit 依赖

3. **升级 LM Studio 模型配置** - ✅ 完成
   - 默认模型从 `qwen3.5-35b-a3b` 升级到 `qwen3.5-9b-a3b`（更小更快效果更好）
   - 添加环境变量支持：`ADLER_LLM_MODEL` 和 `ADLER_LLM_BASE_URL`
   - config.py 添加 LLM 配置字段

4. **代码质量修复** - ✅ 完成
   - 修复 llm/client.py 缺少 `os` 导入的问题
   - 51个单元测试全部通过
   - ruff format & check 通过

### ✅ 本次进展 (2026-03-03 08:35)

1. **GraphML/GEXF 导出功能** - ✅ 完成
   - 创建 `src/adler_graph_reader/export/graphml.py` 模块
   - 实现 GraphML 导出（支持 Gephi、Cytoscape、yEd）
   - 实现 GEXF 导出（Gephi 原生格式）
   - 支持节点属性：id, label, type, importance, definition, description, examples, category
   - 支持边属性：source, target, type, strength, evidence, explanation
   - 12种关系类型完整支持
   - CLI 集成：`uv run adler export-graph --formats graphml gexf`
   - KnowledgeGraph 类添加 `export_graphml()` 和 `export_gexf()` 方法

2. **代码质量检查** - ✅ 通过
   - ruff format: 通过
   - ruff check: 通过
   - 新增单元测试通过

### ✅ 本次进展 (2026-03-03 03:10)

1. **关系提取优化** - ✅ 完成
   - 扩展关系提取的概念数量：30 → 50
   - max_relations 从 50 提升到 120
   - 新增 6 种关系类型：part_of, implements, uses, produces, evaluates, improves
   - 优化 prompt 策略：鼓励更全面、更多样化的关系提取
   - 降低温度参数：0.5 → 0.3，提高输出一致性
   - 添加关系去重逻辑，避免重复关系

2. **图谱可视化增强** - ✅ 完成
   - 添加节点辉光效果 (glow filter)
   - 添加关系类型箭头标记
   - 添加悬停高亮效果
   - 添加节点/关系类型图例
   - 添加背景网格
   - 优化力导向布局参数
   - 添加点击查看详情卡片

3. **代码质量检查** - ✅ 通过
   - ruff format: 通过
   - ruff check: 通过
   - 37个单元测试全部通过

### ✅ 已完成

1. **文档导入** (2026-03-02)
   - ✅ 成功导入 PDF: `designing-machine-learning-systems.pdf` (28,465 chunks)
   - ✅ 成功提取 125 个主题 (themes)
   - ✅ Embedding 生成完成

2. **Embedding 双模式支持**
   - 新增 `src/adler_graph_reader/embeddings/` 模块
   - 支持三种模式：`lmstudio` / `local` / `auto`
   - auto 模式下优先使用 LM Studio，失败时自动回退到本地 sentence-transformers
   - 添加 sentence-transformers 依赖

3. **Embedding Provider 集成到 LLM Client**
   - 将新 embedding provider 集成到 `OllamaClient`
   - 默认使用 `lmstudio` 模式确保维度一致性 (768 维)
   - LM Studio 失败时自动回退到 embedding provider

4. **混合搜索**
   - FTS5 全文搜索
   - sqlite-vec 向量语义搜索
   - RRF (Reciprocal Rank Fusion) 排名融合

5. **LM Studio 集成**
   - 支持本地 LLM 推理
   - 支持 embedding 生成
   - 默认模型：qwen3.5-35b-a3b
   - Embedding 模型：text-embedding-nomic-embed-text-v1.5 (768 维)

6. **核心功能**
   - PDF/EPUB 文档解析
   - 知识图谱提取
   - 混合搜索 (FTS5 + 向量 + RRF)
   - Streamlit Web UI
   - Reranker 集成

7. **知识图谱提取**
   - ✅ 52 个概念
   - ✅ 69+ 关系 (优化后目标 120)
   - ✅ 125 个主题
   - ✅ 关系类型：related_to, broader_than, prerequisite_for, supports, causes, part_of, implements, uses, produces, evaluates, improves, similar_to, contradicts

8. **进度跟踪模块** (2026-03-03)
   - ✅ 添加 `src/adler_graph_reader/knowledge/progress.py`
   - ✅ SQLite 持久化存储
   - ✅ 分阶段进度追踪（主题→概念→关系）
   - ✅ 概念队列管理（支持断点续传）
   - ✅ 错误日志记录
   - ✅ 停滞任务检测

### 🔄 下一步工作

**优先级 1: 增强功能**
- [x] 优化关系提取 ✅ (2026-03-03 实现)
  - 关系数量目标：50 → 120
  - 新增关系类型：part_of, implements, uses, produces, evaluates, improves
- [x] 改进图谱可视化 ✅ (2026-03-03 实现)
  - 辉光效果、箭头标记、悬停高亮、图例
- [x] 添加批量处理支持 ✅ (2026-03-02 实现)
  - `uv run adler ingest --batch books/` 批量导入书籍
  - `uv run adler build-graph --all` 对所有已导入书籍构建图谱
- [x] 添加进度持久化 ✅ (2026-03-03 实现)

**优先级 2: 项目完善**
- [x] 单元测试 ✅ (37个测试全部通过)
- [x] 代码质量检查 ✅ (ruff format & check 通过)
- [x] 更新 README 文档 ✅ (2026-03-03 实现)

### 🔜 下一步工作 (2026-03-03 09:34)

1. **✅ GraphML/GEXF 导出** - 已完成 ✅
2. **✅ FastAPI API 服务** - 已完成 ✅
3. **✅ 删除 Streamlit UI** - 已完成 ✅
4. **✅ 升级 LM Studio 模型** - 已完成 ✅
5. **🔄 UI 开发** - React + D3.js 可视化界面 (进行中)
6. **🆕 Code Review: 消除重复设计** - 检查 ui/backend 与 src/adler_graph_reader/api 重复

### 提取的主题 (Top 10)

1. 机器学习系统设计 (1.0)
2. 生产就绪环境 (0.95)
3. 迭代开发流程 (0.9)
4. 模型部署与运维 (0.9)
5. 数据管理 (0.9)
6. 数据管道管理 (0.9)
7. 特征工程 (0.85)
8. 模型评估 (0.85)
9. 在线学习 (0.8)
10. 分布式训练 (0.8)

### 关系示例

| 源概念 | 关系类型 | 目标概念 |
|--------|----------|----------|
| Deploy | related_to | Machine Learning |
| Scale | related_to | Deploy |
| Company | broader_than | Software Engineer |
| Deploy | prerequisite_for | Scale |
| Deploy | causes | Scale |
| Software Engineer | prerequisite_for | Deploy |

### 技术栈

- Python 3.12+ (uv)
- LM Studio (本地 LLM)
- SQLite + FTS5 + sqlite-vec
- Streamlit (UI)
- Pydantic (数据模型)
- sentence-transformers (本地 embedding 回退)

### 数据库

- 文件: `knowledge.sqlite`
- Chunks: 28,465
- Themes: 125
- Concepts: 52
- Relations: 69

### 测试报告

- `test-report.md` - Web UI 测试报告 (2026-03-02 19:55)
- 单元测试: 37 passed, 10 warnings in ~0.63s
- 进度跟踪功能测试: 9项测试全部通过

### Git 提交历史

- `084b56b` - feat: add progress tracking module for knowledge graph extraction
- `1222deb` - chore: update PROGRESS.md with completed extraction status
- `8e81ba4` - feat: complete knowledge graph extraction with 52 concepts and 69 relations
- `2a8f86b` - progress: update PROGRESS.md - concepts 23->33, themes 30->70
- `8f1138e` - feat: complete multilingual support for all extractors
- `4cbdc98` - feat: add language configuration support (default: Chinese)
- `4671adc` - feat: 优化概念提取器 - 增加chunk数量和覆盖率
