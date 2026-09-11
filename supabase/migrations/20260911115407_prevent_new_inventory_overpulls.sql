-- Reject NEW or WORSENING physical over-pulls at the database boundary.
-- The API/staging layer already rejects an over-pull at submission time
-- (v0.1.28); this trigger is the final backstop for any write path that
-- bypasses it (direct RPC, admin correction, rollover).
--
-- Deliberately NOT a blanket "reject if pulled > available": CHANGELOG
-- v0.1.28 documents five real 2026-07 rows left genuinely over-pulled
-- (8 units / $288.57 total) rather than silently rewritten, because they
-- record real physical events. A blanket check would relock those rows
-- against any future write — a rollover, a snapshot refresh, an unrelated
-- correction — the moment it went live. Instead this compares the row's
-- over-pull excess before and after the write, via OLD/NEW, and only
-- rejects a write that creates a new shortfall or makes an existing one
-- worse. A write that leaves an existing shortfall unchanged, or corrects
-- it, is allowed. Mirrored in Python for testing at
-- backend/inventory_formulas.py: overpull_excess / write_increases_overpull.
create or replace function public.prevent_inventory_overpull()
returns trigger
language plpgsql
as $$
declare
  new_excess numeric := greatest(
    coalesce(new.w1_pulled, 0) + coalesce(new.w2_pulled, 0) + coalesce(new.w3_pulled, 0)
      - coalesce(new.opening_oh, 0)
      - coalesce(new.w1_received, 0) - coalesce(new.w2_received, 0) - coalesce(new.w3_received, 0),
    0
  );
  old_excess numeric := 0;
begin
  if tg_op = 'UPDATE' then
    old_excess := greatest(
      coalesce(old.w1_pulled, 0) + coalesce(old.w2_pulled, 0) + coalesce(old.w3_pulled, 0)
        - coalesce(old.opening_oh, 0)
        - coalesce(old.w1_received, 0) - coalesce(old.w2_received, 0) - coalesce(old.w3_received, 0),
      0
    );
  end if;

  if new_excess > old_excess then
    raise exception using
      errcode = 'check_violation',
      message = format(
        'Inventory over-pull rejected for item %s: this write would take the shortfall from %s to %s units',
        new.item_id, old_excess, new_excess
      );
  end if;
  return new;
end;
$$;

drop trigger if exists monthly_inventory_no_overpull on public.monthly_inventory;
create trigger monthly_inventory_no_overpull
before insert or update of opening_oh, w1_received, w2_received, w3_received,
  w1_pulled, w2_pulled, w3_pulled
on public.monthly_inventory
for each row execute function public.prevent_inventory_overpull();
