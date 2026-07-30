insert into cost_budgets (month, year, gov_allotment, planned_pull_amount, planned_reviewable_amount)
values (5, 2026, 32000, 29000, 3000)
on conflict (month, year) do update set gov_allotment = excluded.gov_allotment;;
