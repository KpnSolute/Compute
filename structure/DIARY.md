# Change Diary

## 2026-05-23 — v1.0.4 — Structure replan + AI providers + Tooling
- Created `structure/` folder to centralize project planning
- Refactored `ai_parser.py` to support Gemini + Groq dual provider
- Removed `architect/` directory (docs consolidated into `structure/`)
- Added `groq` to requirements
- Updated `.env` with `GROQ_API_KEY`, `AI_PROVIDER` config
- Added `.gitignore` for `__pycache__/`, `*.pyc`, `venv/`, `.env`, `node_modules/`
- Added versioning rules to `structure/RULES.md`
- Corrected tag from 1.0.3 → 1.0.4 (incremental order)
- Added **pytest** + `tests/` with initial calculator/validation tests
- Added **ruff** with config in `pyproject.toml`
- Added **Prettier** with `.prettierrc` + npm scripts
- Updated `STACK.md` and `RULES.md` with tooling docs
- Fixed missing `groq` dependency in venv
- Created `run.sh` as single entry script (kills port 5000, activates venv, starts server)
- Updated `npm start` to use `run.sh`
- Replaced Gemini + Groq with OllamaFreeAPI (`ai_parser.py`, requirements, .env)
- Removed image parsing support (OllamaFreeAPI is text-only)
- Cleaned up `.env` — removed GEMINI_API_KEY, GROQ_API_KEY, AI_PROVIDER; added AI_MODEL
