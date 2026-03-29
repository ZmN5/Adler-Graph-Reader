# Evaluation Report - Intelligent Reading Concept Graph
**Date**: 2026-03-28
**Evaluator**: project-evaluator
**Stage**: Post-fixes evaluation

---

## Previous Blocking Issues - Status

| Issue | Status | Details |
|-------|--------|---------|
| 1. Missing Static File Server | **FIXED** | `GET /api/books/{id}/file` endpoint is now implemented and working |
| 2. BookList `onSelectBook` Not Wired | **FIXED** | App.tsx properly wires the callback and shows SplitPane with PDFReader/EPUBReader + GraphCanvas |
| 3. BookList Missing Parse Button | **FIXED** | Parse button appears when `total_pages == null`, Extract button when chunks exist |

---

## Flow Testing Results

### Test 1: App Loads Correctly
- **Status**: PASS
- **Evidence**: App renders at http://localhost:3000 with Header, Welcome text, Upload button, and Book list

### Test 2: Book List Displays
- **Status**: PASS
- **Evidence**: Three books displayed:
  - `domain-specific-slm` (EPUB, 18 pages) - Extract button
  - `Build a DeepSeek Model...` (EPUB) - Extract button
  - `Test Book` (PDF, Test Author) - Parse button

### Test 3: Book Detail View Opens
- **Status**: PASS
- **Evidence**: Clicking a book shows SplitPane with:
  - Left pane: PDF/EPUB reader
  - Right pane: GraphCanvas
  - Header with Close button

### Test 4: PDF Reader Loads
- **Status**: PASS (for valid PDFs)
- **Evidence**: Test Book PDF loaded and displayed correctly with page navigation
- **Note**: "Test Book" PDF has only 1 page and renders correctly

### Test 5: EPUB Reader Loads
- **Status**: FAIL (BLOCKING)
- **Evidence**: EPUB reader gets stuck on "Loading EPUB..." indefinitely
- **Root Cause**: The backend serves the EPUB as a single blob via `/api/books/{id}/file`. However, epubjs needs to access internal EPUB resources (chapters, images, CSS) which would require individual endpoints. The current architecture does not support this.

### Test 6: Parse Function
- **Status**: PARTIAL
- **Evidence**:
  - "Test Book" PDF parse fails: `Invalid file trailer` - the PDF is corrupted/invalid
  - This is a test data issue, not a code issue

### Test 7: Extract Function
- **Status**: BLOCKED (external dependency)
- **Evidence**: LM Studio API returns 503 Service Unavailable
- **Note**: This is expected if LM Studio is not running locally

### Test 8: Graph Display
- **Status**: PASS (infrastructure)
- **Evidence**: GraphCanvas component renders with placeholder text "No concepts extracted yet"

---

## NEW Issues Found

### Issue 1: EPUB Reader Cannot Load Files (BLOCKING)
- **Severity**: Critical
- **Category**: Functionality
- **Location**: `frontend/src/components/EPUBReader.tsx` + backend file serving
- **Description**: When opening an EPUB book, the reader shows "Loading EPUB..." indefinitely. The root cause is architectural:
  - epubjs fetches the EPUB file, then needs to extract and request internal resources (chapter HTML files, images, CSS)
  - The current backend only serves the whole EPUB file as a single blob at `/api/books/{id}/file`
  - Internal resource requests would be relative URLs that don't exist on the backend
- **Impact**: EPUB books cannot be read through the application
- **Recommendation**: Either:
  1. Use epubjs's `blob` option to pass the file data directly (requires fetching via fetch() API first)
  2. Implement a more sophisticated backend that can serve internal EPUB resources
  3. Use a different EPUB loading approach that doesn't require internal resource fetching

### Issue 2: "Test Book" PDF is Corrupted
- **Severity**: High
- **Category**: Test Data
- **Location**: Book ID `2261226e-26d2-4e64-a502-587e1e8d29c8`
- **Description**: The PDF file returns error "Invalid file trailer" when parsing
- **Impact**: Cannot test PDF parsing functionality
- **Recommendation**: Replace with a valid PDF file for testing

### Issue 3: LLM API Not Available
- **Severity**: High (but external)
- **Category**: External Dependency
- **Description**: LM Studio API returns 503 Service Unavailable during extraction
- **Impact**: Concept extraction cannot be tested
- **Recommendation**: Ensure LM Studio is running before testing extraction

---

## Summary

### Fixed Issues
All three previously reported blocking issues have been resolved:
1. Static file server endpoint now works
2. Book selection properly opens detail view
3. Parse button appears for unparsed books

### Remaining Blocking Issues
1. **EPUB Reader** - Cannot load EPUB files due to architectural mismatch with epubjs
2. **LM Studio** - External dependency not running (not a code issue)

### Core Flow Status
- **Upload Book**: Not tested (no new upload attempted)
- **Parse Book**: Fails for corrupted PDF; would need valid PDF to test
- **Extract Concepts**: Blocked by LM Studio unavailability
- **View PDF**: Works correctly
- **View EPUB**: Does not work (BLOCKING)
- **View Graph**: Infrastructure works, no data due to extraction not running

---

## Files Referenced
- Backend main.rs: `/Users/heshi/fcy-learning/reader-v3/backend/src/main.rs`
- App.tsx: `/Users/heshi/fcy-learning/reader-v3/frontend/src/App.tsx`
- BookList.tsx: `/Users/heshi/fcy-learning/reader-v3/frontend/src/components/BookList.tsx`
- PDFReader.tsx: `/Users/heshi/fcy-learning/reader-v3/frontend/src/components/PDFReader.tsx`
- EPUBReader.tsx: `/Users/heshi/fcy-learning/reader-v3/frontend/src/components/EPUBReader.tsx`

## Screenshots
- Books list: `/Users/heshi/fcy-learning/reader-v3/tasks/screenshot-books-list.png`
- Before parse: `/Users/heshi/fcy-learning/reader-v3/tasks/screenshot-before-parse.png`
- EPUB loading: `/Users/heshi/fcy-learning/reader-v3/tasks/screenshot-epub-loading.png`
- Final EPUB: `/Users/heshi/fcy-learning/reader-v3/tasks/screenshot-final-epub.png`
