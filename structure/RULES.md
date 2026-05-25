# Project Rules

## Code Style

- No inline comments unless absolutely necessary
- Follow existing patterns in the codebase
- Flask Blueprints for route organization

## Architecture

- Keep backend logic in Python modules (`backend/calculators.py`, etc.)
- Keep frontend as HTML presentation layer
- Avoid adding new JavaScript frameworks/libraries
- AI provider is OllamaFreeAPI (model selection via `AI_MODEL` env var)

## Database

- All schema changes tracked in `structure/MIGRATIONS.md`
- Use Supabase migrations for DDL changes
- Never hardcode generated IDs in migrations

## Process

- Document every change in `structure/DIARY.md`
- Every fix or change MUST be logged in `DIARY.md` with what was fixed and why
- Keep `structure/` as single source of project planning
- Run `ruff check .` before committing
- Run `pytest` before merging
- Run `npm run format` to format HTML/CSS/JS
- Before starting the website for testing, kill any existing Flask/gunicorn processes on port 5000:

## Tooling Commands

- `bash run.sh` or `npm start` — start the API + website (kills port 5000 first)
- `pytest` — run all tests
- `ruff check .` — lint Python
- `ruff format .` — format Python
- `npm run format` — format HTML/CSS/JS/JSON/MD with Prettier
- `npm run format:check` — check formatting without writing

## Versioning

- Versions increment sequentially: 1.0.0 → 1.0.1 → 1.0.2 → 1.0.3 → 1.0.4
- Always check `git log --oneline` and `git tag -l` before picking the next version
- Tag every release with `git tag <version>` and push tags with `--follow-tags`
