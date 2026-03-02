# Adler-Graph-Reader 项目进度

## 当前状态 (2026-03-02 16:07)

### ✅ 已完成

1. **文档导入** (2026-03-02)
   - ✅ 成功导入 PDF: `designing-machine-learning-systems.pdf` (28,465 chunks)
   - ✅ 成功提取 70 个主题 (themes)
   - ✅ Embedding 生成完成

2. **Embedding 双模式支持** (之前会话)
   - 新增 `src/adler_graph_reader/embeddings/` 模块
   - 支持三种模式：`lmstudio` / `local` / `auto`
   - auto 模式下优先使用 LM Studio，失败时自动回退到本地 sentence-transformers
   - 添加 sentence-transformers 依赖

3. **Embedding Provider 集成到 LLM Client** (之前会话)
   - 将新 embedding provider 集成到 `OllamaClient`
   - 默认使用 `lmstudio` 模式确保维度一致性 (768 维)
   - LM Studio 失败时自动回退到 embedding provider

4. **混合搜索** (之前会话)
   - FTS5 全文搜索
   - sqlite-vec 向量语义搜索
   - RRF (Reciprocal Rank Fusion) 排名融合

5. **LM Studio 集成** (之前)
   - 支持本地 LLM 推理
   - 支持 embedding 生成
   - 默认模型：qwen3.5-35b-a3b
   - Embedding 模型：text-embedding-nomic-embed-text-v1.5 (768 维)

6. **核心功能** (之前)
   - PDF/EPUB 文档解析
   - 知识图谱提取
   - 混合搜索 (FTS5 + 向量 + RRF)
   - Streamlit Web UI
   - Reranker 集成

### ✅ 本次进展 (2026-03-02 16:07)

1. **概念提取** - 已提取 33 个概念 (从 23 增加到 33)
2. **关系提取** - 保持 30 个关系
3. **主题提取** - 已提取 70 个主题

### 🔄 下一步

1. 继续提取更多概念 (目标 50+)
2. 验证知识图谱完整性
3. 启动 Web UI 验证可视化

### 📋 下一步工作 (优先级排序)

**优先级 1: 完成知识图谱构建**
- [x] 文档导入 (28,465 chunks)
- [x] 主题提取 (30 themes)
- [ ] 概念提取 (23/目标 50+)
- [x] 关系提取 (30/目标 50+)
- [ ] 验证完整图谱

**优先级 2: 完善功能**
- 优化概念提取 prompt
- 添加批量处理支持
- 添加进度持久化
- 启动 Web UI 验证图谱可视化

**优先级 3: 测试和文档**
- 添加单元测试
- 完善使用文档

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

### 当前概念示例

- Machine Learning
- Deploy (部署)
- Scale (扩展)
- Data Engineering
- End-to-End ML
- Model Scaling

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
- Themes: 70
- Concepts: 33
- Relations: 30

### Git 提交历史

- `86050c2` - docs: update PROGRESS.md with code review todo and current status
- `cf57084` - config: increase timeout to 300s and disable thinking for faster LLM responses
- `7e3b396` - fix: make EnhancedConcept.explanation optional and remove examples min_items constraint