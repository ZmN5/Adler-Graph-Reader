# PRD: 智能概念抽取与核心概念识别增强

## Introduction

当前概念抽取功能存在 chunk 过小、仅采样部分内容、抽取结果缺少解释和示例等问题。本功能将全面提升概念抽取的质量和完整性，支持中英文双语配置，为每个概念添加详细解释和实例，并智能识别书籍中的核心概念，帮助用户快速掌握书籍精华。

## Goals

- 支持整本书级别的语言配置（中文/英文），统一抽取指定语言的概念
- 每个抽取的概念包含：概念名称、详细解释、具体例子
- 节点点击时展示概念详情（解释+例子）并支持 PDF 跳转定位
- 智能识别书籍核心概念（不了解这些概念 = 没看过本书）
- 扩大 chunk 大小至 4000 tokens，提升上下文理解能力
- 实现全量抽取，覆盖整本书所有内容，不再采样

## User Stories

### US-001: 添加语言配置选项
**Description:** 作为用户，我希望在创建/导入书籍时选择抽取语言（中文或英文），以便获取我需要的语言版本的概念。

**Acceptance Criteria:**
- [ ] 在书籍导入/创建流程中添加语言选择配置（中文/英文）
- [ ] 语言配置存储在 books 表的 language 字段
-- [ ] 配置默认值为"自动检测"，允许用户手动覆盖
- [ ] 向后兼容：现有书籍默认使用自动检测
- [ ] Typecheck/lint passes

### US-002: 更新数据库 schema 存储概念详情
**Description:** 作为开发者，我需要扩展数据库结构以存储概念的解释和例子，以便后续展示使用。

**Acceptance Criteria:**
- [ ] concepts 表添加 description 字段（TEXT，概念解释）
- [ ] concepts 表添加 examples 字段（JSON/TEXT，存储示例列表）
- [ ] concepts 表添加 is_core 字段（BOOLEAN，标记是否为核心概念）
- [ ] concepts 表添加 page_number 字段（INTEGER，概念所在页码）
- [ ] concepts 表添加 chunk_id 字段（INTEGER，关联到具体 chunk）
- [ ] 生成并运行数据库迁移脚本
- [ ] Typecheck/lint passes

### US-003: 修改 chunk 切分策略（4K tokens + 全量）
**Description:** 作为开发者，我需要将 chunk 切分大小调整为 4000 tokens 并处理整本书内容，以提高概念抽取质量。

**Acceptance Criteria:**
- [ ] 修改 chunk 大小配置为 4000 tokens（从当前值调整）
- [ ] 移除采样逻辑，确保整本书所有内容都被切分处理
- [ ] 更新 chunk 生成算法，处理大 chunk 的边界情况
- [ ] 验证大 chunk 下的内存和性能表现
- [ ] Typecheck/lint passes

### US-004: 增强概念抽取 Prompt
**Description:** 作为开发者，我需要更新 LLM 抽取 Prompt，使其输出包含概念解释、示例和页码信息。

**Acceptance Criteria:**
- [ ] Prompt 要求 LLM 为每个概念输出：
  - name: 概念名称（指定语言）
  - description: 概念解释（2-3句话）
  - examples: 具体例子（1-2个）
  - page_number: 概念出现的页码
- [ ] Prompt 包含语言配置指令（根据用户选择强制中文/英文输出）
- [ ] 定义 JSON Schema 用于结构化输出验证
- [ ] 处理 LLM 返回的异常格式
- [ ] Typecheck/lint passes

### US-005: 实现核心概念识别算法
**Description:** 作为用户，我希望系统自动识别出书中最重要的核心概念，让我知道哪些是必须掌握的。

**Acceptance Criteria:**
- [ ] 实现多维度评分算法：
  - 频率分：概念在书中出现次数
  - 中心性分：概念在关系图中的 PageRank/中心度
  - 重要性分：LLM 对概念重要性的评分
- [ ] 综合得分排序，取 Top N（如 Top 20% 或固定数量如 10 个）作为核心概念
- [ ] 核心概念标记 is_core = true
- [ ] 提供核心概念列表 API
- [ ] Typecheck/lint passes

### US-006: 更新概念图谱节点展示
**Description:** 作为用户，我希望在概念图谱中直观区分核心概念和普通概念。

**Acceptance Criteria:**
- [ ] 核心概念节点使用特殊视觉标记（更大尺寸、不同颜色或特殊边框）
- [ ] 添加图例说明核心概念的标识
- [ ] 保持图谱交互流畅性
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-007: 实现节点详情弹窗
**Description:** 作为用户，我希望点击概念节点时看到详细解释和例子。

**Acceptance Criteria:**
- [ ] 点击节点弹出详情面板/弹窗
- [ ] 面板展示：概念名称、详细解释、具体例子
- [ ] 面板包含"在 PDF 中查看"按钮
- [ ] 支持关闭/收起面板
- [ ] 响应式适配不同屏幕尺寸
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-008: 实现 PDF 页面跳转定位
**Description:** 作为用户，我希望从概念详情直接跳转到 PDF 中对应页面。

**Acceptance Criteria:**
- [ ] 点击"在 PDF 中查看"按钮打开 PDF 阅读器
- [ ] PDF 自动跳转到概念所在页码
- [ ] 页面上高亮显示相关文本区域（如可能）
- [ ] 支持返回概念图谱
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-009: 添加核心概念列表视图
**Description:** 作为用户，我希望有一个专门的视图列出本书所有核心概念。

**Acceptance Criteria:**
- [ ] 在书籍详情页添加"核心概念"标签/入口
- [ ] 列表展示核心概念名称、简介、页码
- [ ] 支持点击跳转到概念详情
- [ ] 支持从列表直接跳转 PDF
- [ ] Typecheck/lint passes
- [ ] Verify in browser using dev-browser skill

### US-010: 更新概念抽取流程集成
**Description:** 作为开发者，我需要将新功能整合到现有抽取流程中。

**Acceptance Criteria:**
- [ ] 抽取流程读取书籍语言配置并传递给 Prompt
- [ ] 抽取结果包含 description、examples、page_number
- [ ] 核心概念识别作为抽取后的独立步骤运行
- [ ] 更新进度显示，包含核心概念识别阶段
- [ ] 保持向后兼容性
- [ ] Typecheck/lint passes

## Functional Requirements

- FR-1: 书籍导入/创建时支持语言配置（lang: 'zh' | 'en' | 'auto'）
- FR-2: Chunk 切分大小调整为 4000 tokens（可配置）
- FR-3: Chunk 处理范围覆盖整本书，不再采样
- FR-4: 概念数据结构包含：name, description, examples[], page_number, chunk_id, is_core
- FR-5: 概念抽取 Prompt 必须包含语言指令和输出格式要求
- FR-6: 核心概念识别算法综合频率、中心性、LLM 评分三个维度
- FR-7: 核心概念在图谱中使用视觉区分（大小/颜色/边框）
- FR-8: 节点点击打开详情面板，展示 description 和 examples
- FR-9: PDF 跳转支持精确到页码定位
- FR-10: 提供独立的核心概念列表视图
- FR-11: 概念与 chunk 关联，支持溯源

## Non-Goals

- 不支持 PDF 内精确到段落的高亮（仅支持页级跳转）
- 不支持多语言混合抽取（单本书仅支持一种语言）
- 不实现概念自动分类/标签体系
- 不实现概念学习路径推荐
- 不实现用户自定义核心概念标记

## Design Considerations

### UI/UX 要求
- 语言配置使用清晰的单选按钮或下拉选择
- 核心概念在图谱中使用金色/橙色高亮，节点尺寸比普通概念大 20%
- 节点详情面板采用滑出式侧边栏（桌面）或底部抽屉（移动端）
- 核心概念列表使用卡片式布局，显示页码标签

### 现有组件复用
- 复用现有 PDF 阅读器组件，添加页码跳转参数
- 复用现有概念图谱组件，添加节点样式变体
- 复用书籍详情页布局，添加核心概念标签

## Technical Considerations

### 已知约束
- LLM context window 需支持 4000+ tokens 输入
- 全量抽取会增加 LLM API 调用次数和费用
- 大 chunk 可能导致内存占用增加

### 集成点
- 数据库：更新 concepts 表 schema
- 后端：更新抽取 pipeline、添加核心概念识别服务
- 前端：更新书籍配置表单、图谱组件、PDF 阅读器

### 性能要求
- Chunk 生成处理 1000 页 PDF < 30 秒
- 概念图谱渲染 < 3 秒（< 500 节点）
- PDF 页码跳转响应 < 1 秒

## Success Metrics

- 概念抽取覆盖率：从当前采样 X% 提升至 100%
- 概念描述质量：用户抽样满意度 > 80%
- 核心概念识别准确率：Top 10 核心概念与人工判断重合度 > 70%
- 功能可用性：sample_books 下所有测试书籍成功完成抽取

## Open Questions

- 核心概念数量如何确定？固定数量（如10个）还是按比例（如20%）？
- 是否需要在抽取过程中显示实时进度（当前 chunk/total chunks）？
- 概念解释和例子是否需要在概念图谱的节点上预览（hover）？
- 现有书籍如何处理迁移？是否需要重新抽取？

---

## 附录：测试验证清单

使用 sample_books 下的书籍进行测试验证：

1. **导入测试**
   - [ ] 导入 PDF 时语言配置正确显示
   - [ ] 选择中文后抽取结果全为中文
   - [ ] 选择英文后抽取结果全为英文

2. **抽取质量测试**
   - [ ] 整本书 chunk 数量符合预期（页数 * 平均页token / 4000）
   - [ ] 每个概念都有 description 和 examples
   - [ ] 页码信息准确（抽查验证）

3. **图谱交互测试**
   - [ ] 核心概念节点视觉区分明显
   - [ ] 点击普通节点展示详情面板
   - [ ] 点击核心节点展示详情面板并显示"核心概念"标识
   - [ ] PDF 跳转定位准确

4. **列表视图测试**
   - [ ] 核心概念列表正确显示所有核心概念
   - [ ] 列表项可点击跳转
   - [ ] 空状态处理（无核心概念时）

5. **浏览器自动化验证**
   - [ ] 使用 browser-use 验证所有按钮和交互
   - [ ] 验证响应式布局在不同屏幕尺寸下的表现
