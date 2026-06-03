"""Seed data — extract from portal JS files and insert into Supabase tables."""

import json
import os
from datetime import datetime
from backend.routes import supabase

TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), "..", "templates", "portal")


def _parse_js_var(filepath, var_name):
    """Extract a JS variable assigned to ``window.VAR = <json>`` or ``VAR = <json>``."""
    with open(filepath) as f:
        content = f.read()

    for prefix in (f"window.{var_name} = ", f"{var_name} = "):
        if prefix in content:
            start = content.index(prefix) + len(prefix)
            break
    else:
        raise ValueError(f"Variable {var_name} not found in {filepath}")

    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(content)):
        c = content[i]
        if esc:
            esc = False
            continue
        if c == "\\" and in_str:
            esc = True
            continue
        if c == '"' and not esc:
            in_str = not in_str
            continue
        if not in_str:
            if c in ("{", "["):
                depth += 1
            elif c in ("}", "]"):
                depth -= 1
                if depth == 0:
                    return json.loads(content[start : i + 1])

    raise ValueError(f"Could not parse {var_name} from {filepath}")


DEMO_INV = None
DEMO_HISTORY = None
DEMO_ARCHIVES = None

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

EVENTS_DATA = [
    {
        "id": 1,
        "cat": "cultural",
        "title": "Asian Heritage Dinner",
        "date": "2026-01-29",
        "theme": "Asian Heritage",
        "desc": "Vegetable fried rice, beef or tofu stir-fry, spring rolls, egg drop soup, fortune cookies, jasmine tea. Lanterns & chopstick place settings. Coordinate with the Diversity / Multi-Cultural Awareness Committee.",
        "suggestedMenu": "Fried Rice · Beef/Tofu Stir-Fry · Spring Rolls · Egg Drop Soup · Fortune Cookies · Jasmine Tea",
        "status": "planned",
    },
    {
        "id": 2,
        "cat": "cultural",
        "title": "Black History Month Celebration Meal",
        "date": "2026-02-26",
        "theme": "Black History Month",
        "desc": "Fried chicken, collard greens, mac & cheese, cornbread, sweet potato pie, lemonade. Recognize student & staff achievements. Historical figures display in the dining hall.",
        "suggestedMenu": "Fried Chicken · Collard Greens · Mac & Cheese · Cornbread · Sweet Potato Pie · Lemonade",
        "status": "planned",
    },
    {
        "id": 3,
        "cat": "cultural",
        "title": "Mardi Gras Celebration Dinner",
        "date": "2026-03-26",
        "theme": "Mardi Gras",
        "desc": "Shrimp étouffée, red beans & rice, jambalaya, beignets, king cake, jazz playlist. Purple, gold & green decorations; beads and festive settings.",
        "suggestedMenu": "Shrimp Étouffée · Red Beans & Rice · Jambalaya · Cornbread · Beignets · King Cake",
        "status": "planned",
    },
    {
        "id": 4,
        "cat": "cultural",
        "title": "Earth Day Green & Clean Meal",
        "date": "2026-04-30",
        "theme": "Earth Day",
        "desc": "Plant-forward menu highlighting sustainable, seasonal produce. Roasted vegetable grain bowl, salad bar feature, lentil soup, fruit smoothies, whole grain rolls.",
        "suggestedMenu": "Roasted Vegetable Grain Bowl · Lentil Soup · Garden Salad Feature · Whole Grain Rolls · Seasonal Fruit · Infused Water",
        "status": "planned",
    },
    {
        "id": 5,
        "cat": "cultural",
        "title": "Haitian Flag Day Dinner",
        "date": "2026-05-28",
        "theme": "Haitian Flag Day",
        "desc": "Celebrate Haitian Flag Day (May 18). Griot, rice & peas (diri ak pwa), pikliz, plantains (banan peze), soup joumou. Red & blue decorations; Haitian flag displayed.",
        "suggestedMenu": "Griot · Diri ak Pwa · Banan Peze · Pikliz · Soup Joumou · Haitian Rum Cake",
        "status": "planned",
    },
    {
        "id": 6,
        "cat": "cultural",
        "title": "Middle Eastern Cuisine Night",
        "date": "2026-06-25",
        "theme": "Middle Eastern",
        "desc": "Chicken shawarma, falafel, hummus & pita, tabbouleh, basmati rice, baklava, mint tea. Maps & cultural facts displayed. Vegetarian options prominently featured.",
        "suggestedMenu": "Chicken Shawarma · Falafel · Hummus & Pita · Tabbouleh · Basmati Rice · Baklava · Mint Tea",
        "status": "planned",
    },
    {
        "id": 7,
        "cat": "cultural",
        "title": "4th of July Independence Day BBQ",
        "date": "2026-07-30",
        "theme": "4th of July",
        "desc": "American cookout. Burgers, hot dogs, BBQ ribs, corn on the cob, coleslaw, baked beans, watermelon, apple pie. Per SOP: holiday = two meals + healthy snacks.",
        "suggestedMenu": "Burgers & Hot Dogs · BBQ Ribs · Corn on the Cob · Coleslaw · Baked Beans · Watermelon · Apple Pie",
        "status": "planned",
    },
    {
        "id": 8,
        "cat": "cultural",
        "title": "Taste of Chicago Dinner",
        "date": "2026-08-27",
        "theme": "Taste of Chicago",
        "desc": "Inspired by the Chicago food festival. Deep dish pizza, Chicago hot dogs, Italian beef, cheese fries, Italian lemon ice. Skyline decorations.",
        "suggestedMenu": "Deep Dish Pizza · Chicago-Style Hot Dogs · Italian Beef · Cheese Fries · Italian Lemon Ice · Chicago Mix Popcorn",
        "status": "planned",
    },
    {
        "id": 9,
        "cat": "cultural",
        "title": "Taste of the Islands Dinner",
        "date": "2026-09-24",
        "theme": "Taste of the Islands",
        "desc": "Caribbean flavors. Jerk chicken, curry goat, oxtail stew, rice & peas, fried plantains, festival, sorrel drink, coconut cake. Steel drum playlist.",
        "suggestedMenu": "Jerk Chicken · Curry Goat · Rice & Peas · Fried Plantains · Festival · Sorrel Drink · Coconut Cake",
        "status": "planned",
    },
    {
        "id": 10,
        "cat": "cultural",
        "title": "Hispanic Heritage Month Dinner",
        "date": "2026-10-29",
        "theme": "Hispanic Heritage",
        "desc": "Hispanic Heritage Month (Sept 15 – Oct 15). Pernil, arroz con gandules, tostones, ceviche, tres leches cake, horchata. Flags of Hispanic nations displayed.",
        "suggestedMenu": "Pernil · Arroz con Gandules · Tostones · Black Beans · Ceviche · Tres Leches Cake · Horchata",
        "status": "planned",
    },
    {
        "id": 11,
        "cat": "cultural",
        "title": "Thanksgiving Special Dinner",
        "date": "2026-11-26",
        "theme": "Thanksgiving",
        "desc": "Traditional feast. Roast turkey, cornbread stuffing, mashed potatoes & gravy, candied yams, green bean casserole, cranberry sauce, pumpkin & apple pie. Gratitude wall.",
        "suggestedMenu": "Roast Turkey · Cornbread Stuffing · Mashed Potatoes · Candied Yams · Green Bean Casserole · Cranberry Sauce · Pumpkin Pie",
        "status": "planned",
    },
    {
        "id": 12,
        "cat": "cultural",
        "title": "Holiday Season Celebration Dinner",
        "date": "2026-12-31",
        "theme": "Holiday Season",
        "desc": "End-of-year celebration. Glazed ham, beef tenderloin, mac & cheese, sweet potato casserole, dinner rolls, cookie assortment, eggnog, hot cocoa.",
        "suggestedMenu": "Glazed Ham · Beef Tenderloin · Mac & Cheese · Sweet Potato Casserole · Dinner Rolls · Cookie Assortment · Eggnog",
        "status": "planned",
    },
    {
        "id": 20,
        "cat": "special",
        "title": "Community Relations Luncheon",
        "date": "2026-05-14",
        "desc": "Quarterly luncheon for community partners and stakeholders. Meal tickets waived by DOL Regional Office. Submit Food Request Form FA510.01c at least 10 days prior.",
        "status": "planned",
    },
    {
        "id": 21,
        "cat": "special",
        "title": "SGA Food Services Committee Meeting",
        "date": "2026-05-07",
        "desc": "Monthly SGA Food Services Committee meeting. Food Services Manager / Supervisor must attend. Record & maintain minutes.",
        "status": "planned",
    },
    {
        "id": 22,
        "cat": "special",
        "title": "SGA Food Services Committee Meeting",
        "date": "2026-06-04",
        "desc": "Monthly SGA Food Services Committee meeting.",
        "status": "planned",
    },
    {
        "id": 24,
        "cat": "special",
        "title": "Graduation Celebration Dinner",
        "date": "2026-06-25",
        "desc": "Special dinner for graduating students and families. Submit Food Request Form FA510.01c at least 10 days prior.",
        "status": "planned",
    },
    {
        "id": 25,
        "cat": "special",
        "title": "Off-Center Activity — Sack Lunches",
        "date": "2026-05-22",
        "desc": "Submit Food Request Form at least 2 working days in advance. Include student names, destination, and return time.",
        "status": "planned",
    },
    {
        "id": 27,
        "cat": "special",
        "title": "4th of July Holiday BBQ",
        "date": "2026-07-04",
        "desc": "Actual Independence Day holiday cookout. Per SOP: holiday = two meals + healthy snacks. Red, white & blue decorations.",
        "status": "planned",
    },
    {
        "id": 30,
        "cat": "training",
        "title": "ServSafe Manager Recertification",
        "date": "2026-07-15",
        "desc": "Food Services Manager / Supervisor must be ServSafe Proctor certified. Coordinate with HR to track expiration dates.",
        "status": "planned",
    },
    {
        "id": 31,
        "cat": "training",
        "title": "New Staff ServSafe 90-Day Deadline",
        "date": "2026-06-01",
        "desc": "All food services staff must be ServSafe certified within 90 days of employment per company SOP.",
        "status": "planned",
    },
    {
        "id": 32,
        "cat": "training",
        "title": "HACCP Annual Procedures Review",
        "date": "2026-05-28",
        "desc": "Annual review of all HACCP critical control points, daily temperature logs, and corrective action procedures.",
        "status": "planned",
    },
    {
        "id": 33,
        "cat": "training",
        "title": "Food Safety & Sanitation Training",
        "date": "2026-08-10",
        "desc": "Annual refresher on local, state, and federal sanitation codes. All food service staff required.",
        "status": "planned",
    },
    {
        "id": 35,
        "cat": "training",
        "title": "Quarterly Safety Inspection",
        "date": "2026-06-15",
        "desc": "Safety & Security Manager inspects kitchen, dining hall, culinary arts classroom, and snack bar. Results filed with Food Services Manager, Admin Director and Center Director.",
        "status": "planned",
    },
    {
        "id": 40,
        "cat": "heals",
        "title": "HEALs Committee Meeting",
        "date": "2026-05-21",
        "desc": "Monthly meeting: Health & Wellness Mgr, Food Services Mgr, Recreation Supervisor, TEAP Specialist, Social Development Director, student reps.",
        "status": "planned",
    },
    {
        "id": 44,
        "cat": "heals",
        "title": "HEALs Committee Meeting & No-Soda Day",
        "date": "2026-04-16",
        "desc": "Monthly HEALs committee meeting (3rd Thursday). No-soda day. Plan Earth Day meal coordination (Apr 30) and spring wellness activities.",
        "status": "planned",
    },
    {
        "id": 45,
        "cat": "heals",
        "title": "HEALs Committee Meeting",
        "date": "2026-06-18",
        "desc": "Monthly HEALs committee meeting.",
        "status": "planned",
    },
    {
        "id": 46,
        "cat": "heals",
        "title": "Nutrition Education Workshop",
        "date": "2026-06-09",
        "desc": "Student nutrition session — MyPlate guidelines, reading food labels, healthy snack choices.",
        "status": "planned",
    },
    {
        "id": 47,
        "cat": "heals",
        "title": "Active Lifestyle Day",
        "date": "2026-06-20",
        "desc": "Collaborative event with Recreation Dept: healthy outdoor meal, fitness activities, wellness info tables.",
        "status": "planned",
    },
    {
        "id": 49,
        "cat": "heals",
        "title": "Farm-to-Table Feature Week",
        "date": "2026-09-08",
        "desc": "Week-long focus on fresh, locally-sourced produce. Menus feature seasonal vegetables and whole grains.",
        "status": "planned",
    },
]

SERVSAFE_STAFF = [
    {
        "name": "Food Services Manager / Supervisor",
        "cert": "ServSafe Manager",
        "expiry": "2026-08-15",
        "proctor": True,
    },
    {
        "name": "Assistant Manager",
        "cert": "ServSafe Food Handler",
        "expiry": "2026-11-30",
        "proctor": False,
    },
    {
        "name": "Cook 1",
        "cert": "ServSafe Food Handler",
        "expiry": "2027-02-10",
        "proctor": False,
    },
    {
        "name": "Cook 2",
        "cert": "ServSafe Food Handler",
        "expiry": "2026-06-01",
        "proctor": False,
    },
    {
        "name": "Assistant Cook",
        "cert": "ServSafe Food Handler",
        "expiry": "2026-12-20",
        "proctor": False,
    },
    {
        "name": "Food Services Assistant 1",
        "cert": "ServSafe Food Handler",
        "expiry": "2027-01-05",
        "proctor": False,
    },
    {
        "name": "WBL Student (Culinary)",
        "cert": "Pending (90-day deadline)",
        "expiry": "",
        "proctor": False,
    },
]

DEMO_USERS = [
    {
        "username": "admin",
        "display_name": "Angela",
        "last_name": "Martin",
        "role": "admin",
        "password": "admin123",
        "pin": "",
        "active": True,
    },
    {
        "username": "manager",
        "display_name": "Daniel",
        "last_name": "Cortez",
        "role": "manager",
        "password": "mgr123",
        "pin": "",
        "active": True,
    },
    {
        "username": "assistant",
        "display_name": "Lena",
        "last_name": "Price",
        "role": "assistant",
        "password": "asst123",
        "pin": "",
        "active": True,
    },
    {
        "username": "rkhan",
        "display_name": "Rasheed",
        "last_name": "Khan",
        "role": "staff",
        "password": "",
        "pin": "1111",
        "active": True,
    },
    {
        "username": "mlopez",
        "display_name": "Maria",
        "last_name": "Lopez",
        "role": "staff",
        "password": "",
        "pin": "2222",
        "active": True,
    },
]


def load_data():
    """Parse DEMO_INV, DEMO_HISTORY, DEMO_ARCHIVES from the JS file."""
    global DEMO_INV, DEMO_HISTORY, DEMO_ARCHIVES
    inv_file = os.path.join(TEMPLATES_DIR, "inventory_data.js")
    DEMO_INV = _parse_js_var(inv_file, "DEMO_INV")
    DEMO_HISTORY = _parse_js_var(inv_file, "DEMO_HISTORY")
    DEMO_ARCHIVES = _parse_js_var(inv_file, "DEMO_ARCHIVES")


def seed_database():
    """Seed all tables with demo data from portal JS files and inline constants."""
    if DEMO_INV is None:
        load_data()

    now = datetime.utcnow().isoformat()

    for user in DEMO_USERS:
        supabase.table("user_profiles").upsert(user, on_conflict="username").execute()
    print(f"Seeded {len(DEMO_USERS)} users")

    supabase.table("inventory_sync").upsert(
        {
            "id": 202605,
            "data": DEMO_INV,
            "synced_by": "seed",
        }
    ).execute()
    print("Seeded current inventory (period 202605)")

    if DEMO_HISTORY:
        for period_str, data in DEMO_HISTORY.items():
            y, m = period_str.split("-")
            supabase.table("inventory_sync").upsert(
                {
                    "id": int(y) * 100 + int(m),
                    "data": data,
                    "synced_by": "seed",
                }
            ).execute()
        print(f"Seeded {len(DEMO_HISTORY)} historical snapshots")

    for ev in EVENTS_DATA:
        supabase.table("events").upsert(ev, on_conflict="id").execute()
    print(f"Seeded {len(EVENTS_DATA)} events")

    for day, menu_data in CYCLE_MENU.items():
        supabase.table("cycle_menu").upsert(
            {
                "id": day,
                "data": menu_data,
                "updated_by": "seed",
                "updated_at": now,
            }
        ).execute()
    print(f"Seeded {len(CYCLE_MENU)} menu days")

    print("Database seeding complete")


if __name__ == "__main__":
    seed_database()
