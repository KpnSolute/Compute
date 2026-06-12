---
name: mjcc-ruff
description: >-
  How to run Ruff lint and format on the MJCC Python backend. Includes
  the project's style rules, common fixes, and the verify-before-push
  command sequence.
metadata:
  version: "1.0.0"
---

# MJCC — Ruff (Python Backend Linting)

Ruff is the only linter/formatter for the Python backend. No Black, no Flake8 — just Ruff.

---

## Commands

```bash
# Check for issues (read-only)
ruff check backend/

# Auto-fix fixable issues
ruff check --fix backend/

# Format (write)
ruff format backend/

# Both in one shot (fix then format)
ruff check --fix backend/ && ruff format backend/
```

Run from the **project root** (not `cd backend/`), so paths resolve correctly.

---

## Style Rules (project standard)

| Rule | Value |
|---|---|
| Quotes | **Single quotes** (`'like this'`) |
| Line length | **120 characters** |
| Import style | **Absolute** from `backend.*` — never relative (`from .routes import...`) |
| Unused imports | Remove them — Ruff F401 will flag |
| Unused variables | Remove or prefix with `_` |

---

## Before Every Push

```bash
ruff check backend/ && ruff format backend/
```

Both must pass cleanly. If Ruff reports errors that aren't auto-fixable, fix them manually — do not skip.

---

## Common Issues and Fixes

### F401 — unused import
```python
# Bad
from backend.routes import inventory  # never used

# Fix: delete the import
```

### E501 — line too long (> 120 chars)
```python
# Bad — 145 chars
result = supabase.table('monthly_inventory').select('*').eq('item_id', item_id).eq('month', month).eq('year', year).execute()

# Fix: break into variable or use a helper
q = supabase.table('monthly_inventory').select('*')
result = q.eq('item_id', item_id).eq('month', month).eq('year', year).execute()
```

### E711 — comparison to None
```python
# Bad
if result.data == None:

# Fix
if result.data is None:
```

### Import ordering (I001)
```python
# Correct order: stdlib → third-party → local (backend.*)
import json
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException

from backend.auth import get_current_user
from backend.database import get_supabase_client
```

---

## Backend File Map

```
backend/
├── main.py              # app wiring, CORS, router registration
├── routes/
│   ├── inventory.py
│   ├── staging.py
│   ├── commits.py
│   ├── auth.py
│   ├── users.py
│   ├── menu.py
│   ├── events.py
│   ├── logs.py
│   └── data_entry.py
├── staging/
│   └── dispatch.py      # REGISTRY of all dispatch handlers
├── ai/
│   ├── extractor.py     # AI file parsing (Groq / Ollama)
│   └── providers.py     # model routing
├── inventory_identity.py # SKU resolve/upsert
└── seed_data.py
```

---

## Ruff Config Location

Ruff config lives in `pyproject.toml` at the project root (or `ruff.toml` if present). If absent, the defaults above apply. Do not add a separate `.ruff.toml` in `backend/`.
