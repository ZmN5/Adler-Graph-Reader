# Adler-Graph-Reader 项目进度

## 当前状态 (2026-03-02)

### ✅ 已完成

1. **代码质量优化** (本次会话)
   - 修复 13 个 ruff lint 警告
   - 修复 parser 模块循环导入
   - 更新 pyproject.toml 使用 dependency-groups

2. **Embedding 双模式支持** (本次会话)
   - 新增 `src/adler_graph_reader/embeddings/` 模块
   - 支持三种模式: `lmstudio` / `local` / `auto`
   - auto 模式下优先使用 LM Studio，失败时自动回退到本地 sentence-transformers
   - 添加 sentence-transformers 依赖

3. **LM Studio 集成** (之前)
   - 支持本地LLM推理
   - 支持embedding生成
   - 默认模型: qwen3.5-35b-a3b
   - Embedding模型: text-embedding-nomic-embed-text-v1.5

4. **核心功能** (之前)
   - PDF/EPUB文档解析
   - 知识图谱提取
   - 混合搜索 (FTS5 + 向量 + RRF)
   - Streamlit Web UI
   - Reranker 集成

### 🔄 待完成

1. **Embedding 提供者集成**
   - 将新的 embedding provider 集成到 LLM client
   - 支持配置默认 embedding 维度

2. **端到端测试**
   - 导入一本 PDF
   - 构建知识图谱
   - 测试搜索功能

3. **概念提取优化**
   - 批量处理模式
   - 进度持久化

### 📋 下一步工作 (优先级排序)

**优先级 1: 端到端测试**
- 导入测试 PDF
- 运行完整流程
- 验证功能正常

**优先级 2: Embedding 集成**
- 将新 provider 集成到数据库/搜索模块
- 配置默认维度 (当前 768)

**优先级 3: 完善功能**
- 优化概念提取
- 添加单元测试

### 技术栈

- Python 3.12+ (uv)
- LM Studio (本地LLM)
- SQLite + FTS5 + sqlite-vec
- Streamlit (UI)
- Pydantic (数据模型)
- sentence-transformers (本地embedding)

### Git 提交历史

- `f18ace1` - fix: 代码质量优化 - 修复 ruff lint 警告
- `dae5c2e` - feat: 实现 Embedding 双模式支持