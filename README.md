# MJCC — Miami Job Corps Cafeteria Portal

**Main application repository**  
Flask · Supabase · GitHub

---

## Two-repo architecture

| Repo                                             | Role                                                            |
| ------------------------------------------------ | --------------------------------------------------------------- |
| `muttyman2000/MJCC-Managements-` **(this repo)** | Application code — Flask backend, Jinja2 frontend, CI/CD, tests |
| `MJCC-Portal/mjcc`                               | Data store — inventory snapshots, archives, Supabase migrations |

The app writes inventory data to `MJCC-Portal/mjcc` automatically after every commit. The data repo has no code — it's a pure file archive driven by the GitHub API.

---

## Tools

| Tool           | Routes                     | Description                                           |
| -------------- | -------------------------- | ----------------------------------------------------- |
| Inventory      | `/mjcc/admin/inventory/*`  | Monthly tracking, invoice parsing, barcodes, reports  |
| Menu           | `/mjcc/admin/menu/*`       | 28-day cycle, PowerPoint export, automation           |
| Users          | `/mjcc/admin/users/*`      | Role management (staff / assistant / manager / admin) |
| Source Control | `/mjcc/admin/sourcectrl/*` | Commit history, staging pipeline, GitHub sync         |
| Archives       | `/mjcc/admin/archives/*`   | Historical snapshots, invoices, menus                 |

## Quick start

```bash
git clone https://github.com/muttyman2000/MJCC-Managements-.git
cd MJCC-Managements-
cp .env.example .env      # fill in your credentials
python3 -m venv venv && source venv/bin/activate
pip install -r backend/requirements.txt
./run.sh
# → http://localhost:5000
```

## Role model

| Role      | Level | Auto-commit               | Access                        |
| --------- | ----- | ------------------------- | ----------------------------- |
| staff     | 10    | No — goes through staging | Read + submit changes         |
| assistant | 20    | Yes                       | Read + write                  |
| manager   | 30    | Yes                       | Full inventory management     |
| admin     | 40    | Yes                       | Everything + users + settings |

## Environment variables

See `.env.example` for the full list. Key ones:

```
SUPABASE_URL / SUPABASE_SERVICE_KEY   ← live database
GITHUB_TOKEN                          ← PAT for writing to MJCC-Portal/mjcc
GITHUB_REPO=MJCC-Portal/mjcc         ← data store target
```
