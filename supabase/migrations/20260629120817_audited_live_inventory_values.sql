CREATE OR REPLACE VIEW public.live_inventory
WITH (security_invoker = true)
AS
WITH per AS (
    SELECT
        COALESCE(
            (
                SELECT month
                FROM public.month_status
                WHERE status = 'open'
                ORDER BY year DESC, month DESC
                LIMIT 1
            ),
            (
                SELECT month
                FROM public.monthly_inventory
                ORDER BY year DESC, month DESC
                LIMIT 1
            )
        ) AS month,
        COALESCE(
            (
                SELECT year
                FROM public.month_status
                WHERE status = 'open'
                ORDER BY year DESC, month DESC
                LIMIT 1
            ),
            (
                SELECT year
                FROM public.monthly_inventory
                ORDER BY year DESC, month DESC
                LIMIT 1
            )
        ) AS year
),
current_rows AS (
    SELECT
        mi.*,
        GREATEST(
            0::numeric,
            COALESCE(mi.opening_oh, 0::numeric)
            + COALESCE(mi.w1_received, 0::numeric)
            + COALESCE(mi.w2_received, 0::numeric)
            + COALESCE(mi.w3_received, 0::numeric)
            - COALESCE(mi.w1_pulled, 0::numeric)
            - COALESCE(mi.w2_pulled, 0::numeric)
            - COALESCE(mi.w3_pulled, 0::numeric)
        ) AS ending_qty
    FROM public.monthly_inventory mi
    JOIN per ON per.month = mi.month AND per.year = mi.year
)
SELECT
    i.id,
    i.sku,
    i.description,
    c.name AS category,
    COALESCE(mi.unit_price, i.unit_price) AS unit_price,
    i.par_level,
    i.active AS is_active,
    bc.barcode AS barcode_id,
    COALESCE(mi.opening_oh, 0::numeric) AS opening_on_hand,
    COALESCE(mi.w1_received, 0::numeric) AS w1r,
    COALESCE(mi.w2_received, 0::numeric) AS w2r,
    COALESCE(mi.w3_received, 0::numeric) AS w3r,
    COALESCE(mi.w1_pulled, 0::numeric) AS w1p,
    COALESCE(mi.w2_pulled, 0::numeric) AS w2p,
    COALESCE(mi.w3_pulled, 0::numeric) AS w3p,
    COALESCE(mi.w1_received, 0::numeric)
        + COALESCE(mi.w2_received, 0::numeric)
        + COALESCE(mi.w3_received, 0::numeric) AS total_received,
    COALESCE(mi.w1_pulled, 0::numeric)
        + COALESCE(mi.w2_pulled, 0::numeric)
        + COALESCE(mi.w3_pulled, 0::numeric) AS total_pulled,
    COALESCE(mi.ending_qty, 0::numeric) AS on_hand,
    ROUND(
        COALESCE(
            mi.ending_value,
            GREATEST(
                0::numeric,
                COALESCE(mi.opening_value, 0::numeric)
                + COALESCE(mi.received_value, 0::numeric)
                - COALESCE(mi.pulled_value, 0::numeric)
            ),
            COALESCE(mi.ending_qty, 0::numeric) * COALESCE(mi.unit_price, i.unit_price, 0::numeric)
        ),
        2
    ) AS sub_total,
    GREATEST(0::numeric, i.par_level::numeric - COALESCE(mi.ending_qty, 0::numeric)) AS order_qty
FROM public.inventory_items i
LEFT JOIN public.inventory_categories c ON c.id = i.category_id
CROSS JOIN per
LEFT JOIN current_rows mi ON mi.item_id = i.id
LEFT JOIN LATERAL (
    SELECT b.barcode
    FROM public.item_barcodes b
    WHERE b.item_id = i.id
    ORDER BY b.is_primary DESC NULLS LAST
    LIMIT 1
) bc ON true
WHERE i.active = true;

COMMENT ON VIEW public.live_inventory IS
    'Open-period inventory view. on_hand is calculated ending quantity; sub_total prefers audited monthly_inventory.ending_value so workbook financial controls match dashboard/API totals.';
