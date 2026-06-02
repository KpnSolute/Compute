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

### AI Interaction Rules
- **Mandatory Check-in:** Every AI agent must verify project alignment and check for loggable changes with every prompt.
- **Automated Logging:** All design and structural changes MUST be logged in `CHANGELOG.md` via the `change-logger` agent.
- **End-of-Day Summary:** At the conclusion of a session, a system-wide "Close Out" must be recorded in `CHANGELOG.md`.
- **Git Operations:** The `git-operator` agent handles all pushes using Gemini CLI tools and project memory to maintain versioning.

## Workflows

### Build & Run
- **Frontend Dev:** `cd frontend && npm run dev`
- **Backend Dev:** `cd backend && pip install -r requirements.txt && python main.py`
- **Tokens:** All security tokens are stored in the root `.env` file and must never be committed.

### Git & Releases
- **Commits:** Clear, descriptive messages.
- **Branches:** Use feature branches for significant changes.
- **Tags:** Version tags (e.g., `1.0.0`) mark releases.
