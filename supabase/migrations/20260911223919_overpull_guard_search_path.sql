-- Pin search_path on the over-pull guard.
--
-- The function shipped in 20260911115407_prevent_new_inventory_overpulls.sql
-- omitted it, which made it the only function in this database flagged by
-- Supabase's security advisor (function_search_path_mutable). Every other
-- function in the migration history sets it; this brings the guard in line.
--
-- Body is unchanged from that migration: reject a write only when it creates a
-- new over-pull or worsens an existing one, so the rows deliberately left
-- over-pulled stay writable for unrelated corrections.
create or replace function public.prevent_inventory_overpull()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
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
