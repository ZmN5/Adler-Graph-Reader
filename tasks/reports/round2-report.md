# Round 2 Report - US-002: Extract and Core Concepts Testing

## Date: 2026-03-30

## Acceptance Criteria Status

| Criteria | Status | Notes |
|----------|--------|-------|
| After parsing completes, click Extract button | PASS | Extract button clickable and starts extraction |
| Verify extraction progress shows correctly | PASS | "Extracting concepts..." text appears |
| Wait for extraction to complete | **FAIL** | Extraction never completes - stuck indefinitely |
| Verify concept graph displays correctly | **FAIL** | Cannot test - extraction doesn't complete |
| Click Core Concepts button and verify modal works | **FAIL** | Cannot test - no concepts extracted |
| Typecheck passes | PASS | `npm run typecheck` passed |

## Test Flow

1. **Open Application**: Browser opened http://localhost:3000 successfully
2. **Library View**: Multiple books displayed including "designing-machine-learning-systems" (appears twice)
3. **Extract Flow**:
   - Clicked Extract button on first book
   - "Extracting concepts..." text appeared
   - Extract button became disabled
   - Waited 8+ minutes - extraction never completed
   - Extract button re-enabled but no concepts were extracted
4. **Reader View**:
   - Clicked on book title to open reader
   - Reader opened successfully with page navigation
   - "No concepts extracted yet" message displayed
   - Concept Graph and Core Concepts buttons visible but empty
5. **Second Book Test**:
   - Tried extracting second book instance
   - Same behavior - extraction appears stuck

## Screenshots Captured

| File | Description |
|------|-------------|
| 01-before-extract.png | Library view before clicking Extract |
| 02-extract-progress.png | "Extracting concepts..." progress indicator |
| 03-extract-still-running.png | After 3+ minutes still showing extraction |
| 04-reader-opened.png | Reader opened but no concepts |
| 05-extraction-still-running.png | Second extraction attempt still stuck |
| 06-reader-no-concepts.png | Reader showing "No concepts extracted yet" |
| 07-core-concepts-empty.png | Core Concepts shows empty state |

## Issues Found

### BUG-001: Extraction Never Completes
- **Severity**: P1 (Core functionality severely impaired)
- **Type**: Functional Bug
- **Description**: Clicking "Extract" button starts extraction but never completes. The "Extracting concepts..." message persists indefinitely (tested up to 8+ minutes).
- **Reproduction Steps**:
  1. Open http://localhost:3000
  2. Click "Extract" button on any book
  3. Observe "Extracting concepts..." message
  4. Wait - extraction never completes
- **Expected Behavior**: Extraction should complete within reasonable time (typically 1-5 minutes for a PDF book via LLM)
- **Actual Behavior**: Extraction hangs indefinitely
- **API Observation**: Backend API shows `total_pages: 1` for all books, even though UI shows 389 pages - this may indicate a parsing issue
- **Screenshot**: 03-extract-still-running.png

### BUG-002: Book Listed Twice
- **Severity**: P2 (Feature broken but has workaround)
- **Type**: Data/UI Issue
- **Description**: "designing-machine-learning-systems" appears twice in the library with duplicate entries
- **Reproduction Steps**:
  1. Open http://localhost:3000
  2. Observe library - book appears twice
- **Expected Behavior**: Book should appear only once
- **Actual Behavior**: Duplicate book entries
- **Workaround**: Can use either entry

## Additional Observations

1. **Page Count Discrepancy**: UI shows 389 pages but API returns `total_pages: 1`
2. **Extraction Progress UI**: The "Extracting concepts..." indicator works and shows correctly
3. **Reader Works**: Can open book and navigate pages successfully
4. **Empty States**: Proper empty state messages when no concepts extracted

## Root Cause Analysis

The extraction issue appears to be a backend problem. Possible causes:
1. LLM API call timeout or failure
2. Database write failure after extraction
3. Frontend not properly detecting extraction completion
4. PDF parsing issue causing extraction to fail silently

## Recommendations

1. **Investigate Backend Extraction Process**:
   - Check LM Studio connection
   - Review extraction API endpoint logs
   - Verify database writes are successful

2. **Fix Duplicate Book Issue**:
   - Investigate why book appears twice
   - May need database cleanup or dedup logic

3. **Add Extraction Timeout**:
   - Implement reasonable timeout (5 minutes max)
   - Show error message if extraction fails

4. **Fix Page Count Issue**:
   - Backend shows 1 page but UI shows 389
   - Investigate PDF parsing

## Testability Improvements Needed

1. Add timeout for extraction
2. Add error handling/display for failed extractions
3. Add extraction status to API response
4. Log extraction errors to backend logs
