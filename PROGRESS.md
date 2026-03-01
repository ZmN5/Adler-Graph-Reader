# Adler-Graph-Reader 项目进度

## 当前状态 (2026-03-01)

### ✅ 已完成

1. **LM Studio 集成** - 项目从Ollama迁移到LM Studio
   - 支持本地LLM推理
   - 支持embedding生成
   - 默认模型: qwen3.5-35b-a3b
   - Embedding模型: text-embedding-nomic-embed-text-v1.5

2. **核心功能**
   - PDF/EPUB文档解析
   - 知识图谱提取
   - 混合搜索 (FTS5 + 向量)
   - Streamlit Web UI

### ❌ 进行中/待解决

1. **Structured Output 问题**
   - Instructor库与LM Studio不兼容
   - LM Studio不支持`response_format`参数
   - 需要找替代方案实现结构化输出

2. **核心功能测试**
   - 需要测试完整的ingest -> analyze -> graph流程
   - 需要测试混合搜索

### 📋 下一步工作

**优先级 1: 修复结构化输出**
- 方案A: 使用LM Studio的JSON模式（如果支持）
- 方案B: 使用函数调用/工具调用
- 方案C: 提示词工程 + JSON解析

**优先级 2: 端到端测试**
- 导入一本PDF
- 构建知识图谱
- 测试搜索功能

**优先级 3: 完善功能**
- 优化概念提取
- 添加更多测试
- 完善文档

### 技术栈

- Python 3.12+ (uv)
- LM Studio (本地LLM)
- SQLite + FTS5 + sqlite-vec
- Streamlit (UI)
- Pydantic (数据模型)