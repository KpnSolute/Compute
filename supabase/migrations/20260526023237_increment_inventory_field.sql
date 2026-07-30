CREATE OR REPLACE FUNCTION increment_inventory_field(
  p_item_id uuid,
  p_month   int,
  p_year    int,
  p_field   text,
  p_amount  numeric
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_field NOT IN ('w1_received', 'w2_received', 'w3_received', 'w4_received') THEN
    RAISE EXCEPTION 'Invalid field: %', p_field;
  END IF;

  INSERT INTO monthly_inventory (
    item_id, month, year,
    w1_received, w2_received, w3_received, w4_received,
    w1_issued,   w2_issued,   w3_issued,   w4_issued,
    on_hand
  )
  VALUES (
    p_item_id, p_month, p_year,
    CASE WHEN p_field = 'w1_received' THEN p_amount ELSE 0 END,
    CASE WHEN p_field = 'w2_received' THEN p_amount ELSE 0 END,
    CASE WHEN p_field = 'w3_received' THEN p_amount ELSE 0 END,
    CASE WHEN p_field = 'w4_received' THEN p_amount ELSE 0 END,
    0, 0, 0, 0,
    0
  )
  ON CONFLICT (item_id, month, year) DO UPDATE
    SET
      w1_received = monthly_inventory.w1_received
                    + CASE WHEN p_field = 'w1_received' THEN p_amount ELSE 0 END,
      w2_received = monthly_inventory.w2_received
                    + CASE WHEN p_field = 'w2_received' THEN p_amount ELSE 0 END,
      w3_received = monthly_inventory.w3_received
                    + CASE WHEN p_field = 'w3_received' THEN p_amount ELSE 0 END,
      w4_received = monthly_inventory.w4_received
                    + CASE WHEN p_field = 'w4_received' THEN p_amount ELSE 0 END;
END;
$$;;
