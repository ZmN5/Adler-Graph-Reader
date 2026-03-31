# PRD: V2 智能检索与核心概念优化

## 概述

为阅读概念图谱系统引入Embedding向量化、混合检索（向量+BM25+Reranker+RRF）和Source-Grounded总结功能，同时改进Core Concepts提取质量。实现完整的智能阅读助手体验。

## 目标

- 对所有分片进行Embedding向量化存储，支持语义搜索
- 实现混合检索系统：向量检索 + BM25 + Reranker + RRF融合
- 点击图谱节点时自动生成Source-Grounded总结，引用来源可追溯
- 基于社区发现算法（Louvain）改进Core Concepts提取质量
- 确保交互流畅，用户等待时有明确的加载状态

## 用户故事

### US-001: 分片Embedding向量化
**描述:** 作为开发者，我需要对书籍分片进行Embedding向量化，以便支持语义检索。

**Acceptance Criteria:**
- [ ] 新增`chunk_embeddings`表存储向量数据（chunk_id, embedding BLOB, model_name, dimensions）
- [ ] 使用`mlx-community/Qwen3-Embedding-0.6B-4bit-DWQ`模型通过LM Studio API生成embedding
- [ ] 在PDF/EPUB解析完成后自动触发embedding生成（后台异步）
- [ ] embedding以f32数组二进制形式存储，dimensions=1024
- [ ] Typecheck/lint passes

### US-002: BM25全文检索支持
**描述:** 作为用户，我需要BM25关键词检索能力，以便在语义匹配不足时通过关键词补充召回。

**Acceptance Criteria:**
- [ ] 新增SQLite FTS5虚拟表`chunks_fts`用于全文检索
- [ ] 配置触发器自动同步chunks表到FTS5索引
- [ ] 实现BM25搜索接口，支持节点名称和描述作为查询
- [ ] 返回结果包含BM25分数和分片元数据
- [ ] Typecheck/lint passes

### US-003: 混合检索与RRF融合
**描述:** 作为系统，我需要结合向量检索和BM25检索的结果，通过RRF算法融合排序，以提升召回质量。

**Acceptance Criteria:**
- [ ] 实现向量检索：基于余弦相似度计算查询与分片的相似度
- [ ] 实现RRF融合算法（k=60），综合向量检索和BM25的排名
- [ ] 支持配置Top K参数（默认50进RRF，20进Reranker）
- [ ] 新增`node_chunk_ranks`表存储节点-分片相关性排名
- [ ] Typecheck/lint passes

### US-004: Reranker重排序
**描述:** 作为系统，我需要对RRF融合后的候选分片进行Reranker重排序，以提升最相关分片的排名。

**Acceptance Criteria:**
- [ ] 使用LM Studio部署的模型作为Reranker（通过completions API）
- [ ] 构建reranker prompt：给定节点名称和候选分片，返回相关性分数
- [ ] 对Top 20候选分片进行重排序
- [ ] 返回最终结果包含vector_score, bm25_score, final_score
- [ ] Typecheck/lint passes

### US-005: Source-Grounded总结生成
**描述:** 作为用户，我点击图谱节点时希望看到基于书籍内容的Source-Grounded总结，引用可追溯到具体页码。

**Acceptance Criteria:**
- [ ] 点击节点自动触发混合检索（top_k=10）和总结生成
- [ ] 构建NotebookLM风格的source-grounded prompt（包含检索结果）
- [ ] LLM生成总结时每个关键声明必须标注引用[Source: X]
- [ ] 返回结果包含总结文本、引用列表（chunk_id, excerpt, page_number）
- [ ] API端点：`GET /api/nodes/{id}/summary`
- [ ] Typecheck/lint passes

### US-006: 节点详情面板UI优化
**描述:** 作为用户，我在等待总结生成时需要看到加载状态，并能够清晰阅读带引用的总结内容。

**Acceptance Criteria:**
- [ ] 节点面板显示加载指示器（"正在分析相关段落..."）
- [ ] 总结区域显示带引用标记的富文本（[Source: X]可点击高亮）
- [ ] 引用列表区域显示来源详情（页码、内容摘要）
- [ ] 点击引用可跳转到阅读器对应位置
- [ ] 如果生成失败显示错误状态和重试按钮
- [ ] Verify in browser using dev-browser skill

### US-007: 检索结果展示
**描述:** 作为用户，我希望看到检索到的相关段落列表，以便验证总结的来源。

**Acceptance Criteria:**
- [ ] API端点：`GET /api/nodes/{id}/retrieval?top_k=10`
- [ ] 返回结果包含chunk内容、页码、章节、各项分数
- [ ] UI展示检索结果列表，按final_score排序
- [ ] 每个结果显示vector_score、bm25_score、final_score
- [ ] Verify in browser using dev-browser skill

### US-008: Core Concepts改进（社区发现）
**描述:** 作为系统，我需要基于社区发现算法改进Core Concepts提取，以获得更高质量的概念节点。

**Acceptance Criteria:**
- [ ] 引入`petgraph`依赖实现图算法
- [ ] 构建节点-分片关联图（基于node_chunk_ranks）
- [ ] 实现Louvain社区发现算法识别概念社区
- [ ] 基于PageRank + 社区中心性 + 分片覆盖密度计算增强评分
- [ ] 选择Top N百分比作为核心概念（默认10%）
- [ ] Typecheck/lint passes

### US-009: 数据库迁移与数据清理
**描述:** 作为开发者，我需要清理现有数据并按新schema重建数据库。

**Acceptance Criteria:**
- [ ] 新增migration脚本：创建chunk_embeddings、node_chunk_ranks表
- [ ] 新增migration脚本：创建FTS5虚拟表和同步触发器
- [ ] 提供`./scripts/db.sh reset`命令重置数据库（备份旧数据）
- [ ] chunks表新增paragraph_start、paragraph_end字段
- [ ] 重置后新上传书籍自动应用新schema
- [ ] Typecheck/lint passes

### US-010: LM Studio运维集成
**描述:** 作为开发者，我需要通过lms CLI运维embedding和reranker模型。

**Acceptance Criteria:**
- [ ] 在`./scripts/service.sh`中添加模型检查命令：`service.sh check-models`
- [ ] 自动检查`mlx-community/Qwen3-Embedding-0.6B-4bit-DWQ`是否已下载
- [ ] 提供模型启动命令：`service.sh start-models`
- [ ] 文档说明如何手动通过lms CLI管理模型
- [ ] Typecheck/lint passes

## 功能需求

### FR-1: Embedding模块 (embedding.rs)
- FR-1.1: 提供`generate_chunk_embeddings(pool, book_id)`函数，批量为书籍分片生成embedding
- FR-1.2: 调用LM Studio embedding API：`POST /v1/embeddings`，模型`mlx-community/Qwen3-Embedding-0.6B-4bit-DWQ`
- FR-1.3: 支持批量处理（batch_size=32），避免API过载
- FR-1.4: 存储embedding为f32数组二进制形式，dimensions=1024
- FR-1.5: embedding生成在解析完成后异步执行，不阻塞上传流程

### FR-2: 混合检索模块 (retrieval.rs)
- FR-2.1: 提供`HybridRetriever`结构体，封装检索逻辑
- FR-2.2: 实现`vector_search(query, top_k)`：生成查询embedding，计算余弦相似度，返回Top K
- FR-2.3: 实现`bm25_search(query, top_k)`：使用SQLite FTS5 BM25排序，返回Top K
- FR-2.4: 实现`reciprocal_rank_fusion(vector_results, bm25_results, k=60.0)`：RRF融合算法
- FR-2.5: 实现`rerank(node, candidates)`：调用LM Studio API对候选分片重排序
- FR-2.6: 实现`retrieve_for_node(node_id, top_k=10)`：完整检索流程，返回最终结果

### FR-3: Source-Grounded总结 (llm_client.rs)
- FR-3.1: 提供`SourceGroundedSummaryRequest`结构体（node_name, node_description, retrieval_results, language）
- FR-3.2: 提供`SourceGroundedSummary`结构体（summary, citations）
- FR-3.3: 构建NotebookLM风格的prompt，要求LLM基于来源材料生成总结
- FR-3.4: 要求LLM输出引用格式`[Source: X]`，并提供citations数组
- FR-3.5: 解析LLM响应，提取总结文本和引用信息

### FR-4: Core Concepts改进 (core_concept.rs)
- FR-4.1: 实现`build_node_chunk_graph(pool, book_id)`：构建节点-分片二部图
- FR-4.2: 实现`detect_communities(graph)`：使用Louvain算法识别社区
- FR-4.3: 实现`calculate_enhanced_scores(graph, communities)`：综合PageRank+社区中心性+覆盖密度评分
- FR-4.4: 提供`identify_core_concepts_v2(pool, book_id, top_n_percent=0.1)`：返回改进后的核心概念列表

### FR-5: API端点 (main.rs)
- FR-5.1: `GET /api/nodes/{id}/retrieval?top_k={n}`：返回混合检索结果
- FR-5.2: `GET /api/nodes/{id}/summary`：返回Source-Grounded总结
- FR-5.3: 响应格式符合`RetrievalResponse`和`SummaryResponse`结构

### FR-6: 前端交互 (NodeDetailPanel.tsx)
- FR-6.1: 点击节点时自动调用`/api/nodes/{id}/summary`和`/api/nodes/{id}/retrieval`
- FR-6.2: 显示加载状态（skeleton或spinner），文案"正在分析相关段落..."
- FR-6.3: 总结区域渲染带引用标记的文本，[Source: X]样式为可点击链接
- FR-6.4: 引用列表显示来源详情：页码、章节、内容摘要
- FR-6.5: 点击引用可触发父组件事件，跳转到阅读器对应位置
- FR-6.6: 错误状态显示友好提示和重试按钮

## 非目标 (Out of Scope)

- 不支持增量embedding更新（修改书籍需重新上传）
- 不支持多语言embedding模型切换（固定使用Qwen3-Embedding-0.6B-4bit-DWQ）
- 不实现流式总结生成（一次性返回完整结果）
- 不实现用户自定义reranker prompt
- 不实现离线embedding生成（必须依赖LM Studio运行）

## 设计考虑

### UI/UX要求
- 加载状态必须明确：使用进度条或动画，文案友好
- 引用标记视觉突出：使用颜色高亮（如蓝色）+ 上标数字
- 引用列表可折叠：默认折叠，点击展开查看详情
- 响应式布局：节点面板在窄屏下正常显示

### 技术约束
- LM Studio API地址固定`http://localhost:1234`
- Embedding模型已下载在LM Studio中，dimensions=1024
- SQLite不支持原生向量运算，在Rust中计算余弦相似度
- FTS5中文分词可能不完美，BM25作为辅助召回手段

## 技术考虑

### 依赖项
```toml
[dependencies]
petgraph = "0.6"      # 图算法（社区发现）
byteorder = "1.5"     # 二进制向量序列化
```

### 环境变量
```bash
EMBEDDING_MODEL=mlx-community/Qwen3-Embedding-0.6B-4bit-DWQ
EMBEDDING_BATCH_SIZE=32
RETRIEVAL_TOP_K=10
RRF_K=60.0
RERANKER_TOP_K=20
```

### 数据库Schema变更
```sql
-- chunk_embeddings表
CREATE TABLE chunk_embeddings (
    chunk_id TEXT PRIMARY KEY,
    embedding BLOB NOT NULL,
    model_name TEXT NOT NULL,
    dimensions INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE
);

-- node_chunk_ranks表
CREATE TABLE node_chunk_ranks (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL,
    chunk_id TEXT NOT NULL,
    rank_score REAL NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (chunk_id) REFERENCES chunks(id) ON DELETE CASCADE,
    UNIQUE(node_id, chunk_id)
);

-- FTS5虚拟表
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    content,
    content_rowid=rowid,
    tokenize='porter'
);
```

### 关键文件变更
| 文件 | 变更类型 | 说明 |
|------|----------|------|
| backend/src/db.rs | 修改 | 新增表结构、FTS5虚拟表 |
| backend/src/embedding.rs | 新增 | Embedding生成模块 |
| backend/src/retrieval.rs | 新增 | 混合检索系统 |
| backend/src/llm_client.rs | 修改 | Source-Grounded总结 |
| backend/src/core_concept.rs | 修改 | 社区发现算法 |
| backend/src/main.rs | 修改 | 新增API路由 |
| backend/Cargo.toml | 修改 | 新增依赖 |
| frontend/src/components/NodeDetailPanel.tsx | 修改 | 集成总结展示 |
| frontend/src/lib/api-client.ts | 修改 | 新增API调用 |

## 成功指标

- Embedding生成速度：每100个分片<30秒（本地LM Studio）
- 混合检索响应时间：<2秒（top_k=10）
- Source-Grounded总结响应时间：<5秒（取决于LLM）
- Core Concepts质量提升：社区检测后概念分组合理性明显改善
- 用户交互：节点点击到显示总结的完整流程<10秒

## 实现顺序

1. **Phase 1**: 数据库迁移（chunk_embeddings, node_chunk_ranks, FTS5）
2. **Phase 2**: Embedding模块 + 自动触发
3. **Phase 3**: 混合检索（向量 + BM25 + RRF）
4. **Phase 4**: Reranker重排序
5. **Phase 5**: Source-Grounded总结 + API
6. **Phase 6**: 前端UI集成
7. **Phase 7**: Core Concepts改进（社区发现）
8. **Phase 8**: 运维脚本（lms CLI集成）

## 风险与缓解

| 风险 | 可能性 | 影响 | 缓解措施 |
|------|--------|------|----------|
| LM Studio未启动或模型未加载 | 高 | 高 | 提供`service.sh check-models`检查命令，API调用失败时返回友好错误 |
| Embedding生成阻塞上传流程 | 中 | 中 | 使用tokio::spawn异步执行 |
| FTS5中文分词效果差 | 中 | 低 | BM25作为辅助手段，主要依赖向量检索 |
| 大分片embedding内存占用高 | 低 | 中 | 使用流式处理和批量提交 |
| Louvain算法性能差 | 低 | 中 | 使用petgraph优化实现，图书规模通常不大 |

## 验证计划

1. **单元测试**:
   - RRF融合算法正确性
   - 余弦相似度计算正确性
   - Prompt构建正确性

2. **集成测试**:
   - 完整检索流程：上传书籍→解析→embedding→点击节点→返回总结
   - API端点响应格式符合预期

3. **手动测试**:
   - 使用测试书籍验证embedding生成
   - 点击不同节点验证总结质量
   - 检查引用溯源准确性

## Open Questions

- 是否需要缓存节点总结结果？（当前不缓存，每次点击重新生成）
- 是否需要支持多本书籍同时检索？（当前仅支持单书图谱）
- Reranker模型是否固定使用某个特定模型？（当前使用LM Studio loaded模型）
