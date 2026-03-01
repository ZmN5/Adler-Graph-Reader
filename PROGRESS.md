# Adler-Graph-Reader 项目进度

## 当前状态 (2026-03-02)

### ✅ 已完成

1. **代码质量优化** (本次会话)
   - 修复 13 个 ruff lint 警告
   - 修复 parser 模块循环导入
   - 更新 pyproject.toml 使用 dependency-groups

2. **Embedding 双模式支持** (本次会话)
   - 新增 `src/adler_graph_reader/embeddings/` 模块
   - 支持三种模式：`lmstudio` / `local` / `auto`
   - auto 模式下优先使用 LM Studio，失败时自动回退到本地 sentence-transformers
   - 添加 sentence-transformers 依赖

3. **Embedding Provider 集成到 LLM Client** (本次会话)
   - 将新 embedding provider 集成到 `OllamaClient`
   - 默认使用 `lmstudio` 模式确保维度一致性 (768 维)
   - LM Studio 失败时自动回退到 embedding provider

4. **端到端测试完成** (本次会话)
   - ✅ 成功导入 PDF: `designing-machine-learning-systems.pdf` (24,200 chunks)
   - ✅ 成功提取 25 个主题 (themes)
   - ✅ 混合搜索功能验证通过 (BM25 + 向量 + RRF)
   - ✅ 搜索测试："neural network" 返回正确结果

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

### 🔄 待完成

1. **概念和关系提取**
   - 运行 `extract-concepts` 提取概念
   - 运行 `extract-relations` 提取关系
   - 优化提取 prompt

2. **概念提取优化**
   - 批量处理模式
   - 进度持久化
   - 添加单元测试

### 📋 下一步工作 (优先级排序)

**优先级 1: 完成知识图谱构建**
- 运行概念提取
- 运行关系提取
- 验证完整图谱

**优先级 2: 完善功能**
- 优化概念提取 prompt
- 添加批量处理支持
- 添加进度持久化

**优先级 3: 测试和文档**
- 添加单元测试
- 完善使用文档

### 技术栈

- Python 3.12+ (uv)
- LM Studio (本地 LLM)
- SQLite + FTS5 + sqlite-vec
- Streamlit (UI)
- Pydantic (数据模型)
- sentence-transformers (本地 embedding 回退)

### Git 提交历史

- `[pending]` - feat: Embedding Provider 集成 + 端到端测试验证
- `f18ace1` - fix: 代码质量优化 - 修复 ruff lint 警告
- `dae5c2e` - feat: 实现 Embedding 双模式支持
