# Claude Code 下一步工作计划

## 📊 当前项目状态 (2026-03-06)

### 核心功能完成情况
| 模块 | 状态 | 备注 |
|------|------|------|
| PDF/EPUB/MOBI/AZW3/TXT 解析 | ✅ 完成 | 支持多格式文档导入 |
| 语义分块 (Chonkie) | ✅ 完成 | 智能 chunking，减少冗余 |
| Embedding 生成 | ✅ 完成 | LM Studio + 本地 fallback |
| 主题提取 | ✅ 完成 | 155 themes (目标: ≥10) |
| 概念提取 | ✅ 完成 | 106 concepts (目标: ≥50) |
| 关系提取 | ✅ 完成 | 100 relations (目标: ≥30) |
| 混合搜索 | ✅ 完成 | BM25 + 向量 + RRF |
| GraphML/GEXF 导出 | ✅ 完成 | 支持 Gephi/Cytoscape |
| FastAPI 后端 | ✅ 完成 | RESTful API 完整 |
| React 前端 | ✅ 完成 | Sigma.js 图谱可视化 |

### 知识图谱数据质量
```
Themes:    155 ✅ (1550% of target)
Concepts:  106 ✅ (212% of target)
Relations: 100 ✅ (333% of target)
```

关系类型分布（多样化）：
- used_by: 36
- similar_to: 27
- prerequisite_for: 19
- uses: 13
- related_to: 5

---

## 🎯 下一步工作优先级

### P0: UI与后端集成（正在进行）
**负责人**: adler-ui-backend-connect (subagent)

任务清单：
- [ ] 验证 API 客户端配置
- [ ] 启动后端服务 (port 8000)
- [ ] 测试 DocumentsPage 文档列表
- [ ] 测试 GraphPage 图谱可视化
- [ ] 测试 ConceptsPage 概念浏览
- [ ] 测试 SearchPage 搜索功能
- [ ] 测试 QAPage 问答功能
- [ ] 修复发现的连接问题

验收标准：所有页面能正常显示后端数据

---

### P1: 概念提取优化（可选增强）
**背景**: 当前106个概念已达目标，但可进一步提升至200+

配置已优化：
- CONCEPTS_PER_CHUNK_RATIO: 0.055
- MAX_CONCEPTS_HARD_LIMIT: 500
- MIN_CONCEPTS: 250

如需执行：
```bash
uv run adler build-graph -d "Designing Machine Learning Systems"
```
预计耗时：20-40分钟

---

### P2: 关系提取增强（可选增强）
**背景**: 当前100个关系已达目标，但可进一步提升至300+

优化方向：
1. 增加关系提取的 LLM prompt 多样性
2. 扩大概念对组合范围
3. 添加更多关系类型（如 part_of, implements, produces）

---

### P3: 性能优化
**待办**:
- [ ] 数据库索引优化（concepts.name, relations.source/target）
- [ ] API 响应缓存
- [ ] 前端图谱渲染性能（大数据集）
- [ ] 批量处理内存优化

---

### P4: 用户体验改进
**待办**:
- [ ] 添加加载状态指示器
- [ ] 错误提示和重试机制
- [ ] 空状态提示（无数据时）
- [ ] 响应式布局（移动端适配）
- [ ] 深色模式支持

---

### P5: 文档和示例
**待办**:
- [ ] 更新 README 截图
- [ ] 添加使用教程视频/GIF
- [ ] 编写 API 文档
- [ ] 添加示例书籍推荐

---

## 🔧 技术债务

### 已知问题
1. **UI端到端测试**: 之前尝试超时，需要手动验证
2. **进程管理**: 后台服务启动/停止需要更健壮的处理
3. **错误处理**: 部分 API 调用缺少错误边界

### 代码质量
- ✅ ruff format 通过
- ✅ ruff check 通过
- ✅ 单元测试通过
- ⚠️ 需要增加集成测试

---

## 📅 建议执行顺序

### 本周（2026-03-06 ~ 03-09）
1. **完成 UI 与后端集成** (P0) - 最高优先级
2. **手动测试全链路功能**
3. **修复发现的 bug**

### 下周（2026-03-10 ~ 03-16）
1. **概念提取优化** (P1) - 如需更高覆盖率
2. **性能优化** (P3) - 数据库索引
3. **用户体验改进** (P4) - 加载状态、错误处理

### 后续
1. **关系提取增强** (P2)
2. **文档完善** (P5)
3. **集成测试套件**

---

## 🚀 部署准备

当以下检查项全部完成时，项目可进入部署阶段：

- [ ] UI 与后端完全集成
- [ ] 所有页面功能正常
- [ ] 性能测试通过（1000+ chunks 流畅处理）
- [ ] 文档完整
- [ ] Docker 化（可选）

---

## 📝 备注

**当前活跃任务**: 
- Subagent: `adler-ui-backend-connect` (运行中)

**历史任务**:
- adler-ui-connect: 多次超时，已终止
- adler-graph-continue-v2: 超时
- adler-code-review: 成功完成

**关键文件位置**:
- 前端: `/ui/frontend/src/`
- 后端 API: `/src/adler_graph_reader/api/`
- 数据库: `/data/knowledge.sqlite`
- 配置: `/src/adler_graph_reader/config.py`
