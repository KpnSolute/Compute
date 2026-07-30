alter table cost_budgets
  drop column if exists planned_pull_amount,
  drop column if exists planned_reviewable_amount,
  add column if not exists w1_planned_pull numeric(12,2),
  add column if not exists w2_planned_pull numeric(12,2),
  add column if not exists w3_planned_pull numeric(12,2),
  add column if not exists w1_planned_renewable numeric(12,2),
  add column if not exists w2_planned_renewable numeric(12,2),
  add column if not exists w3_planned_renewable numeric(12,2);
;
