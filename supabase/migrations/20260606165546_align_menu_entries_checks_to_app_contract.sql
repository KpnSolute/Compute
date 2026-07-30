-- Root-cause fix: menu_entries CHECK constraints contradicted the app code, so every
-- insert from menu.py (POST /api/menu/{day}) and seed_data.py failed -> menu_entries
-- stayed at 0 rows and the menu widget was permanently empty. Logs showed repeated
-- "violates check constraint menu_entries_day_of_week_check".
--
-- The route contract (backend/routes/menu.py VALID_DAYS + MEAL_PERIODS) and the seeder
-- use abbreviated days (Mon..Sun) and capitalized meal types incl. Snack/Brunch.
-- Align the DB to that contract. Table is empty -> no existing row can violate the new checks.
ALTER TABLE public.menu_entries DROP CONSTRAINT IF EXISTS menu_entries_day_of_week_check;
ALTER TABLE public.menu_entries
  ADD CONSTRAINT menu_entries_day_of_week_check
  CHECK (day_of_week = ANY (ARRAY['Mon','Tue','Wed','Thu','Fri','Sat','Sun']));

ALTER TABLE public.menu_entries DROP CONSTRAINT IF EXISTS menu_entries_meal_type_check;
ALTER TABLE public.menu_entries
  ADD CONSTRAINT menu_entries_meal_type_check
  CHECK (meal_type = ANY (ARRAY['Breakfast','Lunch','Dinner','Snack','Brunch']));;
