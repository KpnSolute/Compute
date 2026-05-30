---
name: mjcc-ui-conventions
description: >-
  MJCC frontend field-name conventions — Alpine.js components, DB view column
  names, summary API keys, and common pitfalls. Load when working on any HTML
  template, JS page component, or frontend fix that touches inventory data.
---

# MJCC UI Conventions

## DB View → Frontend Field Mapping

`dashboard_summary` view columns for `GET /api/inventory/items` and
`GET /api/inventory/summary`:

| View Column   | Frontend Accessor  | ❌ Wrong              |
| ------------- | ------------------ | --------------------- |
| `item_id`     | `item.item_id`     | `item.id`             |
| `category`    | `item.category`    | `item.category_name`  |
| `par_level`   | `item.par_level`   | `item.reorder_point`  |
| `w1_received` | `item.w1_received` | `item.week1_received` |
| `w2_received` | `item.w2_received` | `item.week2_received` |
| `w3_received` | `item.w3_received` | `item.week3_received` |
| `w4_received` | `item.w4_received` | `item.week4_received` |
| `w1_issued`   | `item.w1_issued`   | `item.week1_issued`   |
| `w2_issued`   | `item.w2_issued`   | `item.week2_issued`   |
| `w3_issued`   | `item.w3_issued`   | `item.week3_issued`   |
| `w4_issued`   | `item.w4_issued`   | `item.week4_issued`   |

There is **no** `w{w}_ending_qty` column — compute from `on_hand + Σ(rec - iss)` with `Math.max(0, qty)`.

## Summary API Response Keys

`GET /api/inventory/summary?month=&year=` returns:

| Response Key    | Accessor                    | ❌ Wrong                      |
| --------------- | --------------------------- | ----------------------------- |
| `total_items`   | `summary.total_items`       | `summary.item_count`          |
| `wk1_total`     | ``summary[`wk${w}_total`]`` | ``summary[`week${w}_total`]`` |
| `reorder_count` | `summary.reorder_count`     | —                             |

## Alpine.js Patterns

### x-for keys

Always `:key="item.item_id"` for dashboard_summary data.
❌ Never `item.id` — Alpine crashes with `.after` error.

### Inline editing

- `startEdit(item, field, week)` → `editingCell = { id: item.item_id, field, week }`
- `isEditing(item.item_id, field, week)` — checks if cell active
- `cellStatus(item.item_id, field, week)` — saving/saved/error state
- `saveEdit(item, field, week)` → `API.updateItem(item.item_id, {field, value, month, year})`

### Category dropdown

Uses `inventory_categories` table (`id`, `name`). Items have `category` as name string.

```html
<option :value="cat.name" x-text="cat.name"></option>
```

```js
filter((i) => i.category === this.selCategory);
```

### Diff modal

The diff modal HTML lives in the inventory section. `inventoryPage()` must include:

```js
diffModalOpen: false, diffData: null, diffLoading: false,
async openDiff(commit) { ... },
closeDiff() { ... }
```

## Summary Route Timeout

The summary endpoint wraps computation in `ThreadPoolExecutor` (25s timeout).
On timeout it returns partial data with `data_source: 'LIVE_SUPABASE_PARTIAL'`.

## Files Endpoint

`GET /api/files` returns 501 (stub). `files.js` should skip the call.

## Month Numbering

0-indexed: January=0, May=4, December=11. Matches JS `new Date().getMonth()`.
