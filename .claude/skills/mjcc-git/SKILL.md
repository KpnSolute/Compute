---
name: mjcc-git
description: >-
  MJCC git workflow: commit message format, push procedure, branch rules,
  the Co-Authored-By trailer, and what NOT to do. This project pushes
  directly to main — no PRs unless explicitly requested.
metadata:
  version: "1.0.0"
---

# MJCC — Git Push Workflow

---

## Remote — One Origin Only

```
origin = muttyman2000/MJCC-Managements-.git
```

Never change this. Never push to any other remote.

---

## Standard Push Flow

```bash
# 1. Check state
git status
git diff --stat

# 2. Stage specific files (never git add -A blindly — avoid .env)
git add frontend/src/components/Portal.tsx
git add frontend/src/index.css
git add backend/routes/inventory.py

# 3. Commit with proper message
git commit -m "$(cat <<'EOF'
fix(inventory): guard published periods in staging route

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"

# 4. Push
git push origin main
```

---

## Commit Message Format

```
<type>(<scope>): <short description>

[optional body — what changed and why, if non-obvious]

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

**Types:**
- `feat` — new feature
- `fix` — bug fix
- `refactor` — code restructure, no behavior change
- `style` — CSS/UI only
- `docs` — CHANGELOG, README, .md files only
- `chore` — build, deps, config

**Scopes:** `inventory`, `staging`, `commits`, `auth`, `ui`, `sc` (source control), `backend`, `frontend`, `agents`, `skills`

**Rules:**
- Subject line: 72 chars max, lowercase, no period at end
- Descriptive — not `Update Portal.tsx` or `Fix bug`
- Body: explain the WHY if it's not obvious
- Always include `Co-Authored-By` trailer
- Never use `--no-verify` to skip hooks
- Never use `--amend` on a pushed commit

---

## Branch Rules

- Default branch: `main`
- **Direct push to main** is the standard workflow for this project (no PR flow unless user requests)
- Branch off main for large experimental changes: `git checkout -b feat/vscode-ui`
- Merge back: `git checkout main && git merge feat/vscode-ui --no-ff`

---

## What NOT to Do

```bash
# FORBIDDEN
git push --force          # destroys history
git commit --amend        # after pushing — rewrites shared history
git reset --hard HEAD~1   # without explicit user approval
git checkout -- .         # discards uncommitted work silently
git add -A                # risks committing .env or build artifacts
git commit --no-verify    # bypasses hooks
```

---

## Before Every Push — Verify Checklist

```bash
# Frontend
cd frontend && npx tsc --noEmit && npm run build && npm run lint

# Backend
ruff check backend/ && ruff format backend/

# State check
git status   # confirm only intended files are staged
git diff --cached --stat
```

---

## Render Auto-Deploy

Pushing to `main` triggers an automatic Render deploy of the backend service (`mjcc-managements` on Render). Monitor it:

```bash
render services                        # get the service ID
render deploys list -r <service-id>    # see deploy queue
render logs -r <service-id>            # tail logs post-deploy
```

The frontend static site is on a separate Render service and also auto-deploys on push.

---

## CHANGELOG Protocol After Push

After every push, update `CHANGELOG.md`:

```markdown
## [vX.X.X] — YYYY-MM-DD — short title
**Claude:** what was changed and why.
**Build:** tsc clean, build passing, ruff clean (as applicable)
**Push:** <git sha> — YYYY-MM-DD HH:MM
```

Log the real SHA from `git log -1 --format="%h"`.
