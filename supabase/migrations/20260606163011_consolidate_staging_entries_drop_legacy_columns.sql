-- Consolidate staging_entries to the canonical entity_* model.
-- Drops 8 redundant legacy columns superseded by the new schema:
--   field           -> field_name
--   action          -> change_type
--   submitted_value -> new_value_text
--   previous_value  -> old_value_text
--   item_id/month/year/week_number -> entity_id + full_payload
-- Safe: table has 0 rows, no code writes these columns, no index/view depends on them.
-- Retained (actively used): entity_type, entity_id, field_name, old_value_text,
--   new_value_text, change_type, metadata, operation, full_payload, status,
--   submitted_by, reviewed_by, review_note, created_at, expires_at, reviewed_at,
--   source, file_ref, batch_id (the AI data-entry pipeline uses source/file_ref/batch_id).
ALTER TABLE public.staging_entries
  DROP COLUMN IF EXISTS field,
  DROP COLUMN IF EXISTS action,
  DROP COLUMN IF EXISTS submitted_value,
  DROP COLUMN IF EXISTS previous_value,
  DROP COLUMN IF EXISTS item_id,
  DROP COLUMN IF EXISTS month,
  DROP COLUMN IF EXISTS year,
  DROP COLUMN IF EXISTS week_number;;
