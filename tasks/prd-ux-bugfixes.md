# PRD: 产品流程 UX 优化与 Bug 修复

## 1. 概述

本次迭代聚焦于修复产品流程中发现的 7 个 UX 问题，提升用户体验和系统可靠性。所有问题均已在 `problems.md` 中详细记录。

## 2. 目标

- 消除高风险操作（删除）的误操作可能性
- 修复导航系统的显示和交互问题
- 为耗时操作提供清晰的进度反馈
- 优化 Modal 关闭交互
- 改进语言选择的可理解性
- 提升整体 UX 一致性和专业感

## 3. 用户故事

### US-001: 删除书籍前显示确认对话框
**描述:** 作为用户，我在删除书籍前希望再次确认，避免误删导致数据丢失。

**验收标准:**
- [ ] 点击 Delete 按钮后显示模态对话框
- [ ] 对话框内容: "确认删除《{书名}》吗？此操作不可撤销。"
- [ ] 提供「取消」和「确认删除」两个按钮
- [ ] 点击「取消」关闭对话框，书籍不被删除
- [ ] 点击「确认删除」执行删除并关闭对话框
- [ ] 点击对话框外部区域不触发删除（需点击按钮）
- [ ] Typecheck 通过
- [ ] Verify in browser using browser-use skill

---

### US-002: 导航下拉框正常展开
**描述:** 作为用户，我希望能通过下拉框快速跳转到任意章节。

**验收标准:**
- [ ] 点击下拉框时显示章节列表（5个选项可见）
- [ ] 下拉框展开时有视觉反馈（如箭头方向变化）
- [ ] 选择章节后自动跳转并关闭下拉框
- [ ] Typecheck 通过
- [ ] Verify in browser using browser-use skill

---

### US-003: 正确显示当前章节标题
**描述:** 作为用户，我希望看到当前所在章节的准确标题，而不是"Unknown"。

**验收标准:**
- [ ] 进入书籍后正确显示第一个章节的标题
- [ ] 切换章节时更新标题显示
- [ ] 标题显示清晰的章节编号和名称（如 "1. Introduction to DeepSeek"）
- [ ] Typecheck 通过
- [ ] Verify in browser using browser-use skill

---

### US-004: Previous/Next 按钮正确启用
**描述:** 作为用户，我希望能使用 Previous/Next 按钮顺序浏览章节。

**验收标准:**
- [ ] 非首页时 Previous 按钮启用
- [ ] 非末页时 Next 按钮启用
- [ ] 点击 Previous 跳转到上一章
- [ ] 点击 Next 跳转到下一章
- [ ] 到达首/末章时对应按钮禁用
- [ ] Typecheck 通过
- [ ] Verify in browser using browser-use skill

---

### US-005: 概念图按钮显示反馈
**描述:** 作为用户，我点击 Concept Graph 按钮后希望能看到明显的反馈。

**验收标准:**
- [ ] 点击 Concept Graph 按钮后切换到图谱视图
- [ ] 按钮在激活状态时有视觉区分（如高亮、边框）
- [ ] 当前视图有明确指示
- [ ] Typecheck 通过
- [ ] Verify in browser using browser-use skill

---

### US-006: 提取概念时显示进度指示
**描述:** 作为用户，我希望能了解书籍概念提取的进度，避免误以为系统卡住。

**验收标准:**
- [ ] 点击 Extract/Parse 按钮后显示环形加载动画
- [ ] 同时显示状态文字 "正在提取概念..."
- [ ] 提取完成后进度指示消失
- [ ] 提取失败时显示错误提示
- [ ] Typecheck 通过
- [ ] Verify in browser using browser-use skill

---

### US-007: Core Concepts Modal 可通过 Escape 关闭
**描述:** 作为用户，我希望能通过键盘快捷键关闭弹窗。

**验收标准:**
- [ ] 焦点在 Modal 内时按 Escape 键可关闭
- [ ] 关闭时有适当的过渡动画
- [ ] 关闭后焦点回归到触发按钮
- [ ] Typecheck 通过
- [ ] Verify in browser using browser-use skill

---

### US-008: 上传语言选择说明
**描述:** 作为用户，我希望理解语言选择的含义以便正确选择。

**验收标准:**
- [ ] 语言选择 dropdown 显示清晰的选项标签
- [ ] 添加帮助说明文字，如 "选择提取概念时使用的语言"
- [ ] Auto-detect 选项默认选中
- [ ] Typecheck 通过
- [ ] Verify in browser using browser-use skill

---

## 4. 功能需求

- **FR-1:** 添加删除确认模态对话框组件
- **FR-2:** 修复章节导航下拉框展开逻辑
- **FR-3:** 修复章节标题显示（从"Unknown"改为实际标题）
- **FR-4:** 修复 Previous/Next 按钮启用/禁用逻辑
- **FR-5:** Concept Graph 按钮点击后切换视图并高亮
- **FR-6:** Extract 按钮点击后显示加载动画和状态文字
- **FR-7:** Core Concepts Modal 支持 Escape 键关闭
- **FR-8:** 上传 Modal 添语言选择说明文字

## 5. 非目标

- 不修改书籍删除的后端逻辑
- 不改变核心概念提取算法
- 不重新设计整体 UI 风格
- 不添加国际化支持（除当前已有中英文切换）

## 6. 设计注意事项

- 复用现有 Modal 组件样式
- 加载动画使用 Tailwind 的 animate-spin 或自定义 SVG
- 删除确认使用警告色调（红色为主）
- 保持与现有中文/英文 UI 的一致性

## 7. 技术考虑

- 前端状态管理：使用 React hooks (useState, useEffect)
- Modal 关闭使用 onKeyDown 监听 Escape 事件
- 进度状态需从父组件传递或使用 Context
- 章节导航状态与 EPUB reader 组件解耦

## 8. 验收指标

- 所有 7 个问题修复完成
- 无新增 UI 回归问题
- Typecheck 和 lint 通过
- 手动测试覆盖所有修复点

## 9. 开放问题

- 删除确认是否需要显示书籍封面/缩略图？
- 进度指示的超时时间如何设置？（建议 60 秒后显示超时提示）
- Concept Graph 视图的切换动画是否需要？
