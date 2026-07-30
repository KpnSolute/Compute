
-- Atomic merge RPC: executes Section 3.2 of the spec in a single transaction
-- Called by POST /api/v1/spreadsheet/merge/<stage_id>
-- Failure at any step rolls back everything
CREATE OR REPLACE FUNCTION public.execute_stage_merge(
  p_stage_id     uuid,
  p_performed_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stage        record;
  v_row          jsonb;
  v_barcode      text;
  v_qty          numeric;
  v_item_name    text;
  v_current_qty  numeric;
  v_new_qty      numeric;
  v_applied      integer := 0;
  v_skipped      integer := 0;
BEGIN
  -- Step 1: lock the stage row
  SELECT * INTO v_stage
  FROM public.staging_area
  WHERE id = p_stage_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Stage % not found', p_stage_id;
  END IF;

  IF v_stage.status != 'pending' THEN
    RAISE EXCEPTION 'Stage % is not pending (current status: %)', p_stage_id, v_stage.status;
  END IF;

  -- Step 2: UPSERT loop over proposed_rows
  FOR v_row IN
    SELECT value FROM jsonb_array_elements(v_stage.proposed_rows)
  LOOP
    v_barcode   := v_row->>'barcode';
    v_qty       := (v_row->>'quantity')::numeric;
    v_item_name := v_row->>'item_name';

    IF v_barcode IS NULL OR v_qty IS NULL THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- Lock target row in inventory_master
    SELECT quantity INTO v_current_qty
    FROM public.inventory_master
    WHERE center_id = v_stage.center_id AND barcode = v_barcode
    FOR UPDATE;

    IF FOUND THEN
      -- barcode exists: ADD quantity
      v_new_qty := v_current_qty + v_qty;
      IF v_new_qty < 0 THEN
        RAISE EXCEPTION
          'Barcode % quantity would go below zero (current: %, delta: %)',
          v_barcode, v_current_qty, v_qty;
      END IF;
      UPDATE public.inventory_master
      SET quantity = v_new_qty, updated_at = now()
      WHERE center_id = v_stage.center_id AND barcode = v_barcode;
    ELSE
      -- barcode is new: INSERT
      v_current_qty := 0;
      v_new_qty := v_qty;
      IF v_new_qty < 0 THEN
        RAISE EXCEPTION
          'Cannot insert barcode % with negative quantity (%)', v_barcode, v_qty;
      END IF;
      INSERT INTO public.inventory_master
        (center_id, barcode, item_name, quantity)
      VALUES
        (v_stage.center_id, v_barcode, COALESCE(v_item_name, 'Unknown'), v_new_qty);
    END IF;

    -- Step 3: log every change to transaction_history
    INSERT INTO public.transaction_history
      (center_id, barcode, item_name, action, quantity_change, quantity_after, stage_id, performed_by)
    VALUES
      (v_stage.center_id, v_barcode, v_item_name, 'merge', v_qty, v_new_qty, p_stage_id, p_performed_by);

    v_applied := v_applied + 1;
  END LOOP;

  -- Step 4: close the stage
  UPDATE public.staging_area
  SET
    status      = 'approved',
    reviewed_by = p_performed_by,
    reviewed_at = now()
  WHERE id = p_stage_id;

  RETURN jsonb_build_object(
    'stage_id', p_stage_id,
    'applied',  v_applied,
    'skipped',  v_skipped
  );
END;
$$;
;
