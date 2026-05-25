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

- **Platform:** Azure App Service (Linux, Docker)
- **Container Registry:** Azure Container Registry (ACR) — `mjccacr.azurecr.io`
- **CI/CD:** GitHub Actions (push to `main` → build image → push to ACR → deploy)
- **Server:** Gunicorn (4 workers, port 5000)
- **Base image:** `python:3.12-slim`
- **Region:** `westus2` (closest to Supabase `us-west-1`)
- See `structure/DEPLOYMENT.md` for full setup guide

## Key Packages

- flask, flask-cors, flask-limiter
- supabase (Python SDK)
- ollamafreeapi
- python-dotenv
- gunicorn
- pytest, ruff (dev)
