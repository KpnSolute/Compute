-- Cost Manager's "amount taken out of the government budget" was previously
-- pulled_value + invoice net_total. Per clarification: what's actually taken
-- out of the allotment is inventory activity itself — received (delivered
-- this period) + pulled (drawn from stock and used) — both already tracked
-- in monthly_inventory. The app-level fix lives in backend/routes/cost.py
-- (_period_totals: total_spend = total_received + total_pulled).
--
-- This migration only widens the auto_source option on budget line items so
-- a manager can link a line item to the "Received" total directly, matching
-- the corrected model.

alter table budget_line_items
  drop constraint budget_line_items_auto_source_check,
  add constraint budget_line_items_auto_source_check
    check (auto_source in ('pulled','received','renewable','snack_bar_revenue'));
