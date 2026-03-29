---
name: evaluation-notes-2026-03-28
description: Evaluation notes and LM Studio dependency findings
type: feedback
---

# Evaluation Notes (2026-03-28)

## Key Findings

### LM Studio External Dependency
- LM Studio runs on port 1234 with multiple models available
- Extraction hangs indefinitely if no model is loaded
- Not a code bug but a configuration requirement
- Recommendation: Add explicit error message when LM Studio API returns 503 or times out

### Data Directory Path Issue
- Backend creates `backend/data/` when running from project root via start.sh
- CLAUDE.md specifies data should be at `{项目根目录}/data/`
- This is a misconfiguration that should be fixed

### EPUB Reader Fix
- Previous evaluation reported EPUB loading broken
- Current implementation uses `URL.createObjectURL(blob)` approach with 30s timeout
- Looks correct but full end-to-end test was not completed in this session