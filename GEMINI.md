# GEMINI.md — MJCC Project Instructions

This file contains team-shared architecture, conventions, and workflows for the Miami Job Corps Cafeteria (MJCC) Management system. **This file is interconnected with CLAUDE.md; they share the same memory and agent delegation logic.**

## Project Structure
The project is organized into four primary root-level pillars:
- **`/frontend`**: Modern Vite + React (TypeScript) + Tailwind CSS application.
- **`/backend`**: FastAPI (Python) server-side logic.
- **`/data`**: Persistent data storage and inventory records.
- **`/templates`**: **MANDATORY READING.** Contains core UI templates (e.g., `inventory.html`) and assets. Agents must read relevant templates here before proposing or implementing UI changes.

## Core Conventions

### Frontend (React/TypeScript)
- **Framework:** Vite + React + TypeScript.
- **Styling:** Tailwind CSS.
- **Components:** Functional components with Hooks.
- **State Management:** React Context or localized state (expand as needed).

### Backend (FastAPI/Python)
- **Framework:** FastAPI.
- **Style:** Ruff for linting and formatting (Single quotes, 120-char limit).
- **Database:** Supabase (PostgreSQL) via `backend/requirements.txt` dependencies.
- **Client:** Access Supabase using the `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` from the root `.env`.

### Unified AI Guidance
- **Shared Context:** All AI agents (Gemini and Claude) operate under the same architectural rules defined here and in `CLAUDE.md`.
- **Memory Tiering:** Project-wide facts live here. Local/private notes belong in the private memory folder. Global preferences in the global personal memory.
- **Asset Primacy:** Always check the `/templates` directory for established UI patterns and assets before creating new ones.

## Workflows

### Build & Run
- **Frontend Dev:** `cd frontend && npm run dev`
- **Backend Dev:** `cd backend && pip install -r requirements.txt && python main.py`
- **Tokens:** All security tokens are stored in the root `.env` file and must never be committed.

### Git & Releases
- **Commits:** Clear, descriptive messages.
- **Branches:** Use feature branches for significant changes.
- **Tags:** Version tags (e.g., `1.0.0`) mark releases.
