-- ────────────────────────────────────────────────────────────────────────
-- merge_single_staging
-- Validates, applies, snapshots, and archives a single staging entry.
-- Returns the new commit_id.
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION merge_single_staging(
  p_entry_id    UUID,
  p_reviewed_by UUID,
  p_review_note TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_entry      staging_entries%ROWTYPE;
  v_commit_id  UUID;
  v_snapshot   JSONB;
  v_summary    JSONB;
BEGIN
  SELECT * INTO v_entry
  FROM staging_entries
  WHERE entry_id = p_entry_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staging entry not found: %', p_entry_id
      USING HINT = 'Check that the entry_id exists in staging_entries';
  END IF;

  IF v_entry.status != 'pending' THEN
    RAISE EXCEPTION 'Staging entry % has status "%", expected "pending"',
      p_entry_id, v_entry.status;
  END IF;

  IF v_entry.expires_at < now() THEN
    RAISE EXCEPTION 'Staging entry % expired at %', p_entry_id, v_entry.expires_at;
  END IF;

  INSERT INTO commits (author_id, message, status, merged_by, merged_at)
  VALUES (
    p_reviewed_by,
    'Merged staging: ' || v_entry.item_id::TEXT
      || ' wk' || v_entry.week_number || ' ' || v_entry.field,
    'merged',
    p_reviewed_by,
    now()
  )
  RETURNING commit_id INTO v_commit_id;

  INSERT INTO commit_changes (commit_id, item_id, month, year, week_number,
                              field, old_value, new_value, action)
  VALUES (
    v_commit_id,
    v_entry.item_id,
    v_entry.month,
    v_entry.year,
    v_entry.week_number,
    v_entry.field,
    v_entry.previous_value,
    v_entry.submitted_value,
    v_entry.action
  );

  INSERT INTO monthly_inventory (item_id, month, year, on_hand,
                                 w1_received, w2_received, w3_received, w4_received,
                                 w1_issued,   w2_issued,   w3_issued,   w4_issued)
  VALUES (v_entry.item_id, v_entry.month, v_entry.year, 0,
          0, 0, 0, 0,
          0, 0, 0, 0)
  ON CONFLICT (item_id, month, year) DO NOTHING;

  UPDATE monthly_inventory
  SET
    w1_received = CASE WHEN v_entry.week_number = 1 AND v_entry.field = 'received'
                       THEN v_entry.submitted_value ELSE w1_received END,
    w2_received = CASE WHEN v_entry.week_number = 2 AND v_entry.field = 'received'
                       THEN v_entry.submitted_value ELSE w2_received END,
    w3_received = CASE WHEN v_entry.week_number = 3 AND v_entry.field = 'received'
                       THEN v_entry.submitted_value ELSE w3_received END,
    w4_received = CASE WHEN v_entry.week_number = 4 AND v_entry.field = 'received'
                       THEN v_entry.submitted_value ELSE w4_received END,
    w1_issued   = CASE WHEN v_entry.week_number = 1 AND v_entry.field = 'issued'
                       THEN v_entry.submitted_value ELSE w1_issued END,
    w2_issued   = CASE WHEN v_entry.week_number = 2 AND v_entry.field = 'issued'
                       THEN v_entry.submitted_value ELSE w2_issued END,
    w3_issued   = CASE WHEN v_entry.week_number = 3 AND v_entry.field = 'issued'
                       THEN v_entry.submitted_value ELSE w3_issued END,
    w4_issued   = CASE WHEN v_entry.week_number = 4 AND v_entry.field = 'issued'
                       THEN v_entry.submitted_value ELSE w4_issued END
  WHERE item_id = v_entry.item_id
    AND month   = v_entry.month
    AND year    = v_entry.year;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'item_id',      mi.item_id,
        'sku',          ii.sku,
        'description',  ii.description,
        'unit_price',   ii.unit_price,
        'par_level',    ii.par_level,
        'on_hand',      mi.on_hand,
        'w1_received',  mi.w1_received,
        'w2_received',  mi.w2_received,
        'w3_received',  mi.w3_received,
        'w4_received',  mi.w4_received,
        'w1_issued',    mi.w1_issued,
        'w2_issued',    mi.w2_issued,
        'w3_issued',    mi.w3_issued,
        'w4_issued',    mi.w4_issued
      )
    ),
    '[]'::JSONB
  ) INTO v_snapshot
  FROM monthly_inventory mi
  LEFT JOIN inventory_items ii ON mi.item_id = ii.id
  WHERE mi.month = v_entry.month
    AND mi.year  = v_entry.year;

  v_summary := jsonb_build_object(
    'total_items',  (SELECT count(*) FROM monthly_inventory
                     WHERE month = v_entry.month AND year = v_entry.year),
    'merged_at',    now(),
    'commit_id',    v_commit_id
  );

  INSERT INTO inventory_versions (snapshot_data, summary_data, created_by,
                                  message, month, year, commit_id)
  VALUES (
    jsonb_build_object('items', v_snapshot),
    v_summary,
    p_reviewed_by,
    'Auto-snapshot from commit ' || v_commit_id::TEXT,
    v_entry.month,
    v_entry.year,
    v_commit_id
  );

  INSERT INTO audit_log (table_name, record_id, action, old_values, new_values,
                         performed_by)
  VALUES (
    'monthly_inventory',
    v_entry.item_id,
    'UPDATE',
    jsonb_build_object(v_entry.field, v_entry.previous_value),
    jsonb_build_object(v_entry.field, v_entry.submitted_value),
    p_reviewed_by
  );

  DELETE FROM staging_entries WHERE entry_id = p_entry_id;

  RETURN v_commit_id;
END;
$$;


-- ────────────────────────────────────────────────────────────────────────
-- push_all_staging
-- Collects ALL pending staging entries and pushes them as a single commit.
-- Returns the new commit_id.
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION push_all_staging(
  p_reviewed_by UUID,
  p_message     TEXT,
  p_branch      TEXT DEFAULT 'main'
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_commit_id  UUID;
  v_entry      RECORD;
  v_snapshot   JSONB;
  v_summary    JSONB;
  v_ym_pair    RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM staging_entries
                 WHERE status = 'pending'
                   AND (expires_at IS NULL OR expires_at >= now()))
  THEN
    RAISE EXCEPTION 'No pending staging entries to push';
  END IF;

  INSERT INTO commits (author_id, message, branch, status, merged_by, merged_at)
  VALUES (p_reviewed_by, p_message, p_branch, 'merged', p_reviewed_by, now())
  RETURNING commit_id INTO v_commit_id;

  FOR v_entry IN
    SELECT * FROM staging_entries
    WHERE status = 'pending'
      AND (expires_at IS NULL OR expires_at >= now())
    ORDER BY created_at ASC
  LOOP
    INSERT INTO commit_changes (commit_id, item_id, month, year, week_number,
                                field, old_value, new_value, action)
    VALUES (
      v_commit_id,
      v_entry.item_id,
      v_entry.month,
      v_entry.year,
      v_entry.week_number,
      v_entry.field,
      v_entry.previous_value,
      v_entry.submitted_value,
      v_entry.action
    );

    INSERT INTO monthly_inventory (item_id, month, year, on_hand,
                                   w1_received, w2_received, w3_received, w4_received,
                                   w1_issued,   w2_issued,   w3_issued,   w4_issued)
    VALUES (v_entry.item_id, v_entry.month, v_entry.year, 0,
            0, 0, 0, 0,
            0, 0, 0, 0)
    ON CONFLICT (item_id, month, year) DO NOTHING;

    UPDATE monthly_inventory
    SET
      w1_received = CASE WHEN v_entry.week_number = 1 AND v_entry.field = 'received'
                         THEN v_entry.submitted_value ELSE w1_received END,
      w2_received = CASE WHEN v_entry.week_number = 2 AND v_entry.field = 'received'
                         THEN v_entry.submitted_value ELSE w2_received END,
      w3_received = CASE WHEN v_entry.week_number = 3 AND v_entry.field = 'received'
                         THEN v_entry.submitted_value ELSE w3_received END,
      w4_received = CASE WHEN v_entry.week_number = 4 AND v_entry.field = 'received'
                         THEN v_entry.submitted_value ELSE w4_received END,
      w1_issued   = CASE WHEN v_entry.week_number = 1 AND v_entry.field = 'issued'
                         THEN v_entry.submitted_value ELSE w1_issued END,
      w2_issued   = CASE WHEN v_entry.week_number = 2 AND v_entry.field = 'issued'
                         THEN v_entry.submitted_value ELSE w2_issued END,
      w3_issued   = CASE WHEN v_entry.week_number = 3 AND v_entry.field = 'issued'
                         THEN v_entry.submitted_value ELSE w3_issued END,
      w4_issued   = CASE WHEN v_entry.week_number = 4 AND v_entry.field = 'issued'
                         THEN v_entry.submitted_value ELSE w4_issued END
    WHERE item_id = v_entry.item_id
      AND month   = v_entry.month
      AND year    = v_entry.year;

    INSERT INTO audit_log (table_name, record_id, action, old_values, new_values,
                           performed_by)
    VALUES (
      'monthly_inventory',
      v_entry.item_id,
      'UPDATE',
      jsonb_build_object(v_entry.field, v_entry.previous_value),
      jsonb_build_object(v_entry.field, v_entry.submitted_value),
      p_reviewed_by
    );
  END LOOP;

  FOR v_ym_pair IN
    SELECT DISTINCT month, year
    FROM staging_entries
    WHERE status = 'pending'
      AND (expires_at IS NULL OR expires_at >= now())
  LOOP
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'item_id',      mi.item_id,
          'sku',          ii.sku,
          'description',  ii.description,
          'unit_price',   ii.unit_price,
          'par_level',    ii.par_level,
          'on_hand',      mi.on_hand,
          'w1_received',  mi.w1_received,
          'w2_received',  mi.w2_received,
          'w3_received',  mi.w3_received,
          'w4_received',  mi.w4_received,
          'w1_issued',    mi.w1_issued,
          'w2_issued',    mi.w2_issued,
          'w3_issued',    mi.w3_issued,
          'w4_issued',    mi.w4_issued
        )
      ),
      '[]'::JSONB
    ) INTO v_snapshot
    FROM monthly_inventory mi
    LEFT JOIN inventory_items ii ON mi.item_id = ii.id
    WHERE mi.month = v_ym_pair.month
      AND mi.year  = v_ym_pair.year;

    v_summary := jsonb_build_object(
      'total_items', (SELECT count(*) FROM monthly_inventory
                      WHERE month = v_ym_pair.month AND year = v_ym_pair.year),
      'merged_at',   now(),
      'commit_id',   v_commit_id
    );

    INSERT INTO inventory_versions (snapshot_data, summary_data, created_by,
                                    message, month, year, commit_id)
    VALUES (
      jsonb_build_object('items', v_snapshot),
      v_summary,
      p_reviewed_by,
      'Auto-snapshot from commit ' || v_commit_id::TEXT,
      v_ym_pair.month,
      v_ym_pair.year,
      v_commit_id
    );
  END LOOP;

  DELETE FROM staging_entries
  WHERE status = 'pending'
    AND (expires_at IS NULL OR expires_at >= now());

  RETURN v_commit_id;
END;
$$;


-- ────────────────────────────────────────────────────────────────────────
-- revert_to_commit
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION revert_to_commit(
  p_target_commit_id UUID,
  p_reverted_by      UUID
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_target      commits%ROWTYPE;
  v_version     inventory_versions%ROWTYPE;
  v_item        JSONB;
  v_old_row     monthly_inventory%ROWTYPE;
  v_changed     BOOLEAN;
  v_commit_id   UUID;
  v_snapshot    JSONB;
  v_summary     JSONB;
  v_month       INT;
  v_year        INT;
BEGIN
  SELECT * INTO v_target
  FROM commits
  WHERE commit_id = p_target_commit_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target commit not found: %', p_target_commit_id;
  END IF;

  IF v_target.status != 'merged' THEN
    RAISE EXCEPTION 'Cannot revert commit % with status "%"', p_target_commit_id, v_target.status;
  END IF;

  SELECT * INTO v_version
  FROM inventory_versions
  WHERE commit_id = p_target_commit_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No inventory snapshot found for commit %', p_target_commit_id;
  END IF;

  v_month := v_version.month;
  v_year  := v_version.year;

  INSERT INTO commits (author_id, message, status, parent_ids, merged_by, merged_at)
  VALUES (
    p_reverted_by,
    'Revert to ' || p_target_commit_id::TEXT,
    'merged',
    ARRAY[p_target_commit_id],
    p_reverted_by,
    now()
  )
  RETURNING commit_id INTO v_commit_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(
    v_version.snapshot_data -> 'items'
  )
  LOOP
    SELECT * INTO v_old_row
    FROM monthly_inventory
    WHERE item_id = (v_item ->> 'item_id')::UUID
      AND month   = v_month
      AND year    = v_year;

    v_changed := FALSE;

    INSERT INTO monthly_inventory (item_id, month, year, on_hand,
                                   w1_received, w2_received, w3_received, w4_received,
                                   w1_issued,   w2_issued,   w3_issued,   w4_issued)
    VALUES (
      (v_item ->> 'item_id')::UUID, v_month, v_year,
      COALESCE((v_item ->> 'on_hand')::NUMERIC, 0),
      COALESCE((v_item ->> 'w1_received')::NUMERIC, 0),
      COALESCE((v_item ->> 'w2_received')::NUMERIC, 0),
      COALESCE((v_item ->> 'w3_received')::NUMERIC, 0),
      COALESCE((v_item ->> 'w4_received')::NUMERIC, 0),
      COALESCE((v_item ->> 'w1_issued')::NUMERIC, 0),
      COALESCE((v_item ->> 'w2_issued')::NUMERIC, 0),
      COALESCE((v_item ->> 'w3_issued')::NUMERIC, 0),
      COALESCE((v_item ->> 'w4_issued')::NUMERIC, 0)
    )
    ON CONFLICT (item_id, month, year) DO UPDATE
    SET
      on_hand      = COALESCE((v_item ->> 'on_hand')::NUMERIC, 0),
      w1_received  = COALESCE((v_item ->> 'w1_received')::NUMERIC, 0),
      w2_received  = COALESCE((v_item ->> 'w2_received')::NUMERIC, 0),
      w3_received  = COALESCE((v_item ->> 'w3_received')::NUMERIC, 0),
      w4_received  = COALESCE((v_item ->> 'w4_received')::NUMERIC, 0),
      w1_issued    = COALESCE((v_item ->> 'w1_issued')::NUMERIC, 0),
      w2_issued    = COALESCE((v_item ->> 'w2_issued')::NUMERIC, 0),
      w3_issued    = COALESCE((v_item ->> 'w3_issued')::NUMERIC, 0),
      w4_issued    = COALESCE((v_item ->> 'w4_issued')::NUMERIC, 0);

    IF FOUND THEN
      INSERT INTO commit_changes (commit_id, item_id, month, year, week_number,
                                  field, old_value, new_value, action)
      VALUES (
        v_commit_id,
        (v_item ->> 'item_id')::UUID,
        v_month,
        v_year,
        1,
        'revert',
        COALESCE(v_old_row.on_hand, 0),
        COALESCE((v_item ->> 'on_hand')::NUMERIC, 0),
        'revert'
      );
    END IF;
  END LOOP;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'item_id',      mi.item_id,
        'sku',          ii.sku,
        'description',  ii.description,
        'unit_price',   ii.unit_price,
        'par_level',    ii.par_level,
        'on_hand',      mi.on_hand,
        'w1_received',  mi.w1_received,
        'w2_received',  mi.w2_received,
        'w3_received',  mi.w3_received,
        'w4_received',  mi.w4_received,
        'w1_issued',    mi.w1_issued,
        'w2_issued',    mi.w2_issued,
        'w3_issued',    mi.w3_issued,
        'w4_issued',    mi.w4_issued
      )
    ),
    '[]'::JSONB
  ) INTO v_snapshot
  FROM monthly_inventory mi
  LEFT JOIN inventory_items ii ON mi.item_id = ii.id
  WHERE mi.month = v_month
    AND mi.year  = v_year;

  v_summary := jsonb_build_object(
    'total_items', (SELECT count(*) FROM monthly_inventory
                    WHERE month = v_month AND year = v_year),
    'reverted_at', now(),
    'reverts_commit', p_target_commit_id
  );

  INSERT INTO inventory_versions (snapshot_data, summary_data, created_by,
                                  message, month, year, commit_id)
  VALUES (
    jsonb_build_object('items', v_snapshot),
    v_summary,
    p_reverted_by,
    'Revert snapshot from commit ' || p_target_commit_id::TEXT,
    v_month,
    v_year,
    v_commit_id
  );

  INSERT INTO audit_log (table_name, record_id, action, old_values, new_values,
                         performed_by)
  VALUES (
    'commits',
    p_target_commit_id,
    'REVERT',
    jsonb_build_object('target_commit', p_target_commit_id),
    jsonb_build_object('revert_commit', v_commit_id),
    p_reverted_by
  );

  RETURN v_commit_id;
END;
$$;


-- ────────────────────────────────────────────────────────────────────────
-- cleanup_expired_staging
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cleanup_expired_staging()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count INT;
BEGIN
  DELETE FROM staging_entries
  WHERE expires_at < now()
    AND status = 'pending';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;


-- ────────────────────────────────────────────────────────────────────────
-- Data migration: copy pending_submissions → staging_entries
-- ────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  INSERT INTO staging_entries (
    entry_id, item_id, month, year, week_number,
    field, action, submitted_value, previous_value,
    status, submitted_by, reviewed_by, review_note,
    created_at, expires_at, reviewed_at
  )
  SELECT
    ps.id,
    ps.item_id,
    ps.month,
    ps.year,
    CASE
      WHEN ps.field LIKE 'w1_%' THEN 1
      WHEN ps.field LIKE 'w2_%' THEN 2
      WHEN ps.field LIKE 'w3_%' THEN 3
      WHEN ps.field LIKE 'w4_%' THEN 4
      ELSE 1
    END,
    CASE
      WHEN ps.field LIKE '%_received' THEN 'received'
      WHEN ps.field LIKE '%_issued'  THEN 'issued'
      ELSE 'received'
    END,
    CASE WHEN ps.field LIKE '%_received' THEN 'pull' ELSE 'enter' END,
    ps.submitted_value,
    ps.previous_value,
    ps.status,
    ps.submitted_by,
    ps.reviewed_by,
    ps.review_note,
    ps.created_at,
    COALESCE(ps.created_at + INTERVAL '15 days', now() + INTERVAL '15 days'),
    ps.reviewed_at
  FROM pending_submissions ps
  WHERE NOT EXISTS (
    SELECT 1 FROM staging_entries se WHERE se.entry_id = ps.id
  );
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'pending_submissions table does not exist — skipping migration';
END;
$$;;
