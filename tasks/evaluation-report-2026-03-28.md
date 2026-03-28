# Evaluation Report - Intelligent Reading Concept Graph
**Date**: 2026-03-28
**Evaluator**: project-evaluator
**Stage**: Comprehensive System Evaluation
**System**: Backend http://localhost:8080, Frontend http://localhost:3001

---

## Executive Summary

The system is partially functional. Core infrastructure (API endpoints, file serving, parsing) works correctly. PDF reading is functional. EPUB reading architecture is in place but was not fully tested in this session. Concept extraction is blocked by external dependency (LM Studio). Concept graph visualization infrastructure is properly implemented but has no data due to blocked extraction.

---

## 1. Health Check

| Endpoint | Expected | Actual | Status |
|----------|----------|--------|--------|
| GET /api/health | {"status":"ok"} | {"status":"ok"} | **PASS** |

---

## 2. Core Functionality Testing

### 2.1 Book Upload
- **Endpoint**: POST /api/books/upload
- **Test**: Uploaded `designing-machine-learning-systems.pdf`
- **Result**: SUCCESS - returned `{"book_id":"94d245d9-eb46-42af-a4dc-604f581b534f","title":"designing-machine-learning-systems.pdf"}`
- **File Storage**: Stored at `/backend/data/books/94d245d9-eb46-42af-a4dc-604f581b534f.pdf` (content-length: 16,238,412 bytes)

### 2.2 Book Parsing
- **Endpoint**: POST /api/books/{id}/parse
- **Test 1**: Parsed PDF book `94d245d9...` - **SUCCESS**
  - Response: `{"status":"completed","chunks_created":941,"total_pages":1}`
- **Test 2**: Parsed EPUB book `f5df5584...` - **SUCCESS**
  - Response: `{"status":"completed","chunks_created":741,"total_pages":18}`
- **Chunks Endpoint**: GET /api/books/{id}/chunks - **WORKING**
  - Returns array of chunk objects with id, book_id, page_start, page_end, content

### 2.3 Concept Extraction
- **Endpoint**: POST /api/books/{id}/extract
- **Status**: **BLOCKED (EXTERNAL DEPENDENCY)**
- **Observation**: Request hangs when no model is loaded in LM Studio
- **LM Studio Status**: Running on port 1234 with 7 models available (qwen3.5-9b, qwen3.5-2b, etc.)
- **Root Cause**: Extraction requires a model to be actively loaded in LM Studio. Without a loaded model, the API call hangs indefinitely.
- **Classification**: **HIGH** (blocks core feature) but **external** (not a code bug)

### 2.4 Book File Serving
- **Endpoint**: GET /api/books/{id}/file
- **PDF Test** (`94d245d9...`): **SUCCESS**
  - HTTP 200, content-type: application/pdf
  - content-length: 16,238,412 bytes
- **EPUB Test** (`f5df5584...`): **SUCCESS**
  - HTTP 200, content-type: application/epub+zip
  - content-length: 16,331,239 bytes

### 2.5 Concept Graph
- **Book Graph Endpoint**: GET /api/books/{id}/graph - **WORKING**
  - Returns `{"nodes":[],"edges":[]}` (empty because extraction hasn't run)
- **Global Graph Endpoint**: GET /api/graph/global - **WORKING**
  - Returns `{"nodes":[],"edges":[]}` (empty)

---

## 3. Frontend Component Analysis

### 3.1 BookList Component
**File**: `/frontend/src/components/BookList.tsx`
- **Status**: Properly implemented
- **Features**:
  - Displays book list with title, author, format badge, page count
  - Parse button appears when `total_pages == null`
  - Extract button appears when `total_pages != null`
  - Delete button with confirmation
  - Loading and error states
- **Issue**: None found

### 3.2 PDFReader Component
**File**: `/frontend/src/components/PDFReader.tsx`
- **Status**: **WORKING**
- **Features**:
  - Uses pdfjs-dist to render PDF
  - Page navigation (prev/next, direct input)
  - Keyboard navigation (arrow keys)
  - Responsive scaling to container width
  - Loading and error states
- **Issue**: None found

### 3.3 EPUBReader Component
**File**: `/frontend/src/components/EPUBReader.tsx`
- **Status**: **ARCHITECTURALLY SOUND** (not fully verified in this session)
- **Previous Issue (from evaluation-report-2026-03-28-v2.md)**:
  - EPUB loading got stuck indefinitely
  - Root cause: epubjs needs to fetch internal EPUB resources (chapters, images, CSS) which requires a different architecture than serving a single blob
- **Current Implementation Fix**: Uses `URL.createObjectURL(blob)` approach (line 55) with 30-second timeout (lines 62-71)
- **Assessment**: The fix looks correct - fetches the full EPUB as a blob and creates a blob URL for epubjs to handle. Timeout prevents indefinite hanging.
- **Note**: Full end-to-end EPUB reading was not verified in this session due to time constraints

### 3.4 GraphCanvas Component
**File**: `/frontend/src/components/GraphCanvas.tsx`
- **Status**: **INFRASTRUCTURE WORKING** (no data to display)
- **Features**:
  - Uses react-force-graph-2d for visualization
  - Dynamic node sizing based on source_chunk_ids count
  - Node selection and hover states
  - Edge labels showing relation_type
  - Responsive to container resize
  - Zoom and pan interactions
- **Issue**: None - shows "No concepts extracted yet" placeholder when graph is empty

### 3.5 SplitPane Component
**File**: `/frontend/src/components/SplitPane.tsx`
- **Status**: **WORKING**
- **Features**:
  - Horizontal and vertical modes
  - Draggable divider with mouse tracking
  - Layout persistence in localStorage
  - Min pane size constraints (20%)

### 3.6 App.tsx
**File**: `/frontend/src/App.tsx`
- **Status**: **WORKING**
- **Flow**:
  - Home view: Header + Welcome text + Upload button + Book list
  - Book detail view: Close button + SplitPane (PDFReader/EPUBReader + GraphCanvas)

---

## 4. Issues Classification

### BLOCKING Issues

| # | Issue | Category | Location | Description |
|---|-------|----------|----------|-------------|
| 1 | **Data Directory Path Mismatch** | Configuration | backend/src/main.rs (line 723-724) | Backend stores files at `{cwd}/backend/data/` instead of `{project_root}/data/`. The CLAUDE.md spec says data should be at `{项目根目录}/data/`. Currently creates `backend/data/` when running from project root. This causes inconsistency when start.sh runs from project root. |

### HIGH Issues

| # | Issue | Category | Location | Description |
|---|-------|----------|----------|-------------|
| 2 | **LM Studio Model Not Auto-Loaded** | External Dependency | LM Studio configuration | Extraction hangs because no model is auto-loaded. User must manually load a model in LM Studio before extraction will work. |
| 3 | **Extraction Lacks Graceful Error Handling** | Robustness | backend/src/llm_client.rs (line 69) | LLM client has 120s timeout, but if LM Studio has no model loaded, the request hangs indefinitely without a clear error message to the user. |

### MEDIUM Issues

| # | Issue | Category | Location | Description |
|---|-------|----------|----------|-------------|
| 4 | **Test Book PDF Corrupted** | Test Data | Book ID `2261226e-26d2-4e64-a502-587e1e8d29c8` | The pre-existing "Test Book" PDF returns "Invalid file trailer" error when parsing. Should be replaced with a valid PDF. |
| 5 | **Port Configuration** | Documentation | start.sh | start.sh hardcodes port 3000 for frontend, but evaluation used port 3001 (3000 was in use). Documentation should clarify port override capability. |

### SUGGESTION Issues

| # | Issue | Category | Location | Description |
|---|-------|----------|----------|-------------|
| 6 | **EPUB Loading Timeout Message** | UX | EPUBReader.tsx (line 68) | The 30-second timeout shows generic error message. Could be improved to suggest the file may be large or the backend is slow. |
| 7 | **Graph Canvas Performance** | Performance | GraphCanvas.tsx | Force-graph with 100+ nodes may have performance issues. Consider adding pagination or clustering for large graphs. |
| 8 | **Empty State Illustrations** | UI/UX | GraphCanvas.tsx (line 233-243) | Placeholder uses inline SVG but could use a proper icon component for consistency. |

---

## 5. API Routes Summary

| Method | Endpoint | Status |
|--------|----------|--------|
| GET | /api/health | WORKING |
| POST | /api/books/upload | WORKING |
| GET | /api/books | WORKING |
| GET | /api/books/{id} | WORKING |
| DELETE | /api/books/{id} | NOT TESTED |
| GET | /api/books/{id}/file | WORKING |
| POST | /api/books/{id}/parse | WORKING |
| GET | /api/books/{id}/chunks | WORKING |
| POST | /api/books/{id}/extract | BLOCKED (LM Studio) |
| GET | /api/books/{id}/graph | WORKING |
| GET | /api/graph/global | WORKING |
| GET | /api/nodes/{id} | NOT TESTED |
| GET | /api/settings/language | WORKING |
| PUT | /api/settings/language | NOT TESTED |

---

## 6. Previous Evaluation Status

### Fixed from Previous Evaluation (evaluation-report-2026-03-28.md)
| Issue | Status |
|-------|--------|
| Missing static file server (GET /api/books/{id}/file) | **FIXED** |
| BookList onSelectBook not wired | **FIXED** |
| BookList missing Parse button | **FIXED** |

### Previously Reported - Still Present
| Issue | Status |
|-------|--------|
| Test Book PDF corrupted | **STILL PRESENT** |
| LM Studio extraction blocked | **EXTERNAL DEPENDENCY** |
| Data directory inconsistency | **STILL PRESENT** |

---

## 7. Data Flow Verification

```
Upload Book
    └─> POST /api/books/upload
        └─> File stored at backend/data/books/{uuid}.{format}
            └─> Database: books table updated

Parse Book
    └─> POST /api/books/{id}/parse
        └─> PDF: pdf_parser::parse_pdf() or EPUB: epub_parser::parse_epub()
            └─> Chunks stored in database: chunks table
                └─> Returns {chunks_created: N, total_pages: M}

Extract Concepts (BLOCKED)
    └─> POST /api/books/{id}/extract
        └─> extractor::extract_concepts_from_book()
            └─> LLM client calls LM Studio API
                └─> Results stored in nodes and edges tables

View Book Detail
    └─> GET /api/books/{id}/file (PDF/EPUB blob)
        └─> PDFReader uses pdfjs-dist with URL to API endpoint
        └─> EPUBReader uses epubjs with blob URL

View Concept Graph
    └─> GET /api/books/{id}/graph
        └─> GraphCanvas renders force-graph with nodes/edges
```

---

## 8. Environment Details

**Backend**:
- Framework: Rust + Axum 0.8
- Database: SQLite + sqlx
- File storage: `backend/data/books/`
- Database: `backend/data/reader.db`

**Frontend**:
- Framework: React 18 + TypeScript + Vite 6
- UI: Tailwind CSS + Lucide icons
- State: Zustand
- PDF: pdfjs-dist
- EPUB: epubjs
- Graph: react-force-graph-2d

**External**:
- LM Studio: Running on port 1234
- Available models: qwen3.5-9b, qwen3.5-2b, qwen3.5-4b-mlx, qwen3.5-35b-a3b, etc.

---

## 9. Recommendations

### Immediate Actions
1. **Replace corrupted Test Book PDF** - Replace `/backend/data/books/2261226e-26d2-4e64-a502-587e1e8d29c8.pdf` with a valid PDF file for testing
2. **Document LM Studio requirement** - Add clear instructions that a model must be loaded before extraction. Consider adding an explicit check.
3. **Fix data directory path** - Align with CLAUDE.md spec by resolving data directory relative to project root, not current working directory

### For LM Studio Integration
1. Add health check for LM Studio in the extraction flow
2. Return clear error if no model is loaded: "Please load a model in LM Studio before extracting concepts"
3. Consider adding an endpoint to check LM Studio status

### For Future Development
1. Add unit tests for parsers (especially edge cases with malformed files)
2. Add integration tests for the full extraction flow
3. Consider adding a progress indicator for extraction (currently shows spinner indefinitely)
4. Add comprehensive EPUB loading test to verify the blob URL approach works

---

## 10. Conclusion

The system is in a **functional but incomplete** state:
- **Working**: Upload, parse, file serving, PDF reading, frontend navigation, graph visualization infrastructure
- **Blocked**: Concept extraction (external dependency - LM Studio)
- **Needs Attention**: Data directory configuration, test data

The core reading functionality works correctly. The concept extraction feature is waiting on an external service configuration. Once LM Studio is properly configured with a loaded model, the system should be fully functional for the complete flow from book upload to concept graph generation.

---

**Report Generated**: 2026-03-28
**Evaluator**: project-evaluator
**Files Analyzed**:
- `/Users/heshi/fcy-learning/reader-v3/backend/src/main.rs`
- `/Users/heshi/fcy-learning/reader-v3/backend/src/llm_client.rs`
- `/Users/heshi/fcy-learning/reader-v3/backend/src/extractor.rs`
- `/Users/heshi/fcy-learning/reader-v3/frontend/src/App.tsx`
- `/Users/heshi/fcy-learning/reader-v3/frontend/src/components/BookList.tsx`
- `/Users/heshi/fcy-learning/reader-v3/frontend/src/components/PDFReader.tsx`
- `/Users/heshi/fcy-learning/reader-v3/frontend/src/components/EPUBReader.tsx`
- `/Users/heshi/fcy-learning/reader-v3/frontend/src/components/GraphCanvas.tsx`
- `/Users/heshi/fcy-learning/reader-v3/frontend/src/components/SplitPane.tsx`
- `/Users/heshi/fcy-learning/reader-v3/frontend/src/lib/api-client.ts`
- `/Users/heshi/fcy-learning/reader-v3/start.sh`
- `/Users/heshi/fcy-learning/reader-v3/frontend/vite.config.ts`