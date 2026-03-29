# PRD: Bug Fixes Sprint - Intelligent Reading Concept Graph

## Introduction

本次 PRD 涵盖智能阅读概念图谱系统中5个关键 bug 的修复。这些问题影响核心功能的可用性和用户体验，需要并行修复以恢复系统稳定性。

### 问题清单
1. **Core Concepts 显示 0 条并报错** - API 返回格式与前端期望不匹配
2. **Source Citations/Related Concepts 无法点击跳转** - hex ID 显示但无交互功能
3. **Graph 视图卡顿** - 大量节点渲染性能问题
4. **Graph 节点难以区分和点击** - 节点过多时视觉混乱、交互困难
5. **EPUB 格式无法展示和抽取** - EPUB 解析器存在兼容性问题

## Goals

- 修复 Core Concepts 数据获取和展示问题，确保正常显示
- 使 Source Citations 和 Related Concepts 可点击并跳转到原文位置
- 优化 Graph 渲染性能，确保流畅交互（目标：60fps）
- 改进 Graph 节点可视化设计，支持分组、筛选，提升可区分性
- 修复 EPUB 解析和展示功能，使其与 PDF 功能对等

## User Stories

### US-001: 修复 Core Concepts API 返回格式问题
**Description:** As a user, I want to see the correct list of core concepts so that I can quickly access important concepts from the book.

**Acceptance Criteria:**
- [ ] 修复 `getCoreConcepts` API 返回格式，确保返回数组而非对象
- [ ] 前端添加类型检查，防御性处理非数组返回
- [ ] 当返回空数组时显示友好提示而非报错
- [ ] 后端确保 SQL 查询正确返回 core concepts 列表
- [ ] Typecheck passes
- [ ] Verify in browser: Core Concepts 列表正常显示，无 console 报错

### US-002: Source Citations 点击跳转 PDF/EPUB
**Description:** As a user, I want to click on source citations to jump to the exact location in the PDF so that I can verify the context.

**Acceptance Criteria:**
- [ ] 修改 `NodeDetailPanel` 中 Source Citations 的展示方式，显示可理解的摘要而非 hex
- [ ] 点击 Source Citation 时调用 `onCitationClick` 回调并传递 chunk ID
- [ ] `MainContent` 组件接收 chunk ID 并定位到对应 PDF 页面高亮显示
- [ ] 支持 PDF 和 EPUB 两种格式的定位跳转
- [ ] Typecheck passes
- [ ] Verify in browser: 点击 citation 正确跳转到原文位置

### US-003: Related Concepts 显示节点名称并支持点击
**Description:** As a user, I want to see related concept names instead of hex IDs so that I can understand the relationships.

**Acceptance Criteria:**
- [ ] 修改 `NodeDetailPanel` 获取关联节点的完整信息（名称、描述）
- [ ] Related Concepts 列表显示节点名称而非 hex ID
- [ ] 点击 Related Concept 触发 `onNodeClick` 显示该节点详情
- [ ] 支持点击 relation type 筛选（可选增强）
- [ ] Typecheck passes
- [ ] Verify in browser: Related Concepts 显示名称，点击可查看详情

### US-004: 优化 Graph 渲染性能
**Description:** As a user, I want the concept graph to render smoothly even with many nodes so that I can interact without lag.

**Acceptance Criteria:**
- [ ] 实现节点数量限制（初始只渲染前 N 个核心概念）
- [ ] 添加虚拟化或懒加载机制，视口外节点不渲染
- [ ] 优化 force simulation 参数，减少计算开销
- [ ] 使用 `useMemo`/`useCallback` 减少不必要的重渲染
- [ ] 目标：100+ 节点时仍保持 60fps 交互
- [ ] Typecheck passes
- [ ] Verify in browser: Graph 缩放/拖拽流畅，无明显卡顿

### US-005: Graph 节点分组与聚类
**Description:** As a user, I want related concepts to be grouped visually so that I can understand the structure of knowledge.

**Acceptance Criteria:**
- [ ] 根据 `category` 或 `relation_type` 对节点进行颜色编码分组
- [ ] 添加图例显示不同分组的含义
- [ ] 相同分组的节点在 graph 中自然聚集（调整力导向参数）
- [ ] 添加分组筛选器，可选择显示/隐藏特定分组
- [ ] Typecheck passes
- [ ] Verify in browser: 节点按分组显示不同颜色，图例可交互

### US-006: Graph 节点筛选功能
**Description:** As a user, I want to filter the graph to show only core concepts or specific categories so that I can focus on what's important.

**Acceptance Criteria:**
- [ ] 添加筛选工具栏：只显示 Core Concepts / 显示全部
- [ ] 添加按 Category 筛选下拉框
- [ ] 添加按节点名称搜索功能
- [ ] 筛选后 graph 自动重新布局
- [ ] 筛选状态持久化到 URL query params（可选）
- [ ] Typecheck passes
- [ ] Verify in browser: 筛选器正常工作，graph 正确过滤

### US-007: 改进 Graph 节点可视化设计
**Description:** As a user, I want nodes to be visually distinct and easy to click so that I can navigate the graph intuitively.

**Acceptance Criteria:**
- [ ] 增大节点最小尺寸，确保可点击区域不小于 44x44px
- [ ] 添加节点悬停效果（放大、阴影、tooltip）
- [ ] 节点标签在缩放较小时显示缩写或图标
- [ ] 核心概念节点添加特殊标识（皇冠图标、发光效果）
- [ ] 高 DPI 屏幕下保持清晰渲染
- [ ] Typecheck passes
- [ ] Verify in browser: 节点易于点击，视觉层次分明

### US-008: 修复 EPUB 书籍展示功能
**Description:** As a user, I want to view EPUB format books in the reader so that I can use the system with EPUB files.

**Acceptance Criteria:**
- [ ] 修复 `EPUBReader` 组件渲染问题
- [ ] 确保 EPUB 内容正确解析并显示
- [ ] 支持章节导航
- [ ] 支持文本高亮（与 PDF 功能对等）
- [ ] Typecheck passes
- [ ] Verify in browser: EPUB 文件可正常阅读、翻页、跳转

### US-009: 修复 EPUB 概念抽取功能
**Description:** As a user, I want to extract concepts from EPUB books so that I can build concept graphs from EPUB sources.

**Acceptance Criteria:**
- [ ] 修复 `epub_parser.rs` 中的文本提取逻辑
- [ ] 确保 EPUB 内容正确传递给 LLM 进行概念抽取
- [ ] 抽取的概念正确关联到 EPUB 章节位置
- [ ] 支持 Source Citation 定位到 EPUB 具体位置
- [ ] Rust 编译通过，无 warning
- [ ] Verify: EPUB 上传后可成功抽取概念

### US-010: EPUB 与 PDF 功能对齐
**Description:** As a user, I want EPUB and PDF to have the same feature set so that my experience is consistent regardless of format.

**Acceptance Criteria:**
- [ ] EPUB 支持 "View in Book" 跳转功能
- [ ] EPUB 支持文本选择和高亮
- [ ] EPUB 支持章节导航侧边栏
- [ ] EPUB 阅读器 UI 与 PDF 阅读器一致
- [ ] Typecheck passes
- [ ] Verify in browser: EPUB 功能完整性与 PDF 相当

## Functional Requirements

### Core Concepts 修复 (FR-001 - FR-003)
- FR-001: `GET /api/books/{id}/core-concepts` 必须返回数组格式，即使为空也返回 `[]`
- FR-002: 前端 `CoreConceptsList` 组件必须防御性检查 `Array.isArray(concepts)`
- FR-003: 修复后端 SQL 查询，确保正确识别 `is_core=true` 的概念

### Source Citations 跳转 (FR-004 - FR-007)
- FR-004: Source Citation 按钮必须显示 chunk 摘要（前 20 字符）而非 hex ID
- FR-005: 点击 Source Citation 必须触发 `onCitationClick(chunkId)` 回调
- FR-006: `MainContent` 必须实现 `handleCitationClick` 并定位到对应位置
- FR-007: PDF 阅读器必须支持 `jumpToChunk(chunkId)` 方法高亮对应文本

### Related Concepts 改进 (FR-008 - FR-010)
- FR-008: `NodeDetailPanel` 必须通过 API 获取关联节点的完整信息
- FR-009: Related Concepts 必须显示节点名称和关系类型
- FR-010: 点击 Related Concept 必须在面板中显示该节点详情

### Graph 性能优化 (FR-011 - FR-015)
- FR-011: Graph 初始渲染节点数限制为 50 个，按重要性排序
- FR-012: 实现 "Load More" 或虚拟滚动加载更多节点
- FR-013: Force simulation 使用 `d3AlphaDecay=0.05` 和 `d3VelocityDecay=0.4` 加速稳定
- FR-014: 节点和边的渲染使用 `requestAnimationFrame` 节流
- FR-015: 缩放级别低于 0.3 时隐藏节点标签以提升性能

### Graph 可视化改进 (FR-016 - FR-021)
- FR-016: 节点必须按 category 显示不同颜色（至少 5 种颜色）
- FR-017: Core concept 节点必须比 regular concept 大 2 倍
- FR-018: 悬停节点时显示 tooltip 包含完整名称和描述
- FR-019: 节点最小点击区域为 44x44 像素
- FR-020: 图例必须可点击切换分组的显示/隐藏
- FR-021: 添加搜索框支持按名称实时过滤节点

### EPUB 修复 (FR-022 - FR-027)
- FR-022: `epub_parser.rs` 必须正确解析 EPUB 的 HTML 内容
- FR-023: EPUB 章节必须映射到可跳转的位置 ID
- FR-024: `EPUBReader` 组件必须正确渲染 EPUB HTML 内容
- FR-025: EPUB 阅读器必须支持章节导航侧边栏
- FR-026: EPUB 抽取的概念必须包含章节位置信息
- FR-027: EPUB Source Citation 跳转必须定位到具体章节位置

## Non-Goals

- 不添加新的 LLM 模型或更换现有模型
- 不重构整个后端架构或数据库结构
- 不引入新的第三方可视化库（继续使用 react-force-graph-2d）
- 不实现实时协作或多用户功能
- 不添加新的概念类型或关系类型
- 不做移动端响应式适配优化（保持现有桌面优先设计）
- 不实现概念自动分类 AI 功能（使用现有 category 字段）

## Design Considerations

### Graph 颜色方案
```
Core Concept: #8b5cf6 (violet-500)
Category - Philosophy: #3b82f6 (blue-500)
Category - Science: #10b981 (emerald-500)
Category - History: #f59e0b (amber-500)
Category - Art: #ec4899 (pink-500)
Category - Other: #64748b (slate-500)
```

### 筛选器 UI 位置
- 放置在 GraphCanvas 右上角图例下方
- 使用半透明背景 `bg-background/90 backdrop-blur-sm`
- 折叠/展开设计，默认折叠节省空间

### EPUB 阅读器布局
- 复用 PDFReader 的三栏布局（侧边栏-内容-详情）
- 左侧显示章节列表导航
- 中间显示 EPUB HTML 内容
- 右侧复用 NodeDetailPanel

## Technical Considerations

### 性能优化策略
1. **节点限制**: 初始只渲染 50 个节点，按 `source_chunk_ids.length` 排序
2. **防抖搜索**: 搜索输入使用 300ms debounce
3. **虚拟化**: 视口外节点暂停 force simulation 计算
4. **缓存**: `getBookGraph` 结果在 `React Query` 或 `SWR` 中缓存 5 分钟

### API 变更
- `GET /api/books/{id}/core-concepts` - 确保返回 `GraphNode[]`
- `GET /api/nodes/{id}` - 已存在，用于获取 Related Concept 详情
- `GET /api/chunks/{id}` - 新增，返回 chunk 内容和位置信息

### Rust 后端变更
- `epub_parser.rs`: 修复 HTML 解析，提取纯文本和章节结构
- `db.rs`: 确保 `get_core_concepts` 返回正确类型

### 依赖项
- 继续使用 `react-force-graph-2d` - 已满足需求
- 可能需要 `epubjs` 或 `react-reader` 用于 EPUB 渲染

## Success Metrics

- Core Concepts 加载成功率: 100%（无 forEach 报错）
- Graph 交互帧率: 100+ 节点时保持 55fps+
- Source Citation 点击跳转成功率: 95%+
- EPUB 书籍成功解析率: 90%+（兼容常见 EPUB 格式）
- 用户可区分不同 category 的节点: 通过视觉测试

## Open Questions

1. EPUB 书籍的 chunk 粒度如何定义？是按章节还是按固定字符数？
2. Graph 节点筛选是否需要在 URL 中持久化状态（方便分享）？
3. 是否需要在 Graph 中添加 "重置视图" 按钮？
4. EPUB 阅读器是否需要主题切换（暗黑模式）？
5. 概念抽取时 EPUB 的进度显示是否需要优化？
