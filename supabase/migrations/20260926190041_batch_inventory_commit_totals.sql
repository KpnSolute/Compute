-- Verified read-only against mgvyylvmkxhhataavqjz on 2026-09-26.
-- Additive RPCs only. Existing row/statement triggers remain authoritative.
CREATE FUNCTION public.recompute_week_totals_batch(
    p_tenant_id uuid, p_item_ids uuid[], p_month int, p_year int
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
BEGIN
    IF p_tenant_id IS NULL OR p_item_ids IS NULL
       OR p_month IS NULL OR p_month NOT BETWEEN 0 AND 11 OR p_year IS NULL THEN
        RAISE EXCEPTION 'Tenant, item array and valid period are required' USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
        SELECT 1 FROM unnest(p_item_ids) AS requested(item_id)
        WHERE NOT EXISTS (
            SELECT 1 FROM public.inventory_items AS i
            WHERE i.tenant_id = p_tenant_id AND i.id = requested.item_id
        )
    ) THEN
        RAISE EXCEPTION 'Inventory item is not part of the active workspace' USING ERRCODE = '22023';
    END IF;

    WITH requested AS (
        SELECT DISTINCT item_id FROM unnest(p_item_ids) AS ids(item_id)
    ), totals AS (
        SELECT t.item_id,
            COALESCE(SUM(t.quantity) FILTER (WHERE t.week_number = 1 AND t.txn_type IN ('received', 'adjustment_increase')), 0) AS w1_received,
            COALESCE(SUM(t.quantity) FILTER (WHERE t.week_number = 2 AND t.txn_type IN ('received', 'adjustment_increase')), 0) AS w2_received,
            COALESCE(SUM(t.quantity) FILTER (WHERE t.week_number = 3 AND t.txn_type IN ('received', 'adjustment_increase')), 0) AS w3_received,
            COALESCE(SUM(t.quantity) FILTER (WHERE t.week_number = 1 AND t.txn_type IN ('issued', 'adjustment_decrease')), 0) AS w1_pulled,
            COALESCE(SUM(t.quantity) FILTER (WHERE t.week_number = 2 AND t.txn_type IN ('issued', 'adjustment_decrease')), 0) AS w2_pulled,
            COALESCE(SUM(t.quantity) FILTER (WHERE t.week_number = 3 AND t.txn_type IN ('issued', 'adjustment_decrease')), 0) AS w3_pulled
        FROM public.inventory_transactions AS t
        JOIN requested AS r ON r.item_id = t.item_id
        WHERE t.tenant_id = p_tenant_id AND t.month = p_month AND t.year = p_year
        GROUP BY t.item_id
    )
    INSERT INTO public.monthly_inventory AS current_row (
        tenant_id, item_id, month, year, opening_oh, unit_price,
        w1_received, w2_received, w3_received, w1_pulled, w2_pulled, w3_pulled
    )
    SELECT p_tenant_id, r.item_id, p_month, p_year,
        COALESCE(m.opening_oh, 0), COALESCE(NULLIF(i.unit_price, 0), 0),
        COALESCE(t.w1_received, 0), COALESCE(t.w2_received, 0), COALESCE(t.w3_received, 0),
        COALESCE(t.w1_pulled, 0), COALESCE(t.w2_pulled, 0), COALESCE(t.w3_pulled, 0)
    FROM requested AS r
    JOIN public.inventory_items AS i ON i.id = r.item_id AND i.tenant_id = p_tenant_id
    LEFT JOIN public.monthly_inventory AS m
        ON m.item_id = r.item_id AND m.tenant_id = p_tenant_id AND m.month = p_month AND m.year = p_year
    LEFT JOIN totals AS t ON t.item_id = r.item_id
    ON CONFLICT (tenant_id, item_id, month, year) DO UPDATE SET
        w1_received = EXCLUDED.w1_received,
        w2_received = EXCLUDED.w2_received,
        w3_received = EXCLUDED.w3_received,
        w1_pulled = EXCLUDED.w1_pulled,
        w2_pulled = EXCLUDED.w2_pulled,
        w3_pulled = EXCLUDED.w3_pulled,
        opening_oh = current_row.opening_oh,
        unit_price = CASE WHEN current_row.unit_price IS NULL OR current_row.unit_price = 0
            THEN EXCLUDED.unit_price ELSE current_row.unit_price END,
        updated_at = now();
END;
$function$;

CREATE FUNCTION public.settle_inventory_values_batch(
    p_tenant_id uuid, p_month int, p_year int, p_updates jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $function$
DECLARE
    affected_rows bigint;
BEGIN
    IF p_tenant_id IS NULL OR p_month IS NULL OR p_month NOT BETWEEN 0 AND 11 OR p_year IS NULL THEN
        RAISE EXCEPTION 'Tenant and valid period are required' USING ERRCODE = '22023';
    END IF;
    IF p_updates IS NULL OR jsonb_typeof(p_updates) <> 'array' THEN
        RAISE EXCEPTION 'Updates must be a JSON array' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_updates) AS u(value)
        WHERE jsonb_typeof(u.value) <> 'object'
           OR jsonb_typeof(u.value -> 'item_id') IS DISTINCT FROM 'string'
    ) THEN
        RAISE EXCEPTION 'Each update must be an object with an item_id string' USING ERRCODE = '22023';
    END IF;
    -- Fixed allowlist, numeric/null values only; never interpolate column names.
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_updates) AS u(value)
        CROSS JOIN LATERAL jsonb_each(u.value) AS kv(key, value)
        WHERE kv.key NOT IN ('item_id', 'opening_unit_cost', 'opening_value', 'received_value', 'pulled_value', 'ending_value')
           OR (kv.key <> 'item_id' AND jsonb_typeof(kv.value) NOT IN ('number', 'null'))
    ) THEN
        RAISE EXCEPTION 'Unsupported update key or nonnumeric value' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
        SELECT (u.value ->> 'item_id')::uuid
        FROM jsonb_array_elements(p_updates) AS u(value)
        GROUP BY (u.value ->> 'item_id')::uuid HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'Duplicate item_id in updates' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_updates) AS u(value)
        WHERE NOT EXISTS (
            SELECT 1 FROM public.monthly_inventory AS m
            JOIN public.inventory_items AS i ON i.id = m.item_id AND i.tenant_id = m.tenant_id
            WHERE m.tenant_id = p_tenant_id AND m.month = p_month AND m.year = p_year
                AND m.item_id = (u.value ->> 'item_id')::uuid
        )
    ) THEN
        RAISE EXCEPTION 'Update must match an existing monthly row in the active workspace' USING ERRCODE = '22023';
    END IF;

    UPDATE public.monthly_inventory AS m SET
        opening_unit_cost = CASE WHEN u.value ? 'opening_unit_cost' THEN (u.value ->> 'opening_unit_cost')::numeric ELSE m.opening_unit_cost END,
        opening_value = CASE WHEN u.value ? 'opening_value' THEN (u.value ->> 'opening_value')::numeric ELSE m.opening_value END,
        received_value = CASE WHEN u.value ? 'received_value' THEN (u.value ->> 'received_value')::numeric ELSE m.received_value END,
        pulled_value = CASE WHEN u.value ? 'pulled_value' THEN (u.value ->> 'pulled_value')::numeric ELSE m.pulled_value END,
        ending_value = CASE WHEN u.value ? 'ending_value' THEN (u.value ->> 'ending_value')::numeric ELSE m.ending_value END
    FROM jsonb_array_elements(p_updates) AS u(value)
    WHERE m.tenant_id = p_tenant_id AND m.month = p_month AND m.year = p_year
        AND m.item_id = (u.value ->> 'item_id')::uuid
        AND EXISTS (SELECT 1 FROM public.inventory_items AS i WHERE i.id = m.item_id AND i.tenant_id = p_tenant_id);
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    -- A concurrent delete after validation must fail atomically, not silently skip a row.
    IF affected_rows <> jsonb_array_length(p_updates) THEN
        RAISE EXCEPTION 'Monthly rows changed during settlement; retry' USING ERRCODE = '40001';
    END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.recompute_week_totals_batch(uuid, uuid[], int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_week_totals_batch(uuid, uuid[], int, int) TO service_role;
REVOKE ALL ON FUNCTION public.settle_inventory_values_batch(uuid, int, int, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_inventory_values_batch(uuid, int, int, jsonb) TO service_role;
