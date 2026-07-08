-- Cost Manager: planned pull/renewable spend becomes a per-week target
-- (Wk1/Wk2/Wk3) instead of a single monthly figure, matching this app's
-- existing three-week inventory period convention (monthly_inventory's
-- w1/w2/w3_received / w1/w2/w3_pulled). Table had zero real rows at the
-- time of this change (no manager had saved a budget yet), so the old
-- single-value columns are dropped rather than migrated.

alter table cost_budgets
  drop column if exists planned_pull_amount,
  drop column if exists planned_reviewable_amount,
  add column if not exists w1_planned_pull numeric(12,2),
  add column if not exists w2_planned_pull numeric(12,2),
  add column if not exists w3_planned_pull numeric(12,2),
  add column if not exists w1_planned_renewable numeric(12,2),
  add column if not exists w2_planned_renewable numeric(12,2),
  add column if not exists w3_planned_renewable numeric(12,2);
