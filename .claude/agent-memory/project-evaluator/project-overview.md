---
name: intelligent-reading-concept-graph
description: Project overview for Intelligent Reading Concept Graph system
type: project
---

# Intelligent Reading Concept Graph System

## Project Basics
- **Path**: `/Users/heshi/fcy-learning/reader-v3`
- **Type**: Local knowledge management tool - converts PDF/EPUB to concept graphs via LLM
- **Tech Stack**:
  - Backend: Rust + Axum 0.8 + SQLite + sqlx
  - Frontend: React 18 + TypeScript + Vite 6 + Tailwind CSS
  - LLM: LM Studio (OpenAI compatible API at localhost:1234)

## Current Status (2026-03-28)
- Backend runs on port 8080
- Frontend runs on port 3001 (3000 was in use during evaluation)
- All API endpoints working EXCEPT concept extraction (blocked by LM Studio external dependency)
- File serving, parsing, and chunk endpoints working
- PDFReader works correctly
- EPUBReader architecture fixed (blob URL approach with 30s timeout)
- GraphCanvas infrastructure working (empty graph placeholder)

## Known Issues
- **BLOCKING**: Data directory path mismatch - backend uses `backend/data/` instead of project root `data/`
- **HIGH (External)**: Concept extraction blocked - requires model loaded in LM Studio
- **MEDIUM**: Test Book PDF corrupted (invalid file trailer)
- **MEDIUM**: Frontend port 3001 differs from start.sh documentation (3000)

## Key Files
- Backend entry: `backend/src/main.rs`
- API client: `frontend/src/lib/api-client.ts`
- BookList: `frontend/src/components/BookList.tsx`
- PDFReader: `frontend/src/components/PDFReader.tsx`
- EPUBReader: `frontend/src/components/EPUBReader.tsx`
- GraphCanvas: `frontend/src/components/GraphCanvas.tsx`
- SplitPane: `frontend/src/components/SplitPane.tsx`

## Evaluation Report
Full report at: `tasks/evaluation-report-2026-03-28.md`