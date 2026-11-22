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

## Event Planner — Shopping List (as of Sept 2026)
- Event items (`evt.items`) now carry a `sources` array instead of a frozen `qty` string, so quantities can rescale. Each recipe-linked source is `{ recipeId, recipeTitle, amount, unit, baseServings }` — `amount` is the ingredient amount at the recipe's *original* servings (`baseServings`), not pre-scaled. Manually-added items (via the search box) get `{ manual: true, qty }` instead.
- `computeEventItemQty(item, evt)` is the single source of truth for displaying an item's quantity — it looks up the recipe's *current* servings from `evt.recipes` and rescales each source live. Always route new "show qty" or "port to grocery" code through this function rather than reading `item.qty` directly, or rescaling will silently break again.
- Picking a recipe for an event (`assignRecipeToEvent`) opens `openEventRecipeChecklist(recipeId)`, which has a servings −/+ control (`#review-servings-row`, hidden in non-event checklists by `closeReviewDirect`). Changing it rescales the list live; tapping Add saves the chosen servings to `evt.recipes[i].servings`. The 🛒 button on each event recipe card reopens this checklist. The event checklist shows ALL ingredients — `PANTRY_STAPLES` matches are not hidden, just start unchecked with a "pantry?" label (hiding them dropped fresh herbs, garlic, butter, etc.). Clicking an event recipe title calls `openRecipe`.
- Changing an event recipe's servings (`updateEventRecipeServings`) only updates `evt.recipes[i].servings` — it does NOT touch `evt.items`. This is intentional; quantities are derived at render time, not stored pre-scaled.
- Removing a recipe from an event (`removeEventRecipe`) strips that recipe's `sources` entries from every item, then drops any item left with no sources and no legacy `qty`.
- Old events created before this change may still have items in the legacy flat shape (`{ qty, fromRecipe }`, no `sources`). `computeEventItemQty` falls back to `item.qty` for these — they just won't rescale until re-added via the recipe checklist.
- The event shopping list (`renderEventItems`) now mirrors the main grocery list: grouped/sorted by `SECTION_ORDER`, collapsible per section (tracked in its own `_collapsedEventSections` Set — separate from the main list's `_collapsedSections` so collapse state doesn't leak between the two), and supports per-item notes via `addNoteToEventItem` (same `.item-note`/`.note-btn` pattern as `addNoteToItem`).
- Event items also gained `checked` (bool), toggled via `toggleEventItem` — same visual pattern as the main grocery list's `.grocery-item.checked`, but on `.event-shop-row.checked` since event items don't share the `.grocery-item` class.

## Event Planner — Cooking Plan / Timeline (as of Nov 2026)
- Recipe-first, backwards planning: pick event recipes → plan each recipe's steps ("By Recipe" view) → the "Master Plan" view merges every step by day and flags overlaps.
- `evt.dinnerTime` ("HH:MM", default 16:30) and `evt.tasks[]`: `{ id, recipeId|null, recipeTitle, label, daysBefore, anchor: 'dinner'|'clock'|'anytime'|'before'|'after'|'window', minsBefore, clock, windowEnd, beforeTaskId, afterTaskId, durationMin, equipment, assignee, passive, note, done }`. `note` is free text shown under the step (incl. the helper page) and is carried into `recipe.prepPlan`. `recipeId: null` = "Other tasks" (errands, pick-ups).
- **Time windows** (`anchor: 'window'`): "sometime between `clock` and `windowEnd`" (e.g. farm pickup hours). `planTaskTimes` returns `{ start, end, window: true }` spanning the window; `findPlanConflicts` skips window steps since they can happen any time inside it. Duration is not used for windows.
- **Linked steps**: `anchor: 'before'` ends exactly when `beforeTaskId` starts; `anchor: 'after'` starts exactly when `afterTaskId` ends. Always get the target via `planLinkId(task)`. `planChainRank` is the sort tie-breaker so linked "anytime" steps list in chain order. With `before`, the step ends when its target starts, so changing a later step's duration (or dinner time) shifts the whole chain. `planTaskTimes` resolves chains recursively with a cycle guard; the step editor hides steps that already link to the one being edited. Deleting a step (or removing its recipe) runs `planDetachDependents` first, freezing linked steps at their current time via `planFreezeTiming`. In `recipe.prepPlan`, links are stored as `beforeIndex` / `afterIndex` (index within the plan) and remapped to new ids by `loadRecipePlan`.
- `planTaskTimes(task, evt)` is the single source of truth for when a task happens — 'dinner' tasks are stored as minutes-before-dinner so changing dinner time shifts them; offsets past midnight roll into earlier days. Never store computed clock times.
- `findPlanConflicts(evt)` flags (a) the same exclusive equipment overlapping (anything not in `PLAN_SHARED_EQUIPMENT` — counter/stove/fridge/car are shareable) and (b) the same person on two overlapping hands-on tasks (`passive` = hands-off, still reserves equipment). Blank assignee = the planner ("You").
- `recipe.prepPlan[]` is a reusable template (same shape minus id/recipeId/assignee/done). "Use saved plan" copies it into the event; "Save as recipe's plan" writes the event's steps back. Event edits do NOT auto-update the recipe — intentional.
- Helper links: `?plan=<eventId>&who=<Name>` opens `#helper-view` (full-screen overlay) showing only that person's tasks with checkboxes; live via the `eventsRef` listener. No auth — anyone with the link can view/check.
- "By Recipe" cards have a 📖 Recipe toggle (`togglePlanRecipe`, open ids in `_planRecipeOpen`) that shows `planRecipePanelHtml` beside the steps: ingredients scaled to the event servings, directions, notes. Each direction has "+ step" (`addPlanStepFromRecipe`) which opens the step editor pre-filled from that direction.
- "By Recipe" cards collapse (`togglePlanCard`) to a one-line summary (step count, day range, done count, ⚠️ overlaps). State is per-device in localStorage `planCollapsed:<eventId>` (key 'other' = Other tasks). Master Plan never hides steps. The event Shopping List section also collapses (`toggleEventShoppingList`, key '__shopping' in the same set); `renderEventItems` applies the `.collapsed` class.
- `removeEventRecipe` confirms and removes that recipe's plan steps.
- `deleteCurrentEvent` must NOT call `backToEventList()` — that re-saves name/date and recreates a ghost event node (no id). This caused an orphan "Labor Day Weekend" in prod.

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
