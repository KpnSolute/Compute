-- 031: drop legacy menu tables. Cycle menu now lives in menu_items / menu_cycle_days /
-- menu_cycle_slots (migration 029). All code paths repointed: routes/menu.py (v4.27.0),
-- ai/tools.py get_menu, ai/diff.py _diff_menu_save, staging/dispatch.py dispatch_menu_save,
-- seed_data.py menu seeding removed.
drop table if exists public.menu_entries;
drop table if exists public.menu_cycles;
