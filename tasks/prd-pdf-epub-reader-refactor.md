# PRD: PDF/EPUB阅读器重构

## 项目背景

当前项目的PDF和EPUB阅读器存在以下问题：
- **PDF**: 模糊（未处理devicePixelRatio）、不能连续翻页、部分PDF内容颠倒（未处理rotation）
- **EPUB**: 内容显示不全（spread配置问题）、每章只显示部分内容

同时需要改进交互方式，从点击翻页按钮改为鼠标滚动翻页。

## Goals

1. 解决PDF模糊、内容颠倒问题，实现连续滚动画布
2. 解决EPUB内容不全问题，实现连续滚动阅读
3. 统一交互方式：鼠标滚轮翻页/滚动，移除顶部翻页按钮
4. 保留图谱点击跳转到具体页码/位置的功能
5. 技术架构升级：EPUB迁移到react-reader

## User Stories

### US-001: EPUB迁移到react-reader
**Description:** As a developer, I want to migrate EPUB reader to react-reader so that we get continuous scroll support out of the box.

**Acceptance Criteria:**
- [ ] Install `react-reader` dependency
- [ ] Replace custom epubjs implementation with ReactReader component
- [ ] Configure `flow: 'scrolled'`, `manager: 'continuous'`, `spread: 'none'`
- [ ] Support CFI-based navigation from graph nodes
- [ ] Display current chapter name in header
- [ ] Remove manual navigation buttons
- [ ] Typecheck passes
- [ ] Verify EPUB content displays fully in browser

### US-002: EPUB支持章节跳转
**Description:** As a user, I want to click a concept in the graph and jump to the corresponding chapter in the EPUB.

**Acceptance Criteria:**
- [ ] Graph node click passes `chapterHref` or `highlightAnchor` (CFI) to EPUBReader
- [ ] ReactReader navigates to the specified location
- [ ] Smooth scroll to target position
- [ ] Update current chapter display in header
- [ ] Typecheck passes
- [ ] Verify in browser: click concept node jumps to correct chapter

### US-003: PDF实现连续滚动画布
**Description:** As a user, I want to scroll through a PDF like a webpage instead of clicking buttons to turn pages.

**Acceptance Criteria:**
- [ ] Implement virtual scrolling for PDF pages (render visible pages + buffer)
- [ ] Calculate page positions for smooth scroll
- [ ] Track current visible page during scroll
- [ ] Support mouse wheel, touchpad, and scrollbar navigation
- [ ] Update current page display in header during scroll
- [ ] Typecheck passes
- [ ] Verify in browser: scroll through multi-page PDF smoothly

### US-004: PDF修复高DPI渲染
**Description:** As a user on Retina/4K displays, I want PDF text to be crisp and clear, not blurry.

**Acceptance Criteria:**
- [ ] Detect `window.devicePixelRatio`
- [ ] Set canvas pixel size = CSS size * devicePixelRatio
- [ ] Scale canvas context by devicePixelRatio
- [ ] Text renders sharply on high-DPI screens
- [ ] Typecheck passes
- [ ] Verify in browser on Retina display: text is sharp

### US-005: PDF修复内容颠倒问题
**Description:** As a user, I want PDFs with rotated pages to display correctly, not upside down.

**Acceptance Criteria:**
- [ ] Check viewport.rotation from pdfjs
- [ ] Pass rotation to getViewport({ scale, rotation })
- [ ] Pages with rotation metadata display correctly oriented
- [ ] Typecheck passes
- [ ] Verify with rotated PDF: content displays correctly

### US-006: PDF支持页码跳转
**Description:** As a user, I want to click a concept in the graph and jump to the specific page in the PDF.

**Acceptance Criteria:**
- [ ] Graph node click passes `pageNumber` to PDFReader
- [ ] Scroll to the specified page position
- [ ] Update current page display
- [ ] Smooth scroll animation
- [ ] Typecheck passes
- [ ] Verify in browser: click concept node jumps to correct page

### US-007: 统一阅读器界面
**Description:** As a user, I want a consistent reading interface for both PDF and EPUB with scroll-based navigation.

**Acceptance Criteria:**
- [ ] Remove previous/next page buttons from both readers
- [ ] Show current page/chapter info in header
- [ ] Consistent styling between PDF and EPUB readers
- [ ] Scroll indicator or progress bar
- [ ] Typecheck passes
- [ ] Verify in browser: UI is clean and consistent

## Functional Requirements

### EPUB Requirements

- FR-1: Use `react-reader` library for EPUB rendering
- FR-2: Configure `epubOptions` with `flow: 'scrolled'`, `manager: 'continuous'`, `spread: 'none'`
- FR-3: Support location navigation via CFI string or percentage number
- FR-4: Display current chapter name from table of contents
- FR-5: Support `chapterHref` prop for direct chapter navigation
- FR-6: Support `highlightAnchor` prop (CFI format) for concept highlighting

### PDF Requirements

- FR-7: Implement virtual scrolling canvas for multiple PDF pages
- FR-8: Render only visible pages + 2-page buffer for performance
- FR-9: Calculate total scroll height based on page count and aspect ratios
- FR-10: Support `pageNumber` prop to scroll to specific page
- FR-11: Detect `window.devicePixelRatio` and apply high-DPI scaling
- FR-12: Handle viewport.rotation to fix upside-down content
- FR-13: Display current page number in header during scroll

### Common Requirements

- FR-14: Remove manual navigation buttons (previous/next)
- FR-15: Support mouse wheel scrolling
- FR-16: Support keyboard navigation (arrow keys for page/section jump)
- FR-17: Consistent header styling showing current position
- FR-18: Loading states while document initializes

## Non-Goals

- PDF text selection and highlighting (future feature)
- PDF annotation tools (future feature)
- EPUB bookmarks persistence (future feature)
- Mobile-optimized touch gestures (basic scroll works)
- Print functionality
- Download/save document
- Full-text search within documents

## Design Considerations

### Layout

```
┌─────────────────────────────────────┐
│  📄 当前: 第 3 页 / 共 120 页       │  ← 简洁的页码/章节栏
├─────────────────────────────────────┤
│                                     │
│  ┌─────────────┐                    │
│  │  第 2 页    │                    │
│  └─────────────┘                    │
│  ┌─────────────┐                    │
│  │  第 3 页    │  ← 当前可见页      │
│  └─────────────┘                    │
│  ┌─────────────┐                    │
│  │  第 4 页    │                    │
│  └─────────────┘                    │
│                                     │
│         ... (继续滚动)              │
└─────────────────────────────────────┘
```

### Visual Style

- Header: `bg-muted/50`, `border-b`, minimal height
- Page display: Centered, shadow, slight margin
- Scrollbar: Native browser scrollbar
- Loading: Spinner in center

## Technical Considerations

### PDF Virtual Scrolling Implementation

**Option 1: Intersection Observer + Canvas Pool**
- Use IntersectionObserver to detect visible pages
- Maintain pool of 5-10 canvas elements
- Re-render only when page enters viewport
- **Pros**: Memory efficient, smooth performance
- **Cons**: Complex implementation

**Option 2: react-window / react-virtuoso**
- Use existing virtual scroll library
- Each item is a PDF page component
- **Pros**: Battle-tested, handles edge cases
- **Cons**: Additional dependency, may need customization

**Selected**: Option 1 (custom implementation) for better control over PDF rendering

### Dependencies

New dependencies:
- `react-reader`: ^1.0.0 (EPUB reader wrapper)
- `@types/epubjs`: TypeScript types for epubjs

Existing dependencies to use:
- `pdfjs-dist`: ^4.10.38 (keep, just enhance usage)

### Integration Points

- **ThreeColumnLayout**: Left panel, no changes needed
- **GraphCanvas**: Pass `pageNumber`/`chapterHref` on node click, no changes needed
- **API**: `/api/books/{id}/file` endpoint, no changes needed

## Implementation Phases

### Phase 1: EPUB Migration (US-001, US-002)
- Install react-reader
- Rewrite EPUBReader component
- Test chapter navigation

### Phase 2: PDF High-DPI & Rotation (US-004, US-005)
- Enhance existing PDFReader with devicePixelRatio
- Add rotation handling
- Test with various PDFs

### Phase 3: PDF Virtual Scrolling (US-003, US-006)
- Implement virtual scrolling for PDF
- Add scroll-to-page functionality
- Optimize performance

### Phase 4: UI Polish (US-007)
- Remove navigation buttons
- Unify header styles
- Final testing

## Success Metrics

1. **Performance**: PDF scroll at 60fps on 100+ page documents
2. **Visual Quality**: Text sharpness matches native PDF viewer on Retina displays
3. **Completeness**: EPUB chapters show 100% of content (no truncation)
4. **Usability**: Users can navigate to any position within 2 seconds
5. **Compatibility**: Works with all existing PDF/EPUB files in database

## Open Questions

1. Should we add zoom controls for PDF? (current auto-fit to width)
2. Should we cache rendered PDF pages in memory or re-render on scroll?
3. How to handle very large PDFs (500+ pages)? Implement page unload?
