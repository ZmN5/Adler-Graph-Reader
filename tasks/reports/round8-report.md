# Round 8 Report: Error Handling and Edge Cases

## Test Date
2026-03-30

## Tester
browser-use automated testing

## Acceptance Criteria Status

| Criteria | Status | Notes |
|----------|--------|-------|
| Test uploading same book twice | FAIL | Creates duplicate book entry - no validation |
| Test clicking Parse on already parsed book | N/A | Books show Parse OR Extract, not both |
| Test network error handling | NOT TESTED | Cannot simulate network errors in automated test |
| Verify error messages are user-friendly | PARTIAL | Invalid file type shows message, page errors silently clamp |
| Verify app recovers gracefully from errors | PASS | Cancel dialogs work, invalid input is handled gracefully |
| Typecheck passes | PASS | `npm run typecheck` completed without errors |

## Bugs Found

### P2: Duplicate Book Upload Allowed
- **Severity**: P2
- **Description**: Uploading the same book twice creates duplicate entries in the library with no error or warning
- **Steps to reproduce**:
  1. Upload "you-dont-know-js-yet.epub"
  2. Upload "you-dont-know-js-yet.epub" again
  3. Result: Two identical book entries appear
- **Workaround**: None - duplicates are created silently
- **Expected**: App should detect duplicate file and show error message "Book already exists"
- **Screenshot**: `round8/03-duplicate-book-uploaded.png`

### P3: Invalid Page Number Silently Corrected
- **Severity**: P3
- **Description**: When entering an invalid page number (e.g., 9999 or -5), the app silently corrects to the nearest valid page without user notification
- **Steps to reproduce**:
  1. Open a PDF book
  2. Enter page number "9999"
  3. Result: Page changes to 389 (last page) with no notification
  4. Enter page number "-5"
  5. Result: Page changes to 1 (first page) with no notification
- **Workaround**: None needed - works correctly but no feedback to user
- **Expected**: Show brief toast/message like "Page not found, showing last available page"
- **Screenshot**: `round8/08-invalid-page-handling.png`

## Working Features

1. **Invalid File Type Error**: Upload dialog shows clear error message "Invalid file format. Please upload a .pdf or .epub file." with "Try again" button
2. **Delete Confirmation Dialog**: Shows "Confirm delete 'book-name'? This cannot be undone." with Cancel and Delete buttons
3. **Cancel Button Works**: Cancel properly dismisses dialogs without performing the action
4. **Page Number Clamping**: Invalid page numbers are correctly clamped to valid range (1 to max pages)
5. **Language Toggle**: Button works correctly
6. **Modal Close Button**: [X] button works to close modals

## Error Handling Summary

| Scenario | Error Message | Recovery Available |
|----------|---------------|-------------------|
| Upload same book twice | None (silent duplicate) | No - duplicates created |
| Upload invalid file type (.txt) | "Invalid file format. Please upload a .pdf or .epub file." | Yes - Try again button |
| Enter page > max | None (silent clamp to max) | Yes - page updates |
| Enter negative page | None (silent clamp to 1) | Yes - page updates |
| Delete book | Confirmation dialog | Yes - Cancel button |
| Escape key (from Round 7) | Does not close modals | Must use Close button |

## Screenshots
- `round8/01-initial-state.png` - Initial library state
- `round8/02-upload-dialog-same-book.png` - Upload dialog showing same book selected
- `round8/03-duplicate-book-uploaded.png` - **BUG**: Two duplicate entries after upload
- `round8/04-invalid-file-format.png` - Error message for invalid file type
- `round8/05-delete-confirmation.png` - Delete confirmation dialog works correctly
- `round8/06-epub-reader-open.png` - EPUB reader opens correctly
- `round8/07-pdf-reader-with-graph.png` - PDF reader with concept graph overlay
- `round8/08-invalid-page-handling.png` - Invalid page number silently corrected

## Recommendations
1. Add duplicate book detection before upload - compare by filename and file hash
2. Show user-friendly toast notification when page number is invalid and being clamped
3. Consider adding keyboard shortcut (Escape) to close modals
4. Add page count validation indicator before submission