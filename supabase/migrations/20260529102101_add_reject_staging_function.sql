CREATE OR REPLACE FUNCTION public.reject_staging(
  p_entry_id    uuid,
  p_reviewed_by uuid,
  p_note        text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  UPDATE public.staging_entries
  SET
    status      = 'rejected',
    reviewed_by = p_reviewed_by,
    review_note = p_note,
    reviewed_at = now()
  WHERE id = p_entry_id
    AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staging entry % not found or not in pending status', p_entry_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_staging(uuid, uuid, text) FROM PUBLIC, anon, authenticated;;
