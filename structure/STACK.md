# Tech Stack

## Backend

- **Language:** Python 3.12
- **Framework:** Flask (with Blueprints)
- **Database:** Supabase (PostgreSQL)
- **Auth:** Supabase Auth + Flask sessions + PIN-based staff login
- **Rate Limiting:** Flask-Limiter
- **AI:** OllamaFreeAPI (default, free) or Groq (set `AI_PROVIDER=groq` + `GROQ_API_KEY`)

## Frontend

- Vanilla HTML/CSS/JS (SPA)
- No framework — pure client-side JS
- **Formatting:** Prettier (HTML, CSS, JS, JSON, MD)

## Tooling

- **Testing:** pytest
- **Linting:** ruff (select: E, F, I, N, W)
- **Formatting (Python):** ruff
- **Formatting (HTML/CSS/JS):** Prettier

## Deployment

- Gunicorn (4 workers)
- Docker (python:3.12-slim)
- Replit-compatible

## Key Packages

- flask, flask-cors, flask-limiter
- supabase (Python SDK)
- ollamafreeapi
- python-dotenv
- gunicorn
- pytest, ruff (dev)
