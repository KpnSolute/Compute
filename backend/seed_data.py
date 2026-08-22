"""Seed data — GitHub archive import. (Menu seeding removed: cycle menu now lives in menu_cycle_slots via migration 029.)"""

import os
from supabase import create_client
from dotenv import load_dotenv
from backend.tenancy import TenantScopedClient

load_dotenv()

_svc = None


def _client():
    global _svc
    if _svc is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_KEY")
        if not url or not key:
            raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.")
        _svc = create_client(url, key)
    return _svc


def import_github_archive(repo: str = "MJCC-Portal/mjcc", branch: str = "main"):
    """Fetch inventory snapshots from the GitHub archive repo and insert into monthly_snapshots."""
    import httpx

    db = TenantScopedClient(_client())
    api_url = f"https://api.github.com/repos/{repo}/contents"

    resp = httpx.get(f"{api_url}?ref={branch}", timeout=30)
    resp.raise_for_status()
    items = resp.json()

    total = 0
    for item in items:
        name = item.get("name", "")
        if name.endswith(".json"):
            file_resp = httpx.get(item["download_url"], timeout=30)
            file_resp.raise_for_status()
            data = file_resp.json()

            parts = name.replace(".json", "").split("-")
            if len(parts) >= 2:
                year, month = int(parts[0]), int(parts[1])
            else:
                continue

            snapshot = {
                "year": year,
                "month": month,
                "source_file": name,
                "grand_total": data.get("grand_total", 0),
                "item_count": data.get("item_count", 0),
                "data": data,
            }
            db.table("monthly_snapshots").upsert(
                snapshot,
                on_conflict="year,month",
            ).execute()
            total += 1

    print(f"Imported {total} archive snapshots from {repo}")


if __name__ == "__main__":
    if os.getenv("MJCC_SEED_CONFIRM") != "1":
        print("ERROR: set MJCC_SEED_CONFIRM=1 to run against the live database.")
        raise SystemExit(1)
    import_github_archive()
