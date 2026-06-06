# Chrissy's Recipes — Claude Guidelines

## Firebase
- After any Firestore schema/data migration, verify document counts and query a sample before declaring success
- Firestore security rules must explicitly allow any metadata paths (e.g., _appMeta) or they will trigger permission warnings on load

## JavaScript Gotchas
- Watch for temporal dead zone issues with `let`/`const` when variables are referenced before initialization, especially with module-level `db` or config objects
- **`recipes` vs `userRecipes`**: `const recipes = [...]` (~line 2773) is a legacy hardcoded array — never use it for filters, search, or display. `let userRecipes = []` is the live Firebase array. All features must use `userRecipes`.
- Every function called from an inline `onclick="..."` must be exported via `window.functionName = functionName` in the exports block (~line 4177). Missing this causes `ReferenceError: X is not defined` at runtime.

## Modal Z-Index Stack
- `.modal-overlay` (recipe detail, picker, etc.): z-index 200
- `.item-modal-overlay` (item edit): z-index 300
- `#review-modal` (ingredient checklist): z-index 400 — intentionally above recipe modal so it appears on top when opened from recipe detail

## Add Ingredients Flow (from recipe detail)
- Shows ALL recipe ingredients with checkboxes unchecked — no pantry filtering
- User checks what they need to buy, then taps Add
- Quantities scale with `currentServings / recipe.servings`
- `_reviewingEventIngredients = false` routes confirmed items to the main grocery list (not an event list)

## Verification
- After multi-step changes (migrations, refactors, bulk edits), always run a verification step that checks the actual end state, not just that code executed without errors

## Grocery Section / Category System
- Categories and store sections are now **identical** (1-to-1 identity mapping via `CAT_TO_SECTION`). Do not add a separate "Store Section" concept — category IS the section.
- `SECTION_ORDER` drives the grocery list display order and is sorted by store aisle number from `Query1.csv` (the master aisle reference file at `C:\Users\chris\OneDrive\My Recipes\Query1.csv`)
- When adding new categories, they must exist in `Query1.csv` first. Add them to `SECTION_ORDER`, `STORE_SECTIONS`, `ITEM_CATEGORIES`, and `CAT_TO_SECTION` (identity) in that order.
- `sectionFromLibrary()` checks `match.category` first, then `storeSection`, then `section` as fallbacks — always keep this order.
- `renderGrocery()` falls back to `sectionFromLibrary()` when a grocery list item's stored section is unrecognized (handles stale data after category renames).

## Console Utilities (run in browser console)
- `fixLibrarySections()` — migrates all Firebase library items so their section matches their category (run after any bulk category rename)
- `fixItemCategories()` — applies the verified category corrections from the June 2026 audit session
- `importFromSpreadsheet()` — imports items from the hardcoded `CSV_ITEMS` array; skips items already in the library by display name match
- `exportItemLibraryCSV()` — available as the ⬇️ Export CSV button in the Item Library panel

## Outstanding Item Library Work (as of June 2026)
- **Missing items not yet imported**: AAA Batteries, Bird Seed, Charcoal, Fire Starter Sticks, Bathroom Night Light (Dog Supplies), LED Bulbs (Cat Supplies), Cooking Tins (Flour), Valentine's Day Cards (Stationary) — run `importFromSpreadsheet()` to add these
- **Category decisions still needed**: Apple Cider (Juice vs Fruit?), Frozen Meatballs (currently Canned Meats — wrong)
- **Duplicates to clean up**: Febreeze/Febreze, Swiffer/Swifter WetJet Pads, multiple tortilla entries, Tooth Brush/Toothbrush, and others flagged in the June 2026 audit

## Firebase Console Utilities — Scope Note
- Console utility functions (`fixLibrarySections`, `fixItemCategories`, etc.) must be defined **inside the ES module scope** where `db` is accessible, then exported via `window.functionName`. Defining them outside the module causes `ReferenceError: db is not defined`.
