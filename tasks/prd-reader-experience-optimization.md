# PRD: 阅读器体验优化

## Introduction

在之前修复 reader-bug-fixes PRD 的基础上，进一步优化 PDF/EPUB 阅读器的用户体验。解决当前存在的三个核心问题：EPUB 滚动不流畅、PDF 宽度显示不足、阅读器面板无法折叠。提升用户阅读书籍时的舒适度和操作便利性。

## Goals

- 修复 EPUB 阅读器滚动问题，提供流畅的滚动体验
- 优化 PDF 页面显示宽度，确保内容完整展示不被截断
- 添加阅读器面板折叠功能，让用户可以灵活控制界面布局
- 提升整体阅读体验，减少视觉干扰

## User Stories

### US-001: 修复 EPUB 滚动问题
**Description:** 作为用户，我希望 EPUB 阅读器能够流畅滚动，让我可以顺畅地阅读长章节内容。

**Acceptance Criteria:**
- [ ] EPUB 内容区域支持垂直滚动
- [ ] 滚动流畅，无明显卡顿
- [ ] 滚动条样式美观，与整体 UI 风格一致
- [ ] 章节切换时滚动位置正确重置
- [ ] 页面头部（章节标题）保持固定
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-002: 优化 PDF 显示宽度
**Description:** 作为用户，我希望 PDF 页面能够充分利用可用宽度显示，避免内容被截断或过度缩放。

**Acceptance Criteria:**
- [ ] PDF 页面宽度计算使用 `containerWidth - 20px` 边距（之前是 40px）
- [ ] 页面内容完整展示，无横向截断
- [ ] 页面阴影和边距保持美观
- [ ] 缩放比例适中，文字清晰可读
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-003: 添加阅读器面板折叠功能
**Description:** 作为用户，我希望能够折叠左侧的阅读器面板，以便将更多空间留给概念图谱视图，同时在需要时能够快速展开。

**Acceptance Criteria:**
- [ ] 在阅读器面板头部添加折叠按钮（ChevronLeft 图标）
- [ ] 点击折叠按钮后，左侧面板收缩为 48px 宽的窄条
- [ ] 窄条显示展开按钮（ChevronRight 图标）和书籍标题缩写
- [ ] 折叠状态下中间面板自动扩展占据剩余空间
- [ ] 点击展开按钮恢复左侧面板到原始宽度（40%）
- [ ] 折叠/展开动画流畅（300ms transition）
- [ ] 折叠状态在切换书籍后保持（当前 session 内）
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

## Functional Requirements

- FR-1: EPUBReader 组件容器添加 `overflow-y-auto` 和正确的 `min-h-0` 设置
- FR-2: EPUB 滚动时保持章节标题栏固定，仅内容区域滚动
- FR-3: PDFReader 页面宽度计算边距从 40px 减少到 20px
- FR-4: PDF 页面保持居中显示，但使用更紧凑的边距
- FR-5: ThreeColumnLayout 组件添加 `showLeftPanel` 和 `onToggleLeftPanel` props
- FR-6: App.tsx 管理 `leftPanelCollapsed` 状态，传递给 ThreeColumnLayout
- FR-7: 折叠按钮位置在阅读器面板右上角（章节标题栏右侧）
- FR-8: 折叠后窄条包含：展开按钮、竖排/缩写的书籍标题、书籍图标
- FR-9: 布局过渡使用 CSS transition，持续 300ms，缓动函数 ease-in-out

## Non-Goals

- 不添加阅读器面板宽度拖拽调整功能
- 不添加 PDF/EPUB 字体大小调整功能
- 不改变现有的三栏布局基本结构
- 不添加阅读进度同步到服务器的功能
- 不添加阅读器主题切换（深色/浅色）功能

## Design Considerations

### 折叠按钮位置
```
┌─────────────────────────────────────────────┐
│  Chapter Title              [Fold Button] │  ← 折叠按钮在右上角
├─────────────────────────────────────────────┤
│                                             │
│           EPUB/PDF Content                  │
│                                             │
└─────────────────────────────────────────────┘
```

### 折叠后窄条设计
```
┌────┬───────────────────────────────────────────┐
│ ▶  │                                           │
│ 📖 │        Main Content Area (expanded)       │
│    │                                           │
│ 短 │                                           │
│ 标 │                                           │
│ 题 │                                           │
└────┴───────────────────────────────────────────┘
```

- 窄条宽度：48px
- 背景色：与面板头部一致（bg-muted/50）
- 展开按钮：居中显示，hover 时高亮
- 书籍标题：最多显示 2 个字符，竖排或使用 writing-mode

## Technical Considerations

- EPUB 使用 `react-reader`，需要确保其内部 iframe 的滚动与外层容器协调
- PDF 使用 `pdfjs-dist`，虚拟滚动需要重新计算可见区域
- ThreeColumnLayout 的 flex 布局需要根据 `showLeftPanel` 动态调整
- 折叠状态使用 React useState 管理，不持久化到 localStorage（简化实现）
- 过渡动画使用 Tailwind CSS transition utilities

## Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/components/EPUBReader.tsx` | 修复滚动容器样式，优化 epubOptions |
| `frontend/src/components/PDFReader.tsx` | 优化宽度计算（40px → 20px） |
| `frontend/src/components/ThreeColumnLayout.tsx` | 添加左侧面板折叠支持 |
| `frontend/src/App.tsx` | 添加折叠状态管理和按钮 |

## Success Metrics

- EPUB 可以流畅滚动阅读长章节（测试 50+ 页的章节）
- PDF 页面宽度比之前增加约 20-30px 可用空间
- 折叠/展开操作响应时间 < 100ms
- 用户可以在阅读器和图谱视图之间灵活切换空间分配

## Open Questions

- 是否需要记住用户的折叠偏好（localStorage）？
- 是否需要添加键盘快捷键（如 F11 或 Ctrl+B）来快速折叠/展开？
- 在移动端/小屏幕下是否需要自动折叠阅读器？
