"""Seed data — insert 28-day cycle menu into menu_entries."""

import json
import os
from supabase import create_client
from dotenv import load_dotenv

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


CYCLE_MENU = {
    "Mon": {
        "Breakfast": [
            {"qty": 80, "item": "Boiled Egg", "desc": "Well-done boiled egg"},
            {"qty": 50, "item": "Bacon", "desc": "Pork bacon"},
            {"qty": 50, "item": "Breakfast Sausage", "desc": "Pork link"},
            {"qty": 60, "item": "White Toast"},
            {"qty": 60, "item": "Wheat Toast"},
            {"qty": 60, "item": "Breakfast Potatoes"},
            {"qty": 60, "item": "French Toast"},
            {"qty": 60, "item": "Pastry / Scone"},
            {"qty": 60, "item": "Bagels"},
            {"qty": 60, "item": "Biscuit"},
        ],
        "Lunch": [
            {
                "qty": 55,
                "item": "Herb Pork Chop",
                "desc": "Pork chop w/ herb cream sauce",
            },
            {
                "qty": 60,
                "item": "Korean Chicken",
                "desc": "Oven-roasted, Korean BBQ sauce",
            },
            {"qty": 10, "item": "Vegetarian option"},
        ],
        "Dinner": [
            {
                "qty": 80,
                "item": "Lemon Garlic Tilapia",
                "desc": "Pan-fried w/ lemon garlic sauce",
            },
            {
                "qty": 80,
                "item": "Curry Chicken",
                "desc": "West Indian stew chicken w/ curry",
            },
            {"qty": 10, "item": "Vegetarian option"},
        ],
        "Snack": ["Granola Bar", "Banana", "Potato Chips", "Apple", "Orange"],
    },
    "Tue": {
        "Breakfast": [
            {"qty": 160, "item": "Scrambled Egg", "desc": "Well-done scramble"},
            {"qty": 50, "item": "Bacon"},
            {"qty": 50, "item": "Breakfast Sausage"},
            {"qty": 60, "item": "White Toast"},
            {"qty": 60, "item": "Wheat Toast"},
            {"qty": 60, "item": "Breakfast Potatoes"},
            {"qty": 60, "item": "French Toast"},
            {"qty": 60, "item": "Pastry / Scone"},
            {"qty": 60, "item": "Bagels"},
            {"qty": 60, "item": "Biscuit"},
        ],
        "Lunch": [
            {"qty": 80, "item": "Chef Special Lunch"},
            {"qty": 10, "item": "Vegetarian option"},
        ],
        "Dinner": [
            {"qty": 80, "item": "Chef Special Dinner"},
            {"qty": 10, "item": "Vegetarian option"},
        ],
        "Snack": ["Granola Bar", "Banana", "Potato Chips"],
    },
    "Wed": {
        "Breakfast": [
            {
                "qty": 160,
                "item": "Cheese Scramble",
                "desc": "Well-done cheese scramble",
            },
            {"qty": 50, "item": "Bacon"},
            {"qty": 50, "item": "Breakfast Sausage"},
            {"qty": 60, "item": "White Toast"},
            {"qty": 60, "item": "Wheat Toast"},
            {"qty": 60, "item": "Breakfast Potatoes"},
            {"qty": 60, "item": "French Toast"},
            {"qty": 60, "item": "Pastry / Scone"},
            {"qty": 60, "item": "Bagels"},
            {"qty": 60, "item": "Biscuit"},
        ],
        "Lunch": [
            {
                "qty": 80,
                "item": "Brown Stew Chicken",
                "desc": "Stew chicken w/ brown gravy",
            },
            {
                "qty": 80,
                "item": "Shrimp Alfredo",
                "desc": "Pasta w/ shrimp in creamy sauce",
            },
            {"qty": 60, "item": "Vegetarian", "desc": "Vegetables in tomato sauce"},
        ],
        "Dinner": [
            {
                "qty": 80,
                "item": "Chicken Parmesan",
                "desc": "Chicken breast, marinara, mozzarella",
            },
            {"qty": 80, "item": "Fried Cod", "desc": "Beer-battered cod"},
            {"qty": 60, "item": "Vegetarian option"},
        ],
        "Snack": ["Granola Bar", "Apple", "Chips"],
    },
    "Thu": {
        "Breakfast": [
            {"qty": 160, "item": "Egg Casserole", "desc": "Well-done egg casserole"},
            {"qty": 50, "item": "Bacon"},
            {"qty": 50, "item": "Breakfast Sausage"},
            {"qty": 60, "item": "White Toast"},
            {"qty": 60, "item": "Wheat Toast"},
            {"qty": 60, "item": "Breakfast Potatoes"},
            {"qty": 60, "item": "French Toast"},
            {"qty": 60, "item": "Pastry / Scone"},
            {"qty": 60, "item": "Bagels"},
            {"qty": 60, "item": "Biscuit"},
        ],
        "Lunch": [
            {"qty": 80, "item": "Memphis BBQ Ribs", "desc": "BBQ pork ribs"},
            {"qty": 80, "item": "Sausage & Peppers", "desc": "Bratwurst w/ peppers"},
            {"qty": 60, "item": "Veggie Burger", "desc": "Veggie protein patty"},
        ],
        "Dinner": [
            {"qty": 80, "item": "Crusted Cod", "desc": "Baked crusted cod fish"},
            {
                "qty": 80,
                "item": "Chicken Marsala",
                "desc": "Pan-fried chicken w/ Marsala sauce",
            },
            {"qty": 60, "item": "Vegetarian option"},
        ],
        "Snack": ["Granola Bar", "Banana", "Chips"],
    },
    "Fri": {
        "Breakfast": [
            {"qty": 160, "item": "Boiled Egg"},
            {"qty": 50, "item": "Bacon"},
            {"qty": 50, "item": "Breakfast Sausage"},
            {"qty": 60, "item": "White Toast"},
            {"qty": 60, "item": "Wheat Toast"},
            {"qty": 60, "item": "Breakfast Potatoes"},
            {"qty": 60, "item": "French Toast"},
            {"qty": 60, "item": "Pastry / Scone"},
            {"qty": 60, "item": "Bagels"},
            {"qty": 60, "item": "Biscuit"},
        ],
        "Lunch": [
            {
                "qty": 80,
                "item": "Chicken Burrito Bowl",
                "desc": "Chicken strips on rice w/ toppings",
            },
            {"qty": 80, "item": "Fish Sandwich", "desc": "Fried fish w/ tartar sauce"},
            {"qty": 60, "item": "Beef Taco", "desc": "Ground beef on soft shell"},
            {"qty": 10, "item": "Vegetarian Burrito Bowl"},
        ],
        "Dinner": [
            {
                "qty": 80,
                "item": "Tuscan Chicken",
                "desc": "Pan-fried chicken w/ creamy sauce",
            },
            {"qty": 80, "item": "Tuna Casserole", "desc": "Pasta in cheese tuna sauce"},
            {"qty": 60, "item": "Vegetarian option"},
        ],
        "Snack": ["Granola Bar", "Apple", "Orange", "Chips"],
    },
    "Sat": {
        "Brunch": [
            {"qty": 80, "item": "Bagel Sandwich", "desc": "Bagel, egg and cheese"},
            {"qty": 60, "item": "Chef Special"},
            {"qty": 60, "item": "Scrambled Egg"},
            {"qty": 60, "item": "Bacon"},
            {"qty": 60, "item": "Breakfast Sausage"},
        ],
        "Dinner": [
            {"qty": 80, "item": "Saturday Chef Special Dinner"},
            {"qty": 10, "item": "Vegetarian option"},
        ],
        "Snack": ["Granola Bar", "Banana", "Chips"],
    },
    "Sun": {
        "Brunch": [
            {"qty": 80, "item": "Sunday Brunch Special"},
            {"qty": 10, "item": "Vegetarian option"},
        ],
        "Dinner": [
            {"qty": 80, "item": "Sunday Chef Special Dinner"},
            {"qty": 10, "item": "Vegetarian option"},
        ],
        "Snack": ["Granola Bar", "Apple", "Banana"],
    },
}

MEAL_PERIODS = {
    "Mon": ["Breakfast", "Lunch", "Dinner", "Snack"],
    "Tue": ["Breakfast", "Lunch", "Dinner", "Snack"],
    "Wed": ["Breakfast", "Lunch", "Dinner", "Snack"],
    "Thu": ["Breakfast", "Lunch", "Dinner", "Snack"],
    "Fri": ["Breakfast", "Lunch", "Dinner", "Snack"],
    "Sat": ["Brunch", "Dinner", "Snack"],
    "Sun": ["Brunch", "Dinner", "Snack"],
}


def _serialize_items(items) -> str:
    """Serialize a menu entry's items list to JSON string for storage."""
    serializable = []
    for it in items:
        if isinstance(it, str):
            serializable.append(it)
        elif isinstance(it, dict):
            serializable.append(it)
        else:
            serializable.append(str(it))
    return json.dumps(serializable)


def seed_cycle_menu(cycle_id: str | None = None):
    """Insert CYCLE_MENU data into menu_entries for the active cycle."""
    db = _client()

    if cycle_id is None:
        result = (
            db.table("menu_cycles").select("id").eq("active", True).limit(1).execute()
        )
        if not result.data:
            print("No active menu_cycles found. Create one first.")
            return
        cycle_id = result.data[0]["id"]

    now = __import__("datetime").datetime.utcnow().isoformat()
    total = 0

    for day, meals in CYCLE_MENU.items():
        periods = MEAL_PERIODS.get(day, [])
        for sort_order, meal_type in enumerate(periods):
            items = meals.get(meal_type, [])
            if not items:
                continue
            row = {
                "cycle_id": cycle_id,
                "week_number": 1,
                "day_of_week": day,
                "meal_type": meal_type,
                "items": _serialize_items(items),
                "sort_order": sort_order,
                "created_at": now,
                "updated_at": now,
            }
            db.table("menu_entries").upsert(
                row,
                on_conflict="cycle_id,day_of_week,meal_type",
            ).execute()
            total += 1

    print(f"Seeded {total} menu entries for cycle {cycle_id}")


def import_github_archive(repo: str = "MJCC-Portal/mjcc", branch: str = "main"):
    """Fetch inventory snapshots from the GitHub archive repo and insert into monthly_snapshots."""
    import httpx

    db = _client()
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
    seed_cycle_menu()
