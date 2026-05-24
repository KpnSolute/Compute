# Project Rules

## Code Style
- No inline comments unless absolutely necessary
- Follow existing patterns in the codebase
- Flask Blueprints for route organization

## Architecture
- Keep backend logic in Python modules (`backend/calculators.py`, etc.)
- Keep frontend as HTML presentation layer
- Avoid adding new JavaScript frameworks/libraries
- AI provider selection via environment variable (`AI_PROVIDER`)

## Database
- All schema changes tracked in `structure/MIGRATIONS.md`
- Use Supabase migrations for DDL changes
- Never hardcode generated IDs in migrations

## Process
- Document every change in `structure/DIARY.md`
- Keep `structure/` as single source of project planning
- Run lint/typecheck before committing (once configured)
- No tests → no merges (once CI is set up)

## Versioning
- Versions increment sequentially: 1.0.0 → 1.0.1 → 1.0.2 → 1.0.3 → 1.0.4
- Always check `git log --oneline` and `git tag -l` before picking the next version
- Tag every release with `git tag <version>` and push tags with `--follow-tags`
