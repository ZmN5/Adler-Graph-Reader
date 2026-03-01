# Adler-Graph-Reader 技术设计方案

## 参考 QMD Python 项目经验

### 1. Embedding 策略（双模式支持）

**当前问题**：仅依赖 LM Studio API，如果服务不可用则无法工作

**QMD Python 方案**：
- 使用 `sentence-transformers` 库本地加载模型
- 延迟加载（Lazy Loading）：首次使用时才加载模型
- 自动检测维度：`model.get_sentence_embedding_dimension()`
- BGE 模型查询前缀优化：短文本自动添加 `"Represent this sentence for searching relevant passages:"`

**本项目的改进方案**：
```python
class EmbeddingProvider:
    """双模式 Embedding 提供器"""
    
    def __init__(self, mode: str = "auto"):
        # mode: "lmstudio" | "local" | "auto"
        # auto 模式下优先尝试 LM Studio，失败回退到本地
        pass
    
    def encode(self, texts: List[str]) -> np.ndarray:
        # 统一接口，隐藏底层实现
        pass
```

### 2. Reranker 集成（已完成基础，需完善）

**QMD Python 方案**：
- 使用 `Qwen/Qwen3-Reranker-0.6B` 交叉编码器
- 批处理推理（batch_size=8）
- Sigmoid 归一化输出相关性分数
- 设备自动检测：CUDA → MPS → CPU

**本项目待完善**：
- [ ] 将 reranker 真正集成到搜索流程中
- [ ] 添加配置开关控制是否启用 reranker
- [ ] 实现 Top-K 重排序（先召回 50，rerank 后取 Top 10）

### 3. RRF (Reciprocal Rank Fusion) - 混合搜索核心

**QMD Python 未实现，但本项目需要**：

RRF 公式：
```
score = Σ 1/(k + rank_i)
其中 k=60（常数），rank_i 是第 i 个列表中的排名
```

**实现方案**：
```python
def reciprocal_rank_fusion(
    vector_results: List[Tuple[str, float]],  # (doc_id, score)
    fts_results: List[Tuple[str, float]],     # (doc_id, score)
    k: int = 60
) -> List[Tuple[str, float]]:
    """融合向量搜索和全文搜索结果"""
    scores = defaultdict(float)
    
    # 向量搜索排名（按相似度排序）
    for rank, (doc_id, _) in enumerate(vector_results):
        scores[doc_id] += 1.0 / (k + rank)
    
    # 全文搜索排名（按 BM25 排序）
    for rank, (doc_id, _) in enumerate(fts_results):
        scores[doc_id] += 1.0 / (k + rank)
    
    return sorted(scores.items(), key=lambda x: x[1], reverse=True)
```

### 4. 完整搜索流程设计

```
用户查询
    ↓
[Query Expansion] - 可选：扩展同义词/相关词
    ↓
[并行检索]
├── Vector Search (Top 50)
├── FTS5 Search (Top 50)
└── 可能：Keyword Search (Top 20)
    ↓
[RRF Fusion] - 合并多路召回结果
    ↓
[Reranker] - 交叉编码器重排 Top 20
    ↓
返回 Top 10 结果
```

### 5. 概念提取优化（基于 LLM Session 模式）

**QMD Python 的 LLM Session 模式**：
- 维护对话上下文，减少重复 prompt
- 批量处理多个 chunk
- 流式响应处理

**本项目应用**：
```python
class ConceptExtractionSession:
    """概念提取会话，复用 LLM 连接"""
    
    def __init__(self):
        self.llm = LLMClient()
        self.extracted_concepts = []
    
    def process_chunks(self, chunks: List[Chunk]):
        # 批量处理，保持上下文连贯性
        # 避免每个 chunk 都重新建立连接
        pass
```

## 实施计划

### Phase 1: 搜索架构重构（优先级最高）
1. 实现 RRF 融合算法
2. 完善 Reranker 集成
3. 添加搜索配置参数（top_k, rerank_top_k, enable_rrf 等）

### Phase 2: Embedding 双模式
1. 抽象 EmbeddingProvider 接口
2. 实现 LocalEmbeddingProvider（sentence-transformers）
3. 实现 LMStudioEmbeddingProvider
4. 自动回退机制

### Phase 3: 概念提取优化
1. 实现批量处理模式
2. 添加进度持久化（断点续传）
3. 优化 LLM 调用效率

### Phase 4: 端到端测试
1. 导入测试文档
2. 验证完整流程
3. 性能基准测试

## 关键代码位置

- `src/adler_graph_reader/search/engine.py` - 搜索引擎主逻辑
- `src/adler_graph_reader/knowledge/extractor.py` - 概念提取
- `src/adler_graph_reader/embeddings/` - 新增：embedding 提供者
- `src/adler_graph_reader/reranker.py` - 重排序器
