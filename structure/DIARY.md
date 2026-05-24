# Change Diary

## 2026-05-23 — v1.0.4 — Structure replan + AI providers
- Created `structure/` folder to centralize project planning
- Refactored `ai_parser.py` to support Gemini + Groq dual provider
- Removed `architect/` directory (docs consolidated into `structure/`)
- Added `groq` to requirements
- Updated `.env` with `GROQ_API_KEY`, `AI_PROVIDER` config
- Added `.gitignore` for `__pycache__/`, `*.pyc`, `venv/`, `.env`
- Added versioning rules to `structure/RULES.md`
- Corrected tag from 1.0.3 → 1.0.4 (incremental order)
