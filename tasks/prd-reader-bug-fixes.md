# PRD: Reader Layout and API Bug Fixes

## Introduction

Fix critical bugs in the Intelligent Reading Concept Graph application including:
1. Database migration issue causing 404 errors on chunk API
2. Layout problems where ConceptGraph area is too small and scroll behavior is incorrect
3. Page-level scroll synchronization issues between panels

## Goals

- Fix SQLite migration that fails to add `chapter_href` column (causes 404 errors)
- Optimize three-column layout to give ConceptGraph more usable space
- Fix scroll behavior so panels scroll independently
- Ensure backward compatibility with existing data

## User Stories

### US-001: Fix database migration for chapter_href column
**Description:** As a developer, I need to fix the database migration that fails silently due to SQLite not supporting `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` syntax, causing chunk API to return 404 errors.

**Acceptance Criteria:**
- [ ] Replace non-standard SQL with SQLite-compatible column existence check
- [ ] Add `chapter_href` column only if it doesn't already exist
- [ ] Migration runs successfully on new databases
- [ ] Migration handles existing databases gracefully (adds missing column)
- [ ] Typecheck/lint passes

### US-002: Optimize three-column layout proportions
**Description:** As a user, I want the ConceptGraph to have more space so I can better visualize the concept relationships, while the PDF/EPUB reader and detail panel take appropriate amounts of space.

**Acceptance Criteria:**
- [x] Adjust layout ratios: Left 40% / Center 50% / Right 280px (was 320px)
- [x] When right panel is hidden, center panel expands appropriately
- [x] All panels remain usable and content doesn't overflow
- [x] Typecheck passes
- [x] Verify in browser using dev-browser skill

### US-003: Fix page-level scroll synchronization
**Description:** As a user, I want to scroll the PDF/EPUB reader independently without the ConceptGraph panel following the scroll, so I can focus on reading while keeping the graph view stable.

**Acceptance Criteria:**
- [x] Each panel has its own scroll container with `overflow-auto`
- [x] Scrolling in left panel doesn't affect center/right panels
- [x] No page-level scrollbars appear (only panel-level scrollbars)
- [x] Header and book title bar remain fixed during panel scrolling
- [x] Typecheck passes
- [x] Verify in browser using dev-browser skill

### US-004: Handle existing database with missing column
**Description:** As a user with existing books and data, I want the application to automatically detect and fix the missing `chapter_href` column without losing my existing books and concept graphs.

**Acceptance Criteria:**
- [x] Application detects missing column on startup
- [x] Automatically adds column if missing (backward compatible)
- [x] Existing data remains intact
- [x] No manual database reset required
- [x] Typecheck passes

## Functional Requirements

- FR-1: Database migration must use SQLite-compatible syntax for checking column existence (pragma_table_info)
- FR-2: Layout proportions: Left panel 40%, Center panel 50%, Right panel 280px fixed width
- FR-3: Each panel must have independent scroll containment (`overflow: hidden` on container, `overflow: auto` on scrollable content)
- FR-4: Application must handle both new databases and existing databases with missing columns
- FR-5: When right panel is collapsed, center panel should expand to fill available space

## Non-Goals

- Redesigning the ConceptGraph visualization itself
- Adding new features to the graph or reader
- Changing the database schema beyond fixing the migration
- Modifying the API contract (endpoints remain the same)

## Technical Considerations

- SQLite `ALTER TABLE` doesn't support `IF NOT EXISTS` clause
- Must use `pragma_table_info` to check column existence before altering
- Layout uses Tailwind CSS flexbox; adjust `flex` values
- Height calculation must account for header (56px) and book title bar (41px)
- Panel scroll containers need explicit `h-full` or calculated heights

## Files to Modify

| File | Changes |
|------|---------|
| `backend/src/db.rs` | Fix migration logic for `chapter_href` column |
| `frontend/src/components/ThreeColumnLayout.tsx` | Adjust flex proportions and right panel width |
| `frontend/src/App.tsx` | Fix height calculation and scroll containment |

## Success Metrics

- Chunk API returns 200 with valid data instead of 404
- Source Citations and Location buttons work correctly
- Three panels display with proper proportions (ConceptGraph visibly larger)
- Scrolling PDF/EPUB doesn't cause ConceptGraph to move
- No page-level scrollbars appear
- Existing data preserved when updating application

## Open Questions

- Should we add a collapsible Legend in GraphCanvas to reclaim even more space?
- Do we need a migration version table to track schema changes more robustly?
