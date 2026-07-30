-- Reject impossible physical pulls at the database boundary. The API and UI
-- validate earlier for useful messages; this trigger is the final backstop.
create or replace function public.prevent_inventory_overpull()
returns trigger
language plpgsql
as $$
declare
  available numeric := coalesce(new.opening_oh, 0)
    + coalesce(new.w1_received, 0)
    + coalesce(new.w2_received, 0)
    + coalesce(new.w3_received, 0);
  pulled numeric := coalesce(new.w1_pulled, 0)
    + coalesce(new.w2_pulled, 0)
    + coalesce(new.w3_pulled, 0);
begin
  if pulled > available then
    raise exception using
      errcode = 'check_violation',
      message = format(
        'Inventory over-pull rejected for item %s: requested %s, available %s',
        new.item_id, pulled, available
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
