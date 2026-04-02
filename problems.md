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

## Round 2: domain-specific-slm.epub (2026-04-02)

### Problem 1: Language Defaults to Chinese for All Books (Critical)
- **Severity**: Critical (FIXED)
- **Description**: All extraction output (descriptions, categories) is in Chinese even for English books. The language setting defaults to "auto" which gets converted to "zh" in extractor.rs.
- **Status**: FIXED - Changed default from "zh" to "en" in extractor.rs
- **Root Cause**: In `backend/src/extractor.rs` line 350-351, "auto" language defaulted to "zh" (Chinese) instead of English.
- **Fix Applied**: Changed the default from "zh" to "en" so English books produce English output.
- **Impact**: English books like domain-specific-slm.epub were producing Chinese descriptions (e.g., "BERT（Bidirectional Encoder Representation from Transformers）是基于Transformer编码器部分的模型家族...")

### Problem 2: Core Concepts Not Marked After Extraction (High)
- **Severity**: High (FIXED - but needs verification)
- **Description**: After extraction completed, 0 out of 152 nodes were marked as core concepts. Core Concepts panel showed "No core concepts yet".
- **Status**: Fixed by manually triggering POST /api/books/{id}/identify-core-concepts
- **Root Cause**: The core concept identification may have failed silently during extraction, or there's a race condition.
- **Verification**: After manual trigger, 15 core concepts were correctly identified using the v2 algorithm (community detection with PageRank).
- **Note**: This may have been a one-time issue - need to verify in Round 3 if it recurs.

### Problem 3: Node Click in Graph Canvas Not Responding
- **Severity**: Medium
- **Description**: Clicking on nodes in the graph canvas doesn't show the node detail panel.
- **Status**: Open
- **Notes**: The "View" button in Core Concepts list works, but direct node clicking in the graph canvas doesn't trigger the detail panel.

---

## Previous Rounds (if any)

_No problems recorded yet._