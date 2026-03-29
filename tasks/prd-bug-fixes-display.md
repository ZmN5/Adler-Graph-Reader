# PRD: Reader Display Bug Fixes

## Introduction

Fix critical display issues in the PDF and EPUB readers that prevent users from properly viewing their books. Issues include: EPUB not rendering at all, PDF pages overflowing container boundaries, citation navigation not working for either format.

## Goals

- EPUB reader must render book content properly
- PDF pages must fit within the display container without overflow
- Clicking citations must navigate to the correct location in PDF
- Clicking citations must navigate to the correct chapter/location in EPUB
- Graph node labels must be readable at all zoom levels

## User Stories

### US-001: Fix EPUB Reader Rendering
**Description:** As a user, I want to view EPUB format books so that I can read EPUB files.

**Acceptance Criteria:**
- [ ] EPUB file loads without "No EPUB document" error
- [ ] Book content is visible in the reader area
- [ ] Chapter navigation sidebar shows all chapters
- [ ] Previous/Next buttons work to navigate chapters
- [ ] Typecheck passes
- [ ] Verify in browser: Upload an EPUB and verify content renders correctly

### US-002: Fix PDF Container Overflow
**Description:** As a user, I want PDF pages to fit within the display area so that I can read without scrolling horizontally.

**Acceptance Criteria:**
- [ ] PDF page width fits within container bounds
- [ ] PDF page height fits within container bounds (when page aspect ratio differs from container)
- [ ] No horizontal scrollbar appears
- [ ] Canvas is centered when smaller than container
- [ ] Typecheck passes
- [ ] Verify in browser: Open a PDF and verify page fits within bounds

### US-003: PDF Citation Navigation
**Description:** As a user, I want to click on a source citation and jump to the exact PDF page so that I can verify the context.

**Acceptance Criteria:**
- [ ] Click citation in NodeDetailPanel triggers page navigation
- [ ] PDF reader jumps to the page number stored in chunk.page_start
- [ ] Page number input field updates to show current page
- [ ] Works for both direct citation click and "View in PDF" button
- [ ] Typecheck passes
- [ ] Verify in browser: Click a citation and verify PDF navigates to correct page

### US-004: EPUB Citation Navigation
**Description:** As a user, I want to click on a source citation and jump to the correct EPUB location so that I can verify the context.

**Acceptance Criteria:**
- [ ] Click citation triggers navigation to approximate chapter location
- [ ] EPUB reader uses percentage-based navigation (chunk corresponds to % through book)
- [ ] Chapter dropdown updates to show current chapter
- [ ] Works for both direct citation click and "View in EPUB" button
- [ ] Typecheck passes
- [ ] Verify in browser: Click a citation and verify EPUB navigates to correct chapter

### US-005: Fix Graph Node Label Size
**Description:** As a user, I want readable node labels at all zoom levels so that I can understand the concept graph.

**Acceptance Criteria:**
- [ ] Labels don't become excessively large at low zoom (cap at 14px)
- [ ] Labels still visible at medium zoom (0.4 globalScale)
- [ ] Labels hidden at very low zoom (< 0.3) for performance
- [ ] Labels use bold for core concepts
- [ ] Typecheck passes
- [ ] Verify in browser: Open graph, zoom in/out, verify labels are readable

## Functional Requirements

### EPUB Rendering (US-001)
- FR-1: `viewerRef` div must have proper min-height (e.g., 500px)
- FR-2: `rendition` state must be set before render check
- FR-3: epubjs `display()` must complete before showing content
- FR-4: Handle resize events to reflow content

### PDF Overflow Fix (US-002)
- FR-5: Calculate both width and height scale factors
- FR-6: Use `Math.min(widthScale, heightScale)` to ensure fit
- FR-7: Add `overflow: hidden` to canvas container
- FR-8: Center canvas when natural size is smaller than container
- FR-9: Use `containerRef.current?.clientHeight` for height calculation

### PDF Citation Navigation (US-003)
- FR-10: `handleCitationClick` in App.tsx passes `pageNumber` to PDFReader
- FR-11: PDFReader has `pageNumber` prop that triggers `goToPage()`
- FR-12: Use `chunk.page_start` as the page number for navigation

### EPUB Citation Navigation (US-004)
- FR-13: Store chapter index or percentage in chunk data during EPUB parsing
- FR-14: Pass percentage to `rendition.display()` for navigation
- FR-15: Calculate percentage as `(chunk_index + 1) / total_chapters`

### Graph Label Fix (US-005)
- FR-16: Cap font size at `Math.min(14, baseSize / globalScale)` or similar
- FR-17: Labels hidden when `globalScale < 0.3`
- FR-18: Core concept labels use bold font

## Non-Goals

- No text highlighting in PDF (future feature)
- No actual text search within EPUB (future feature)
- No automatic scroll-to-text-in-PDF (would require OCR or text layer)
- Graph edge labels don't need to be visible at low zoom

## Technical Considerations

### EPUB Rendering
- Use epubjs version 0.3+ for React compatibility
- Pass ArrayBuffer directly to `ePub()` to avoid blob URL issues
- Set 30-second timeout for loading to detect corrupted files

### PDF Rendering
- pdfjs-dist handles PDF parsing and rendering
- Scale calculation must handle portrait, landscape, and unusual aspect ratios
- Canvas should use CSS `max-width: 100%` as backup

### Citation Navigation
- Chunk data structure: `{ id, book_id, page_start, page_end, content }`
- For PDF: `page_start` is the 1-based page number
- For EPUB: Need to store chapter index or calculate percentage

## Open Questions

- Should EPUB navigation use CFI (Canonical Fragment Identifier) or percentage?
- Do we need to highlight the actual citation text in the reader?
- Should PDF highlight the search text on the page?
