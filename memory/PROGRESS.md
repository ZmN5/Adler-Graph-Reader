# Adler-Graph-Reader 项目进度

## 当前状态 (2026-03-01 22:30)

### ✅ 已完成

1. **LM Studio 集成** - 项目从Ollama迁移到LM Studio
   - 支持本地LLM推理
   - 支持embedding生成
   - 默认模型: qwen3.5-35b-a3b
   - Embedding模型: text-embedding-nomic-embed-text-v1.5

2. **关键Bug修复**
   - ✅ 修复结构化输出问题：使用 `Mode.MD_JSON` 替代 `Mode.JSON`，解决与LM Studio的兼容性问题
   - ✅ 修复embedding维度不匹配：将 `EMBEDDING_DIM` 从1024改为768，匹配nomic-embed-text-v1.5模型

3. **核心功能**
   - PDF/EPUB文档解析
   - 知识图谱提取
   - 混合搜索 (FTS5 + 向量)
   - Streamlit Web UI

### ❌ 进行中/待解决

1. **端到端测试**
   - 需要测试完整的ingest -> analyze -> graph流程
   - 需要验证数据库初始化、文档导入、知识提取是否正常工作

2. **代码质量**
   - 需要添加更多单元测试
   - 需要完善错误处理

### 📋 下一步工作（按优先级）

**优先级 1: 完成端到端测试**
- [ ] 运行 `uv run adler init-db` 初始化数据库
- [ ] 运行 `uv run adler ingest books/<sample>.pdf` 测试文档导入
- [ ] 运行 `uv run adler build-graph` 测试知识图谱构建
- [ ] 运行 `uv run adler search "test query"` 测试搜索功能

**优先级 2: 优化和增强**
- [ ] 添加批量导入功能
- [ ] 优化概念提取算法
- [ ] 改进Web UI的图谱可视化

**优先级 3: 文档和测试**
- [ ] 编写更多单元测试
- [ ] 更新API文档
- [ ] 添加使用示例

### 技术栈

- Python 3.12+ (uv)
- LM Studio (本地LLM, http://localhost:1234/v1)
- SQLite + FTS5 + sqlite-vec
- Streamlit (UI)
- Pydantic (数据模型)
- instructor (结构化输出, MD_JSON模式)

### 最近提交

```
b59220e fix: set EMBEDDING_DIM to 768 for nomic-embed-text model
21ea19a fix: use MD_JSON mode for LM Studio structured output compatibility
f7f11ea docs: add project progress tracking
2c707e7 feat: migrate to LM Studio for local LLM support
```
