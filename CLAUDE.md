# Chrissy's Recipes — Claude Guidelines

## Firebase
- After any Firestore schema/data migration, verify document counts and query a sample before declaring success
- Firestore security rules must explicitly allow any metadata paths (e.g., _appMeta) or they will trigger permission warnings on load

## JavaScript Gotchas
- Watch for temporal dead zone issues with `let`/`const` when variables are referenced before initialization, especially with module-level `db` or config objects

## Verification
- After multi-step changes (migrations, refactors, bulk edits), always run a verification step that checks the actual end state, not just that code executed without errors
