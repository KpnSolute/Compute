# MJCC API Patterns

## Architecture

FastAPI backend (port 8000) talks to Supabase PostgreSQL directly via `supabase` Python client. All routes are in `backend/routes/` as modular `APIRouter` instances registered in `backend/main.py`.

```
Frontend (React) → api.ts → HTTP → FastAPI route → supabase client → PostgreSQL
                                    ↑
                             services.ts (cache layer)
```

## Adding a New Endpoint

Copy the pattern from `backend/routes/data.py`:

1. Create or edit a file in `backend/routes/` with:
```python
from fastapi import APIRouter, HTTPException, Depends, Header
from backend.routes import supabase

router = APIRouter(prefix='/api', tags=['mytag'])

async def _get_auth_user(authorization: str = Header('')) -> dict:
    # Copy verbatim from data.py lines 16-62
    ...

@router.get('/my-resource')
async def get_resource(auth_user: dict = Depends(_get_auth_user)):
    try:
        result = supabase.table('my_table').select('*').order('name').execute()
        return result.data if result.data else []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
```

2. Register the router in `backend/main.py`:
```python
from backend.routes.myfile import router as my_router
app.include_router(my_router)
```

3. Add the method in `frontend/src/lib/api.ts`:
```typescript
async getMyResource(): Promise<any[]> {
  return req('/api/my-resource');
},
```

4. Wire through `frontend/src/lib/services.ts` for caching:
```typescript
async myResource() {
  return populate('myResource', () => api.getMyResource());
},
syncMyResource() {
  return cached<any[]>('myResource', []);
},
```

## Response Conventions

- DB column names (`snake_case`) are returned **as-is** from Supabase
- No automatic camelCase conversion — frontend handles field access
- Errors return `HTTPException` with `status_code` and `detail` string
- Empty results return `[]` or `{}` (never `null`)
- POST creates return `201` status code

## Error Handling Pattern

```python
try:
    result = supabase.table(...).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail='Not found')
    return result.data
except HTTPException:
    raise
except Exception as e:
    raise HTTPException(status_code=500, detail=str(e))
```

## Route Files & Tables

| File | Prefix | Key Tables |
|------|--------|------------|
| `auth.py` | `/api/auth` | `user_profiles` |
| `users.py` | `/api/users` | `user_profiles` |
| `inventory.py` | `/api/inventory` | `monthly_inventory`, `inventory_items`, `inventory_categories`, `live_inventory` |
| `menu.py` | `/api/menu` | `menu_entries`, `menu_cycles` |
| `events.py` | `/api/events` | `events` |
| `logs.py` | `/api/logs` | `haccp_logs`, `daily_logs`, `compliance_logs` |
| `sourcectrl.py` | `/api` (staging/commits) | `staging_entries`, `commits` |
| `github_sync.py` | `/api/github-sync` | GitHub API + Supabase sync |
| `data.py` | `/api` | `opening_checklist_items`, `servsafe_certifications`, `meal_periods`, `incident_logs`, `invoices`, `invoice_items`, `inventory_categories`, `monthly_snapshots` |

## Key Supabase Tables

| Table | Purpose |
|-------|---------|
| `user_profiles` | Users, roles, auth |
| `inventory_items` | Master item catalog (sku, description, par_level, category_id) |
| `inventory_categories` | Category labels, colors, sort_order |
| `monthly_inventory` | Per-month snapshots (on_hand, weekly received/issued) |
| `live_inventory` | View joining items + latest monthly data |
| `menu_cycles` | Named cycles (active boolean) |
| `menu_entries` | Day × meal_type × items for a cycle |
| `events` | Calendar events (cultural, special, training, heals) |
| `haccp_logs` | Temperature & safety logs |
| `daily_logs` | Generic daily entries (type via entry_type column) |
| `staging_entries` | Pending changes awaiting commit approval |
| `commits` | Approved batch changes |
| `opening_checklist_items` | Daily opening checklist tasks |
| `servsafe_certifications` | Staff food safety certs |
| `meal_periods` | Meal time windows (label, open_hour, close_hour, rate) |
| `incident_logs` | Safety/behavior/medical incidents |
| `invoices` | Vendor invoices (month, year, vendor_id, total) |
| `invoice_items` | Line items per invoice |
| `monthly_snapshots` | Archived inventory snapshots from GitHub |
| `vendors` | Vendor names/contacts |

## Caching in services.ts

`services.ts` wraps every API call with a TTL cache (30s default):

```typescript
const cache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 30000;

function cached<T>(key: string, defaultVal: T): T { ... }
async function populate<T>(key: string, fetcher: () => Promise<T>): Promise<T> { ... }
```

- `populate(key, fetcher)` — async fetch + cache write
- `cached(key, default)` — sync read from cache (returns default if expired/missing)
- Use `sync*()` methods after the async method has been awaited to get cached data synchronously in render
