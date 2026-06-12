---
name: mjcc-ui-scheme
description: >-
  MJCC frontend design system: CSS custom properties, component classes,
  Tailwind co-existence rules, icon usage, Portal shell architecture, and
  VSCode-style windowed UI conventions. Read this before writing any new
  component or touching index.css.
metadata:
  version: "1.0.0"
---

# MJCC UI Design System

The design system lives in `frontend/src/index.css`. It is hand-written CSS that co-exists with Tailwind utility classes. **Never introduce a third styling pattern.**

---

## CSS Custom Properties — Always Use These

Never hardcode colors. Use the variables:

```css
/* Brand */
--accent: #1E73E8;
--accent-soft: #EFF5FE;
--accent-chip: #DBEAFE;

/* Semantic colors */
--green: #059669;    --green-bg: #F0FDF4;   --green-ink: #166534;
--amber: #D97706;    --amber-bg: #FEF3C7;   --amber-ink: #92400E;
--red: #DC2626;      --red-bg: #FEF2F2;

/* Text */
--ink: #1E293B;      /* primary text */
--muted: #64748B;    /* secondary text */
--faint: #94A3B8;    /* placeholder/disabled */

/* Surfaces */
--surface: #FFFFFF;
--surface-2: #F8FAFC;
--bg: #F5F6F8;       /* page background */

/* Borders */
--line: #E2E8F0;
--line-soft: #F1F5F9;

/* Misc */
--radius: 10px;
--mono: 'Courier New', ui-monospace, monospace;
```

---

## Component Classes

These are defined in `index.css` — use them, don't recreate them:

| Class | Purpose |
|---|---|
| `.btn` | Base button |
| `.btn.primary` | Accent-filled button |
| `.btn.warn-outline` | Amber border (pending state) |
| `.btn.sc-push-active` | Accent-ring (staged items exist) |
| `.card` | Content panel container |
| `.card-head` | Panel title bar |
| `.card-body` | Panel content area |
| `.pill` | Status badge (inline) |
| `.pill.ok` | Green pill |
| `.pill.warn` | Amber pill |
| `.pill.danger` | Red pill |
| `.banner` | Full-width alert/info bar |
| `.field` | Form input wrapper |
| `.page-head` | Page title row |
| `.ph-actions` | Right-side actions in `.page-head` |
| `.view-toggle` | Tab/toggle button group |
| `.vt-btn` | Individual toggle button |
| `.sc-badge-count` | Count pill on toolbar buttons |

---

## Icon Usage

All icons are in `frontend/src/lib/icons.tsx` as `I.*` functions.

```tsx
// Correct
{I.branch({ style: { width: 14, height: 14 } })}
{I.save({ style: { width: 14, height: 14 } })}
{I.check({ style: { width: 14, height: 14 } })}

// Never do this — no raw inline SVG
<svg xmlns="..."><path d="..."/></svg>
```

Common icons: `I.branch`, `I.save`, `I.check`, `I.close`, `I.edit`, `I.trash`, `I.plus`, `I.chevronDown`, `I.chevronRight`, `I.user`, `I.lock`, `I.star`, `I.warning`, `I.info`

---

## Portal Shell Architecture

```
Portal.tsx
├── <aside.sidebar>        nav items (role-gated), staged count badge
├── <header.topbar>        logo, period picker, SC toggle, user avatar
├── <main.main>            renderPage() output — swaps between views
└── <SourceControlPanel>   slide-in panel (right edge, z-50)
```

**Routing:** `setActive(key)` → `renderPage()` → returns JSX for that page. No react-router. Nav keys: `dashboard`, `inventory`, `sourcectrl`, `events`, `menu`, `forms`, `dataentry`, `reports`, `compliance`, `dailyops`, `templates`, `users`.

**Period state:** `[monthIndex0, year]` — month is 0-indexed in state (0=Jan). API calls convert: `month + 1`.

**Auth state:** `user` prop passed down from `App.tsx` login flow. Roles: `staff/assistant/manager/admin`.

---

## VSCode/Replit Windowed UI — Target Pattern (v3.0)

The UI is evolving toward a VSCode/Replit-style layout. Build new components with this in mind:

### Layout zones
```
┌─ Activity Bar (48px, icon-only) ─┬─ Explorer Panel (collapsible) ─┬─ Content Area ─┐
│  [inv] [sc] [events] [menu]      │  Tree / file list               │  Editor panels │
│  [forms] [reports] [settings]    │  (like VSCode Explorer)         │  (windowed)    │
└──────────────────────────────────┴─────────────────────────────────┴────────────────┘
│ Status Bar (28px) — period · staged count · API status · user ·  push state        │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Component conventions
- Cards = editor panels: title bar with close/collapse, body with scroll
- Modals = floating windows: drag handle (title bar), close ×, min-width 480px
- Sections = collapsible: chevron toggle, label + count badge
- Tables = tight, monospace numbers, row hover highlight (`--surface-2`)
- Status indicators = bottom status bar pills, not banner alerts for routine state

### Source Control event bus
```ts
// Dispatch from InventoryView
window.dispatchEvent(new CustomEvent("mjcc:draft-changed", { detail: DraftChange[] }))
window.dispatchEvent(new CustomEvent("mjcc:staging-changed"))
window.dispatchEvent(new CustomEvent("mjcc:committed"))

// Dispatch from SC panel to InventoryView
window.dispatchEvent(new CustomEvent("mjcc:stage-all-draft"))
window.dispatchEvent(new CustomEvent("mjcc:stage-draft-item", { detail: { sku } }))
window.dispatchEvent(new CustomEvent("mjcc:discard-draft-item", { detail: { sku } }))
```

---

## Role Gating

```ts
import { ROLE_LEVEL } from "../lib/constants";

const lvl = ROLE_LEVEL[user.role]; // staff=10, assistant=20, manager=30, admin=40
const canEdit   = lvl >= 10;
const canStage  = lvl >= 10;
const canCommit = lvl >= 30;
const canAdmin  = lvl >= 40;
```

Hide (don't disable) elements the user's role can't access. Don't show empty shells.

---

## Build Verification (always before closing a task)

```bash
cd frontend && npx tsc --noEmit   # zero type errors
npm run build                      # production build passes
npm run lint                       # ESLint clean — NO Prettier
```

Chunk size warnings (~667KB JS) are pre-existing and expected — not a blocker.

---

## Templates — Read-Only Reference

`/templates/**` is frozen. It contains the original HTML/CSS design patterns the system was ported from. Read it when you need to understand the original design intent. **Never edit it.**
