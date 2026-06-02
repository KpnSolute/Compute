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

## Specialist Partnership
- **Claude (Builder/Problem Solver):** In charge of **Frontend & API**. Implements React components and API routes.
- **Gemini (Data/Research Lead):** In charge of **DATA handling and core backend logic**. Claude relies on Gemini for crucial information and data structures.
- **Shared Mandate:** Both agents must read everything in `@templates/**` before making changes.

## Project Structure & Pillars
- **`/frontend`**: React application shell and components (Claude Lead).
- **`/backend`**: API routes (Claude) and core logic/Supabase services (Gemini Lead).
- **`/data`**: Persistence layer and record handling (Gemini Lead).
- **`/templates`**: **MANDATORY.** Mandatory reading for both agents to maintain design consistency.

## Coding Conventions

### Backend (Python/FastAPI)
- **Style:** Ruff (Single quotes, 120-char limit).
- **Imports:** Absolute imports from `backend`.
- **Security:** Tokens loaded from the root `.env`.

### Frontend (React)
- **Patterns:** Use functional components, TypeScript interfaces for props, and Tailwind for all styling.
- **Interconnection:** Ensure API calls match the FastAPI endpoints defined in `backend/main.py`.

## AI Agent Protocols
- **Check-in Requirement:** Agents must check in on every prompt to verify alignment and identify loggable changes.
- **Continuous Logging:** All changes (Design/System) must be recorded in `CHANGELOG.md`.
- **Close Out:** Each session must end with a comprehensive summary in `CHANGELOG.md` of all key updates.
- **Git Operations:** Changes are pushed via `Github` using Gemini CLI and project memory.
