# Product Flow Problems

## Issues Found During Walkthrough

### 1. Delete Button - No Confirmation Dialog
**Severity:** High
**Location:** Book list page
**Description:** The Delete button deletes books immediately without any confirmation dialog. Users may accidentally delete books with no way to recover.
**Screenshot:** `problems_07_after_delete.png`

---

### 2. Chapter Navigation - "Unknown" Title Display
**Severity:** Medium
**Location:** EPUB Reader view
**Description:** When navigating to a chapter (e.g., "1_Introduction_to_DeepSeek"), the header still shows "Unknown" instead of the actual chapter title. The Previous/Next buttons remain disabled.
**Screenshot:** `problems_11_chapter_navigation.png`

---

### 3. Navigation Dropdown Not Expanding
**Severity:** Medium
**Location:** EPUB Reader view
**Description:** The chapter navigation dropdown (select element with 5 options) does not visually expand when clicked.
**Screenshot:** `problems_10_reader_view.png`

---

### 4. Concept Graph Button - No Visible Action
**Severity:** Medium
**Location:** EPUB Reader view
**Description:** Clicking the "Concept Graph" button in the reader view produces no visible change or feedback.
**Screenshot:** `problems_10_reader_view.png`

---

### 5. Extract Button - No Progress Indication
**Severity:** Medium
**Location:** Book list and reader view
**Description:** When the Extract/Parse button is clicked, it becomes disabled but there's no visible progress indicator (spinner, progress bar, or status text). After 35+ seconds of waiting, no feedback is provided.
**Screenshot:** `problems_13_extract_stuck.png`

---

### 6. Core Concepts Modal - Cannot Close
**Severity:** Medium
**Location:** EPUB Reader view
**Description:** The Core Concepts modal shows "No core concepts yet" but cannot be closed by pressing Escape key. Must click Close button on parent (reader) to dismiss.
**Screenshot:** `problems_04_core_concepts_modal.png`

---

### 7. Upload Modal Language Selection
**Severity:** Low
**Location:** Upload flow
**Description:** The upload modal shows "Extraction Language" dropdown with Auto-detect, Chinese, English options but the meaning of these options is unclear without context.
**Screenshot:** `problems_08_upload_modal.png`

---

## Screenshots

| Screenshot | Description |
|------------|-------------|
| `problems_01_home.png` | Home page initial state |
| `problems_02_lang_toggle.png` | After language toggle |
| `problems_03_epub_reader.png` | EPUB reader view |
| `problems_04_core_concepts_modal.png` | Core Concepts modal (cannot close) |
| `problems_05_back_home.png` | Back to home |
| `problems_06_extract_clicked.png` | Extract button clicked (disabled) |
| `problems_07_after_delete.png` | Book deleted (no confirmation) |
| `problems_08_upload_modal.png` | Upload modal with language selection |
| `problems_09_upload_success.png` | Upload success |
| `problems_10_reader_view.png` | Reader with no concepts |
| `problems_11_chapter_navigation.png` | Chapter navigation shows "Unknown" |
| `problems_12_after_parse.png` | After Parse button clicked |
| `problems_13_extract_stuck.png` | Extract stuck in disabled state |
