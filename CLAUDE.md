# MJCC — Jeremiah's Custom Creations Inventory System

Full-stack inventory management: Flask backend + Supabase + Alpine.js frontend.

## Critical Field-Name Conventions

**`dashboard_summary` view columns — always use these names:**

| Use This                    | Not This                      |
| --------------------------- | ----------------------------- |
| `item.item_id`              | `item.id`                     |
| `item.category`             | `item.category_name`          |
| `item.par_level`            | `item.reorder_point`          |
| `item.w1_received`          | `item.week1_received`         |
| `item.w1_issued`            | `item.week1_issued`           |
| `summary.total_items`       | `summary.item_count`          |
| ``summary[`wk${w}_total`]`` | ``summary[`week${w}_total`]`` |

No `ending_qty` column exists — compute: `Math.max(0, on_hand + Σ(received - issued))`

## Alpine.js

- `:key="item.item_id"` — NOT `item.id` (crashes Alpine with `.after` error)
- Category dropdown: `<option :value="cat.name">` — items have `category` as name string
- Diff modal variables (`diffModalOpen`, `diffData`, `diffLoading`) live in `inventoryPage()`
- Month: 0-indexed (Jan=0, May=4)

## Files Endpoint

`GET /api/files` returns 501 — skip in `files.js`

## Build / Deploy

- `npm run format` (prettier), Pre-commit: ruff + prettier
- Git: version tags (`1.4.0`), push to `main`
