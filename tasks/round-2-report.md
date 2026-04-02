# Round 2 Report: domain-specific-slm.epub

## Test Date
2026-04-02

## Book
- **Title**: domain-specific-slm.epub
- **Format**: EPUB
- **Pages**: 17
- **Size**: ~16MB

## Test Steps Completed

### 1. Upload
- Used backend API (`/api/books/upload`) instead of dev-browser due to filesystem access limitation
- Upload succeeded with book_id: `e8b1e7f5-ab41-45e0-9ec5-3085afc2cc8f`

### 2. Parse
- Called `POST /api/books/{book_id}/parse`
- Result: 50 chunks created, 17 pages

### 3. Extract
- Called `POST /api/books/{book_id}/extract`
- Extraction took ~5 minutes
- Result: 152 nodes, 161 edges extracted

### 4. Open Book Page
- Book opened successfully in the browser
- EPUB reader shows 16 chapters with navigation
- Graph panel shows 50/152 nodes initially visible with "Load More" button

### 5. Core Concepts Verification
- **Issue Found**: Core Concepts panel showed "No core concepts yet" initially
- **Root Cause**: Core concept identification didn't run automatically after extraction
- **Workaround**: Manually triggered `POST /api/books/{book_id}/identify-core-concepts`
- **Result**: 15 core concepts identified (10% of 152 nodes)
- **Core Concepts**: BERT, GPT, CodeGen, ONNX Runtime, Quantization, Prompt Engineering, Transformer Architecture, RAG, etc.
- **Theme Relevance**: All concepts are relevant to SLM/domain-specific ML theme

### 6. Node Click Verification
- Core Concepts list "View" buttons work correctly
- Node detail panel shows concept details with examples
- Graph canvas node clicking issue noted (see Problem 3)

## Issues Found

### Problem 1: Language Defaults to Chinese (Critical) - FIXED
- **Severity**: Critical
- **Description**: All extraction output (descriptions, categories) was in Chinese even for English books
- **Root Cause**: In `backend/src/extractor.rs`, "auto" language defaulted to "zh"
- **Fix Applied**: Changed default to "en" for better internationalization
- **Status**: Fixed

### Problem 2: Core Concepts Not Marked After Extraction (High)
- **Severity**: High
- **Description**: 0 out of 152 nodes were marked as core concepts after extraction
- **Root Cause**: Likely a silent failure in core concept identification during extraction
- **Workaround**: Manual trigger via API
- **Status**: Requires investigation - may need to add better error logging

### Problem 3: Node Click in Graph Canvas Not Working (Medium)
- **Severity**: Medium
- **Description**: Clicking on nodes in the graph canvas doesn't show the node detail panel
- **Status**: Open

## Test Results Summary

| Metric | Value |
|--------|-------|
| Upload | Success |
| Parse | Success (50 chunks) |
| Extract | Success (152 nodes, 161 edges) |
| Book Page Load | Success |
| Core Concepts | 15 identified (relevant to theme) |
| Node Click | Partial (list works, graph canvas doesn't) |
| Typecheck | Passes |

## Severity Breakdown
- Critical: 0 (after fix)
- High: 1 (core concepts auto-identification)
- Medium: 1 (node click in graph)
- Low: 0

## Next Steps
- Investigate why core concept identification doesn't run automatically during extraction
- Fix node click issue in graph canvas
- Round 3: Test designing-machine-learning-systems.pdf