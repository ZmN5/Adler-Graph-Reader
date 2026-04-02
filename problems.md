# Problems Log

## Round 1: you-dont-know-js-yet.epub (2026-04-02)

### Problem 1: Extraction Hangs with Timeout (Critical)
- **Severity**: Critical (FIXED)
- **Description**: Extraction fails because LLM requests timeout (60s default). With concurrency=1, first chunk (82 chars) succeeds quickly but subsequent chunks (3320+ chars) timeout after 60 seconds.
- **Status**: FIXED - Increased timeout to 180 seconds in llm_client.rs
- **Root Cause**: LLM client had 60s timeout but larger chunks take longer to process. qwen3.5-9b model is slow on longer content.
- **Fix Applied**: Changed timeout from 60s to 180s in `backend/src/llm_client.rs` line 107
- **Verification**: Extraction now completes successfully for all chunks (106 nodes, 96 edges, 9 core concepts for you-dont-know-js-yet.epub)

### Problem 2: File Upload via dev-browser Fails
- **Severity**: Medium
- **Description**: dev-browser sandbox cannot access filesystem, preventing automated file upload. Had to use backend API directly (curl) to upload books.
- **Status**: Open (Known limitation)
- **Notes**: This is a dev-browser sandbox limitation, not a bug in the app

---

## Previous Rounds (if any)

_No problems recorded yet._