# PRD: 智能阅读与概念图谱 Web 系统

## 1. Introduction/Overview

一款运行在浏览器中的本地化智能阅读与知识管理 Web 应用。旨在解决重度阅读者"读过即忘、知识孤立、难以回溯"的痛点。通过本地大模型自动抽丝剥茧，将冗长的 EPUB/PDF 转化为结构化的概念图谱，帮助用户在跨学科、跨书籍的阅读中发现知识的内在联系，构建个人专属的行业认知网络。

## 2. Goals

- 实现 EPUB 和 PDF 电子书的本地导入与解析（初期仅处理文本内容，忽略图片）
- 提供全局中/英文输出语言控制开关，确保知识库语言一致性
- 构建单本书的局部概念图谱，提取概念、逻辑关系、解释和例子
- 构建跨书的全局认知图谱，实现概念聚类和融合
- 实现严格的 Source-Grounded 机制：每个节点/关系/解释必须带引用标签，100% 溯源原文
- 提供"图谱 ↔ 原文"的无缝跳转联动体验
- 构建高性能 WebGL 图谱可视化画布，支持成百上千节点的丝滑渲染
- 实现纯 Web 体验的本地化 B/S 架构

## 3. User Stories

### US-001: 电子书导入与解析
**Description:** 作为用户，我希望能导入 EPUB 和 PDF 格式的电子书，以便系统提取其中的知识概念。

**Acceptance Criteria:**
- [ ] 支持拖拽或文件选择器上传 EPUB 文件
- [ ] 支持拖拽或文件选择器上传 PDF 文件
- [ ] 系统显示上传进度条
- [ ] 上传完成后自动开始解析，并显示解析状态
- [ ] 解析失败时显示明确错误信息
- [ ] 忽略图片内容，仅处理纯文本

### US-002: 全局语言输出控制
**Description:** 作为用户，我希望系统输出的概念名称、解释、例子等全部为中文（默认），也能一键切换为英文，以便满足不同语言偏好的知识管理需求。

**Acceptance Criteria:**
- [ ] 界面右上角或设置面板中有语言切换开关
- [ ] 开关选项：中文（默认）/ 英文
- [ ] 切换语言后，新抽取的概念全部使用新语言
- [ ] 已有概念不强制转换，保持历史一致性
- [ ] 切换操作即时生效，无需刷新页面

### US-003: 单书局部概念图谱生成
**Description:** 作为用户，我希望系统能从当前阅读的书籍中提取重要概念及其逻辑关系，形成当前书籍的脉络网络。

**Acceptance Criteria:**
- [ ] 书籍解析完成后自动生成局部图谱
- [ ] 图谱节点包含：概念名称、解释、例子
- [ ] 图谱边包含：关系类型（因果、包含、对比等）
- [ ] 每个节点/边必须附带 source_chunk_id 引用标签
- [ ] 支持按节点类型过滤显示
- [ ] 缩略图模式下显示概念数量统计

### US-004: 全局认知图谱与概念融合
**Description:** 作为用户，我希望系统能跨书融合相同或相近的概念，在全局视图下查看不同书籍对同一概念的补充定义和多视角例子。

**Acceptance Criteria:**
- [ ] 全局视图聚合所有已导入书籍的概念
- [ ] 相同/相近概念自动聚类融合
- [ ] 点击融合概念显示来自不同书籍的定义变体
- [ ] 支持按行业、学科、方向对概念进行分类筛选
- [ ] 融合后的概念保留所有来源引用

### US-005: 严格溯源与原文对照
**Description:** 作为用户，我希望点击图谱中的任意概念或引用标签时，系统能立即展示对应书籍的具体页码和段落，实现"图谱 ↔ 原文"的无缝跳转。

**Acceptance Criteria:**
- [ ] 点击任意概念节点，显示概念的详细卡片
- [ ] 详细卡片包含：名称、解释、所有来源引用列表
- [ ] 点击任一来源引用，立即定位并高亮原文段落
- [ ] 支持分屏展示：左/上为图谱，右/下为原文
- [ ] 原文阅读器支持页码跳转和高亮定位
- [ ] 所有抽取内容 100% 带有 source_chunk_id，无幻觉内容

### US-006: 高性能图谱可视化交互
**Description:** 作为用户，我希望图谱画布在展示成百上千个节点时依然流畅，支持平移、缩放、过滤、高亮等操作不卡顿。

**Acceptance Criteria:**
- [ ] 使用 WebGL 加速渲染（严禁 DOM/SVG 渲染大图谱）
- [ ] 支持鼠标滚轮缩放，缩放过程流畅 60fps
- [ ] 支持鼠标拖拽平移画布
- [ ] 支持按分类/类型过滤节点
- [ ] 支持点击节点高亮其直接关联节点
- [ ] 在包含 500+ 节点的图谱上操作无明显卡顿

### US-007: 书籍阅读器功能
**Description:** 作为用户，我希望在阅读区能够按页码或锚点精确定位原文，便于核对概念出处。

**Acceptance Criteria:**
- [ ] PDF 文件：使用 pdf.js 渲染，支持页码输入跳转
- [ ] EPUB 文件：使用 epub.js 渲染，支持锚点定位
- [ ] 跳转后的原文位置高亮显示
- [ ] 支持上一页/下一页翻页
- [ ] 显示当前页码/总页数

## 4. Functional Requirements

### 4.1 文档处理模块
- FR-1: 接收 EPUB 和 PDF 文件上传，支持 multipart/form-data 格式
- FR-2: PDF 解析：使用 pdf-extract 提取文本和页码结构
- FR-3: EPUB 解析：使用 epub 库解析书籍内容树
- FR-4: 分块 (Chunking)：按页码或固定字数（带重叠）将书籍切片，每个切片赋予唯一 UUID
- FR-5: 将 Chunk 元数据（UUID、书籍ID、页码范围、文本内容）存入 SQLite

### 4.2 AI 抽取模块
- FR-6: 构建任务队列，并发调用 LM Studio API
- FR-7: 与 LM Studio 通信：HTTP Client 连接 http://localhost:1234/v1，使用 OpenAI 兼容接口
- FR-8: System Prompt 强制约束：必须使用用户指定的输出语言（中/英）；每个概念和例子必须在 JSON 的 source_chunk_id 字段中附带来源 UUID
- FR-9: 解析大模型返回的 JSON，提取结构化数据（概念、关系、解释、例子、语言标记、来源）
- FR-10: 实体消歧：与数据库已有概念对比去重
- FR-11: 将节点（nodes）和边（edges）存入 SQLite

### 4.3 数据存储模块
- FR-12: 使用 SQLite 单文件数据库存储在本地
- FR-13: nodes 表：id, book_id, name, description, examples, source_chunk_ids, language, category, created_at
- FR-14: edges 表：id, source_node_id, target_node_id, relation_type, source_chunk_ids, created_at
- FR-15: books 表：id, title, author, file_path, format, total_pages, created_at
- FR-16: chunks 表：id (UUID), book_id, page_start, page_end, content, created_at

### 4.4 前端展示模块
- FR-17: React 18 + TypeScript + Vite 构建 SPA
- FR-18: Tailwind CSS + shadcn/ui 组件库
- FR-19: AntV G6 或 React Force Graph (WebGL) 图谱渲染引擎
- FR-20: pdf.js 集成：PDF 渲染与页码映射
- FR-21: epub.js 集成：EPUB 渲染与锚点定位
- FR-22: Zustand 状态管理
- FR-23: 分屏工作区：可调整大小的左右/上下分屏
- FR-24: 图谱画布：平移、缩放、过滤、高亮功能
- FR-25: 阅读区：原文显示、页码跳转、高亮联动

### 4.5 API 接口模块
- FR-26: POST /api/books/upload - 上传电子书
- FR-27: GET /api/books - 获取已导入书籍列表
- FR-28: GET /api/books/:id - 获取书籍详情
- FR-29: DELETE /api/books/:id - 删除书籍及其关联数据
- FR-30: GET /api/books/:id/chunks - 获取书籍的分块数据
- FR-31: GET /api/books/:id/graph - 获取单书局部图谱
- FR-32: GET /api/graph/global - 获取全局认知图谱
- FR-33: GET /api/nodes/:id - 获取节点详情
- FR-34: GET /api/chunks/:id - 获取指定 Chunk 原文内容
- FR-35: GET /api/settings/language - 获取当前语言设置
- FR-36: PUT /api/settings/language - 更新语言设置

## 5. Non-Goals

- 不支持图片内容提取和展示
- 不支持语音/音频格式
- 不支持多用户协作和云端同步
- 不支持书籍批注和高亮笔记（仅限概念图谱层面的知识管理）
- 不支持自动摘要生成（仅提取概念和关系）
- 不支持大模型幻觉内容的生成，所有输出必须 Source-Grounded
- 不支持图数据库，SQLite 关系型存储已足够

## 6. Design Considerations

### 6.1 UI/UX 要求
- 极简、现代、高颜值的界面风格
- 分屏工作区：主视区（左/上）为图谱画布，阅读/详情区（右/下）为书籍原文或概念卡片
- 响应式布局：支持左右分屏和上下分屏切换
- 暗色/亮色主题支持（可选）

### 6.2 性能要求
- 图谱渲染必须启用 WebGL 加速
- 500+ 节点图谱缩放/拖拽帧率 ≥ 30fps
- API 响应时间 < 200ms（图谱数据查询）
- Chunk 数据按需加载，不一次性加载全量数据

### 6.3 组件复用
- 复用 shadcn/ui 基础组件（Button, Dialog, DropdownMenu 等）
- 复用 AntV G6/React Force Graph 官方示例的交互模式
- 复用 pdf.js 和 epub.js 的官方集成方式

## 7. Technical Considerations

### 7.1 技术栈
- **前端**: React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui + Zustand + AntV G6/React Force Graph + pdf.js + epub.js
- **后端**: Rust + Axum + SQLite + sqlx + pdf-extract + epub + reqwest
- **AI**: Qwen3.5 9B (LM Studio 本地托管，OpenAI 兼容接口)
- **硬件**: M4 芯片 + 32GB 统一内存

### 7.2 架构模式
- 前后端分离 B/S 架构
- 前端：浏览器 SPA，通过 RESTful API 与后端通信
- 后端：Rust HTTP Server，处理文件 I/O、文本分块、并发调度
- AI 推理：LM Studio 本地服务，独立进程运行

### 7.3 Source-Grounded 策略
- 每个 Chunk 带 UUID，传入 System Prompt
- 强制要求模型在 JSON 中附带 source_chunk_id
- 严禁模型编造内容，所有输出必须附带来源

## 8. Success Metrics

- 用户能在 30 秒内完成一本 300 页书籍的导入和解析
- 全局图谱在 500+ 节点规模下缩放/拖拽流畅度 ≥ 30fps
- 任意概念节点点击后，100ms 内显示来源引用列表
- 原文跳转定位时间 < 500ms
- 概念去重准确率 ≥ 90%（相同/相近概念被正确融合）

## 9. Open Questions

- [ ] 概念消歧的相似度阈值如何设定？（需要实验调优）
- [ ] Chunk 大小如何平衡（太大影响抽取精度，太小增加关系抽取难度）？
- [ ] 是否需要支持用户手动修正 AI 抽取的概念和关系？
- [ ] 全局图谱的分类体系是预设还是用户自定义？
- [ ] 是否需要支持图谱导出（如 JSON、PNG）？
