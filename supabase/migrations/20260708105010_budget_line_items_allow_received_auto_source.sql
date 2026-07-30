alter table budget_line_items
  drop constraint budget_line_items_auto_source_check,
  add constraint budget_line_items_auto_source_check
    check (auto_source in ('pulled','received','renewable','snack_bar_revenue'));
;
