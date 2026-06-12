---
name: skillsense
description: >-
  SkillSense — auto-detects repeated task patterns and prompts creation of
  a reusable skill to stabilize that pattern. Covers any repeated task:
  debugging workflows, deploy sequences, data migrations, UI patterns,
  API wiring, problem-prevention checklists. Prevents wheel-reinvention
  and locks in stability for known-good procedures.
metadata:
  version: "1.0.0"
---

# SkillSense — Auto-Skill Creation

## What Is This

SkillSense is a **meta-skill** — a pattern detector. When you find yourself doing the same multi-step task for the second or third time in the MJCC project, SkillSense tells you to write a skill for it so you (and any agent) never have to re-derive it.

The goal: **once is a task, twice is a pattern, three times is a skill.**

---

## When to Trigger

SkillSense should activate when any of these are true:

1. **Repeated task** — you're doing something you did last session (or last week) from scratch.
2. **Fragile sequence** — a multi-step process where one wrong step breaks something (deploys, migrations, rollbacks).
3. **Repeated debugging** — you diagnosed the same bug class more than once (month-index confusion, par contamination, status constraint violations).
4. **Repeated API shape lookup** — you're re-reading `api.ts` or `dispatch.py` to remember a payload format.
5. **Repeated environment setup** — re-discovering how to start the backend, activate the venv, set up MCPs.

---

## How to Create a Skill

When SkillSense triggers, create a skill immediately:

### 1. Pick the location
```
.claude/skills/<skill-name>/SKILL.md
```

Naming convention: `mjcc-<topic>` for MJCC-specific skills, bare `<topic>` for general patterns.

### 2. Write the SKILL.md

```markdown
---
name: <skill-name>
description: >-
  One-line description of what problem this solves and when to use it.
  Include enough context that an agent loading it cold knows immediately
  if this is relevant.
metadata:
  version: "1.0.0"
---

# Title

## When to Use
[Specific triggers — what situation makes this skill relevant]

## The Procedure / Pattern
[Step-by-step or reference content — exact commands, code patterns, gotchas]

## What NOT To Do
[Anti-patterns and traps specific to this task]

## Stability Notes
[What invariants this skill protects — why deviating breaks things]
```

### 3. Reference it in `mjcc-tooling/SKILL.md`

Add a one-line entry to the skills index so other agents discover it.

---

## SkillSense Trigger Examples

### Example: repeated month-index bugs
After hitting `month 0-indexed in DB but 1-indexed in API` twice → write a skill that documents the conversion, the guard points, and a test query.

### Example: repeated Render deploy + verify sequence
After doing `render services → render logs → render deploys create` three times → write a skill with the exact command sequence and what to check in logs.

### Example: repeated VSCode-style component pattern
After building two VSCode-style collapsible sections with hover-reveal actions → write a skill with the CSS classes, JSX pattern, and event wiring.

### Example: repeated staging dedup debugging
After diagnosing `23505 unique violation` on `staging_entries` twice → write a skill documenting the dedup key, the upsert pattern, and the correct `ON CONFLICT` clause.

---

## Stability Contract

A skill written through SkillSense acts as a **stability anchor**:
- It locks in the known-good procedure.
- Any agent that deviates from it should have an explicit reason why.
- When the underlying system changes (new schema, new API shape), update the skill — don't let it go stale.

If a skill becomes wrong, it is **more dangerous than no skill** because agents will follow it blindly. Update or delete stale skills immediately when the underlying reality changes.

---

## Skill Index Location

All skills live in `.claude/skills/`. The master reference is `mjcc-tooling/SKILL.md`.

Current MJCC skills:
- `mjcc-tooling` — master index, MCP/tool palette
- `mjcc-mcps` — Supabase, Chrome DevTools, GitHub MCP usage
- `mjcc-ui-scheme` — CSS tokens, component classes, Portal architecture
- `mjcc-ruff` — Python backend linting
- `mjcc-supabase-auth` — auth flows, token storage, login patterns
- `mjcc-git` — commit format, push workflow, branch rules
- `skillsense` — this skill (auto-skill creation on repeated patterns)
- 21 Render skills (`render-*`) — Render platform operations
