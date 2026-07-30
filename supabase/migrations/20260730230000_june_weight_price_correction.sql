-- Correct June 2026's weight-billed chicken price, then re-carry into July.
--
-- SKU 2723641 (CHICKEN, 8 PC 14 HD) carried a June unit_price of 1.67 -- the
-- per-POUND rate applied to CASE quantities, the same weight-billing defect
-- fixed for July in v0.1.13. It is the only per-lb-priced June row holding
-- stock (3 cases), so it is the only one that reaches the July carry-forward.
--
-- THE PRICE COMES FROM JUNE'S OWN DATA, not from another month: June's stored
-- received_value of 1,674.41 over 20 cases received implies 83.7205 per case.
-- (Cross-check: May 86.0250, July 86.3207 -- same order, and June's stored
-- value column was already correct; only unit_price was wrong.)
--
-- The four other per-lb June rows (4527271, 5712666, 7416663, 8470437) each
-- have received_value == pulled_value and zero ending quantity, so their
-- unit_price does not affect June's close or the carry. They are left alone
-- rather than disturbed for cosmetics.
--
-- June is 'published' and guard_closed_month_writes blocks writes to any
-- non-open period. This reopens it, corrects it, and republishes it in ONE
-- transaction, so June is never observable in an open state and
-- published_at / published_by are preserved.
--
-- The corrected value columns are not written by hand: updating unit_price
-- fires enforce_monthly_inventory_value_standard (as fixed in
-- 20260730220000), which recomputes received/pulled/ending from the canonical
-- formula. Expected for June 2723641:
--     received 20 x 83.7205 = 1,674.41  (unchanged)
--     pulled   17 x 83.7205 = 1,423.25  (was 1,669.40, a legacy basis)
--     ending    3 x 83.7205 =   251.16  (was 5.01)
-- June close 9,505.58 -> 9,751.73, and July opening follows it.

BEGIN;

-- 1. reopen June
UPDATE public.month_status
SET status = 'open'
WHERE month = 5 AND year = 2026;

-- 2. correct the price; the valuation trigger recomputes the value columns
UPDATE public.monthly_inventory m
SET unit_price = round(
        m.received_value / NULLIF(m.w1_received + m.w2_received + m.w3_received, 0), 6)
FROM public.inventory_items ii
WHERE ii.id = m.item_id
  AND ii.sku = '2723641'
  AND m.month = 5 AND m.year = 2026
  AND m.unit_price < 20                                    -- only if still per-lb
  AND (m.w1_received + m.w2_received + m.w3_received) > 0;

-- 3. re-carry June's corrected closing cost into July's opening basis
UPDATE public.monthly_inventory jul
SET opening_unit_cost = jun.unit_price
FROM public.monthly_inventory jun, public.inventory_items ii
WHERE ii.id = jul.item_id
  AND ii.sku = '2723641'
  AND jun.item_id = jul.item_id
  AND jun.month = 5 AND jun.year = 2026
  AND jul.month = 6 AND jul.year = 2026
  AND COALESCE(jun.unit_price, 0) > 0
  AND jul.opening_oh > 0;

-- 4. republish June
UPDATE public.month_status
SET status = 'published'
WHERE month = 5 AND year = 2026;

COMMIT;
