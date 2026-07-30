INSERT INTO app_settings (setting_key, setting_value) VALUES ('current_month', '"4"'), ('current_year', '"2026"') ON CONFLICT (setting_key) DO NOTHING;;
