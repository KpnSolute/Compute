# MJCC Inventory Refactor — SKU as the Item Primary Identity + New-Items Review + Weekly Input

**Author:** Claude (Senior Development Manager)
**Date:** 2026-06-09
**Location rationale:** lives in `.claude/plans/` (NOT a root `.md` → respects `AGENTS.md` §0 rule 2).
**Spelling note:** the user wrote "skew" — this means **SKU** (Stock Keeping Unit). Used interchangeably below.
**Status:** PLAN ONLY. No code/schema changed yet. Awaiting the "Decisions needed" answers (§9) before build.

---

## 0. The ask (verbatim intent)

1. **SKU becomes the item's primary id** for the inventory system.
2. **Data entry → unrecognized SKU** lands in a special **"New Items"** category so the **manager** can **edit / reassign / delete** it (and *any* item should be editable). This is a **Source Control** visibility requirement: "I need the manager to know what's being added to the inventory."
3. **Weekly input model:** the admin uploads **that week's invoice by the end of the week**. (Actual **invoice-parsing logic is explicitly deferred to tomorrow** — this plan builds the plumbing, not the parser hardening.)
4. Analyze where Codex left off (Supabase / API / frontend), test with TestSprite, plan with sequential-thinking, build with parallel agents + wise MCP use.

---

## 1. Ground truth (verified live, this session — do not re-assume)

**Supabase `MJCCv1` (`mgvyylvmkxhhataavqjz`), `inventory_items`:**

| Fact | Value | Implication |
|---|---|---|
| Physical PK | `id` uuid | Referenced by `monthly_inventory.item_id`, FKs, source-control `commit_changes`. Do **not** drop. |
| `sku` | `text`, **nullable, NO unique constraint** | This is the bug surface. |
| `barcode_id` | `text`, **UNIQUE** | Only existing business-unique key today. |
| Total rows | **1591** | |
| Null/blank `sku` | **1361 (85%)** | Must be backfilled before NOT NULL/UNIQUE. |
| Distinct non-blank `sku` | **230, 0 duplicate groups** | Existing SKUs are already clean/unique. |
| Blank-sku rows w/ `monthly_inventory` data | **413** | The "real" blank ones; the other **948 are orphan seed rows**. |
| `active = false` | **1331 of 1591** | True working set ≈ **260 active items** (matches v1.8.0 "live = 260"). |
| Categories | **9**, NO "New Items" | Must create the bucket. |
| Constraints | `pkey(id)`, `unique(barcode_id)`, FKs to categories/vendors | No `unique(sku)`. |

**The live blocker (CHANGELOG v1.8.5, re-confirmed):** every `POST /api/inventory` returns **500** because `save_inventory`/`dispatch_inventory_save` call `upsert(..., on_conflict="sku")` but there is **no UNIQUE(sku)**. This refactor *is* the fix.

**TestSprite:** account active (Free, **140 credits**). Prior cycle artifacts exist in `testsprite_tests/` (TC001–TC010; TC009 = the inventory-save 500).

---

## 2. Where Codex / prior work left off

- **Backend item-identity is triplicated and divergent** — three sites each do `SKU → description+category → insert`:
  - `backend/ai/diff.py` `_diff_inventory_item()` (~L29-66) — preview/diff.
  - `backend/staging/dispatch.py` `dispatch_inventory_save()` (L47-66) — commit/replay.
  - `backend/routes/inventory.py` `save_inventory()` (L322-342) — direct POST.
  - The `desc+category` fallback **silently merges distinct items** and is the source of drift. Unify it.
- **SKU generation already exists** (`backend/ai/mapper.py` L175 `_gen_sku` → `CAT-NNN`; `ai/context.py` tells the AI to generate `CAT-NNN`) — but **no dedup and no "unknown item" routing**. Unrecognized rows are inserted straight to a *guessed* category, invisible to the manager.
- **Frontend already keys on SKU** — `entity_id = sku` in `api.stageChange`; rows keyed by `sku` in `Portal.tsx` InventoryView and `Operations.tsx`. Minimal churn there. **Categories are derived from items** (`[...new Set(rows.map(cat))]`) instead of the live `getInventoryCategories()` API (which exists but is **unused**).
- **Add-item modal** shipped (v1.8.4, `Portal.tsx`) → stages `inventory_save`. **No edit / delete / reassign** UI yet.
- **No "New Items" surface** anywhere (frontend or DB).
- Existing `.claude/plans/*` are older general audits (Grok re-audit, debugger CORS/auth smoke) — not this refactor.

---

## 3. Central architectural decision

**Keep `id` (uuid) as the physical PK; promote `sku` to the NOT-NULL UNIQUE business key and make it THE lookup/upsert/contract key everywhere.**

Why not repoint every FK to `sku`: `monthly_inventory` (21,089 rows), `commit_changes` (5,460), invoices, snapshots all reference `item_id` uuid. A true PK swap is high-risk for zero functional gain — the user's intent ("SKU is the primary id") is satisfied at the **app + API contract** level by making `sku` mandatory, unique, and the sole identity key. (This is **Decision #1** to confirm in §9.)

---

## 4. Phase 1 — Data migration (Track DB · Supabase MCP `apply_migration`)

Each step is its **own** migration (tracked in `list_migrations`, reversible). Snapshot counts before/after.

1. **Create "New Items" category** — `inventory_categories` row, `sort_order = 99`, distinct color (e.g. amber `#f59e0b`), icon. Must exist before any fallback write.
2. **Dry-run uniqueness proof (SELECT, no write):** confirm the proposed backfill `MJC-` + `upper(left(id::text without dashes, 8))` produces **0 collisions** against the 230 existing SKUs and within itself.
3. **Backfill** `sku` for all NULL/blank using that deterministic synthetic value (derived from `id` → guaranteed unique, stable, reproducible).
4. **Normalize** existing: `btrim(sku)`; assert no blank remains.
5. **Constrain:** `ALTER COLUMN sku SET NOT NULL` then `ADD CONSTRAINT inventory_items_sku_key UNIQUE (sku)`. This legalizes `on_conflict="sku"` and unblocks the v1.8.5 500.
6. **Advisors:** run `get_advisors` (security + performance) post-migration.
7. **Orphan handling — SEPARATE, gated (Decision #3):** the **948** inactive blank-sku rows with no monthly data are seed cruft. Flag for review; **do NOT delete in this migration**.

**Gate → Test T1 (§7) must be green before Phase 2 deploys.**

---

## 5. Phase 2 — Backend refactor (Track API · `backend/`, data-lane execution)

1. **One shared resolver** `resolve_or_create_item(sku, desc, category_id, fields)` replacing the three divergent blocks in `diff.py`, `dispatch.py`, `inventory.py`:
   - Match by **SKU only** (drop the `desc+category` fuzzy fallback that merged items).
   - Inbound **missing sku** → generate `MJC-<...>` server-side (single canonical generator; retire `CAT-NNN` divergence).
   - Inbound **unknown sku** → INSERT into the **"New Items"** category (never a guessed/default category), `active = true`, so the manager must review provenance.
2. **Switch to upsert on `sku`** in `save_inventory` + `dispatch_inventory_save` (now legal) — removes the SELECT-then-update dance and the 500. **Guard** the latent `par < 0` TypeError when `par is None` (v1.8.5 yellow).
3. **New staged ops for "edit any item":** `item_update` (description, **category reassign**, price, par, unit, active) and `item_delete` (**soft** = `active=false` by default — Decision #4). Register both in `dispatch.py` `REGISTRY`; add request models + routes (Claude reviews contract shape).
4. **Honest preview:** `ai/diff.py` labels unmatched rows as destined for **"New Items"** so the manager preview reflects reality.
5. **Week targeting (Phase 3 plumbing):** thread an optional `week` (1–4) param through upload → `data_entry` → `diff` → `dispatch` so received qty lands in `w{N}_received` (not just w1).

**Gate → Tests T2 + T3 (§7).** Backend code may be **written in parallel** with Phase 1 (it doesn't execute until the migration lands).

---

## 6. Phase 3 — Weekly input model + Phase 4 — Frontend (Track UI · Claude lane)

**Weekly data structure (user-confirmed 2026-06-09): each item, each week = `Received | Exported`.** "Exported" is the business term for what leaves inventory (today's `w{N}_issued` column). DB column names stay (`w{N}_received` / `w{N}_issued` — renaming 21k rows is needless risk); the **API/UI contract surfaces them as Received / Exported**. Net value = `max(0, onHand + ΣReceived − ΣExported) × price`.

**Weekly model:** the monthly schema *already* encodes 4 weeks (`w1..w4_received/issued`). "Weekly invoice upload" = admin **picks the active week W1–W4** (Decision #5) and parsed/entered **Received** quantities route into `w{N}_received`; **Exported** into `w{N}_issued`. **Invoice parsing itself stays a documented follow-up (user: "we will work on invoice parsing tmr").** This phase builds only the week-targeting entry point + New-Items routing.

**Frontend changes:**
1. **Categories from the API:** replace item-derived category lists in `Portal.tsx` / `Operations.tsx` with `api.getInventoryCategories()` (already exists, unused) so **"New Items" always renders** (even empty) and the reassign dropdown is authoritative.
2. **New Items review surface:** a visually-flagged section/category in InventoryView + a **count badge** on the nav, listing what data-entry added → edit / reassign / delete from there.
3. **Edit-any-item modal:** extend the existing add-item modal pattern (`Portal.tsx`) — Description, **Category (reassign)**, SKU (read-only or edit-with-warning), price, par, unit, **Delete**. Wired to `item_update` / `item_delete` via `api.stageChange`. Works for **any** item.
4. **SourceControl readability:** add `item_update` / `item_delete` summaries to `opPayloadSummary` so the approval queue is legible.
5. **DataEntry:** show the "→ New Items" destination for unmatched rows; add the **W1–W4** target selector on upload.

**Gate → Test T4 (§7).** UI may be written in parallel with backend once the contract shape is fixed (Claude owns the contract).

---

## 7. Testing phases (gates — each must pass before the next)

| ID | Phase | Tooling | Pass criteria |
|---|---|---|---|
| **T0** | Baseline (before any change) | **TestSprite MCP** (re-run inventory backend cycle) + **Supabase MCP** snapshot | Re-confirm TC009 500 + auth guardrails; record live counts (1591/1361/260/9). Diff vs `testsprite_tests/` artifact. |
| **T1** | Post-migration DB | **Supabase MCP** `execute_sql` + `list_migrations` + `get_advisors` | 0 null/blank sku; `unique(sku)` in `pg_constraint`; "New Items" exists; `monthly_inventory` FK intact; row counts unchanged; migrations reversible. |
| **T2** | Backend unit/contract | `pytest tests/` (venv) | `resolve_or_create_item`: known sku→update, unknown→New Items, missing→generated. `save_inventory` no longer 500s. `par=None` guarded. |
| **T3** | Backend integration | **TestSprite MCP** (`generate_backend_test_plan` scoped to inventory + new ops → `generate_code_and_execute`), prod-mirroring reverse proxy as in v1.8.5 | **TC009 GREEN**; overall ≥ prior 8/10; new-item routing verified. |
| **T4** | Frontend | `tsc --noEmit` + `npm run build` + `npm run lint`; **chrome-devtools MCP** | Build clean; lint no new errors over ~290 baseline; New Items renders; edit/reassign/delete stage with correct `/api` payloads (Network verified). |
| **T5** | E2E smoke | chrome-devtools MCP + manual | Upload an unknown-SKU row → appears in New Items → manager edits/reassigns → approves in Source Control → item leaves New Items. |

Post-deploy: **Render CLI** `render logs -r <mjcc-api> --level error` to confirm prod clean.

---

## 8. Agent orchestration, CLI & MCP usage

> **Correction to the prompt's premise:** there is **no `antigravity` CLI** in this environment (`CLAUDE.md` states it explicitly). The real parallelization primitives are the **`Agent` tool (subagents)**, **background Bash**, and the **MCP servers**. The plan uses those.

**Parallel tracks (dependencies noted):**

| Track | Owner / agent | Tools / MCP | Parallelism |
|---|---|---|---|
| **DB** | data lane via **Supabase MCP** | `apply_migration`, `execute_sql`, `get_advisors`, `list_migrations` | Phase 1 is a **hard gate** — must land before backend upsert switch + T3. |
| **API** | backend; **general-purpose subagent** for the mechanical triplication-removal; **MJCC-debugger** for any 500 root-cause | ruff, pytest, `python -c "import backend.main"` | Code **written in parallel** with DB (runs only after migration). |
| **UI** | **Claude** (frontend lane) | `tsc`/`vite`/eslint, **chrome-devtools MCP** | Parallel with API once contract shape fixed. |
| **QA** | **TestSprite MCP** + **chrome-devtools MCP** | baseline T0, integration T3, runtime T4/T5 | Runs at the gates. |

**MCP discipline:** Supabase MCP = sole schema/data truth (never assume names). chrome-devtools MCP = real request/response shapes. sequential-thinking = this planning (done). **github MCP** = diffs/PR at the very end only. **Render CLI** = prod log confirmation after deploy. Spawn the backend-mechanical + frontend subagents **concurrently**, re-absorb summaries (keeps my context lean per the CLAUDE.md throttling protocol).

**Logging:** every track appends to `CHANGELOG.md` (the forum, `AGENTS.md` §8) before close. Branch off `main` (never commit to `main` directly); `github` operator handles the push; Render auto-deploys on merge.

---

## 9. Decisions — LOCKED (user-confirmed 2026-06-09)

1. **SKU identity depth → ✅ Keep uuid `id` as physical PK; `sku` becomes NOT-NULL UNIQUE business/contract key** and the sole lookup/upsert/identity key. No FK repointing.
2. **Unrecognized item visibility → ✅ `active = true`** — New-Items rows are visible/usable immediately and show in the New Items review surface; manager edits/reassigns after.
3. **948 orphan inactive blank-sku rows → leave untouched** (default; review separately — not part of this refactor's migration).
4. **Delete semantics → ✅ Soft delete (`active = false`)**. `item_delete` flips `active`; history + FKs preserved; reversible.
5. **Week index W1–W4 → ✅ Admin picks the week on upload** — explicit W1–W4 selector; received qty routes to `w{N}_received`.

---

## 10. Critical path (one line)

**T0 baseline → Phase 1 DB migration (gate T1) → Phase 2 backend resolver+upsert+New-Items+new ops (gate T2,T3) → Phase 4 frontend edit/delete/reassign+New-Items surface (gate T4) → T5 E2E → CHANGELOG + branch commit → deploy → prod log check.** Phases 2 & 4 code are authored in parallel ahead of their gates. Invoice-parser hardening = explicit next-day follow-up.
