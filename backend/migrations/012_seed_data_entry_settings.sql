-- Data Entry operational floor and upload safety settings.
insert into public.app_settings (setting_key, setting_value, updated_at)
values (
  'data_entry',
  '{
    "floor_year": 2026,
    "floor_month": 4,
    "operational_week_count": 4,
    "calendar_rollover_rule": "days_after_28_to_next_month_w1",
    "allow_new_items_on_weekly": false,
    "max_file_size_mb": 10,
    "reconcile_max_delta_pct": 5.0
  }'::jsonb,
  now()
)
on conflict (setting_key) do update
set setting_value = public.app_settings.setting_value || excluded.setting_value,
    updated_at = now();
