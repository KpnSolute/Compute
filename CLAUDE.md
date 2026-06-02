# CLAUDE.md — MJCC Project Instructions

Full-stack management system for Jeremiah's Custom Creations, featuring a React frontend and FastAPI backend. **This file is interconnected with GEMINI.md; they share the same memory and agent delegation logic.**

## Build & Run Commands
- **Frontend Setup:** `cd frontend && npm install`
- **Frontend Dev:** `npm run dev` (Vite, default port 5173)
- **Backend Setup:** `cd backend && pip install -r requirements.txt`
- **Backend Dev:** `python main.py` (FastAPI, default port 8000)
- **Linting/Formatting:** `ruff check backend/` and `ruff format backend/`

## Tech Stack
- **Frontend:** Vite, React, TypeScript, Tailwind CSS.
- **Backend:** FastAPI (Python).
- **Database:** Supabase (PostgreSQL).
- **Assets:** `/templates` directory for UI patterns and core assets.

## Project Structure & Pillars
- **`/frontend`**: React application shell and components.
- **`/backend`**: API routes, models, and Supabase integration.
- **`/data`**: Persistence layer for records and inventory.
- **`/templates`**: **MANDATORY.** Read assets here (e.g., `inventory.html`) before making UI changes.

## Coding Conventions

### Backend (Python/FastAPI)
- **Style:** Ruff (Single quotes, 120-char limit).
- **Imports:** Absolute imports from `backend`.
- **Security:** Tokens loaded from the root `.env`.

### Frontend (React)
- **Patterns:** Use functional components, TypeScript interfaces for props, and Tailwind for all styling.
- **Interconnection:** Ensure API calls match the FastAPI endpoints defined in `backend/main.py`.

## Git & Alignment
- **Versioning:** Use incrementing "Update X.X.X" messages (e.g., `Update 1.0.1`) for general updates.
- **Alignment:** All 12 agents in `.claude/agents/` are configured to operate across this specific React/FastAPI architecture.
- **Asset Awareness:** Agents are required to consult `/templates/` first for any UI-related tasks.
