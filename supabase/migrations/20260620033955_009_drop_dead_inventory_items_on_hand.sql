-- Migration 009 — drop inventory_items.on_hand.
-- Confirmed dead: code comments state it is "not maintained" and monthly_inventory
-- is the real source of quantity. Only 1 stray non-zero row. live_inventory was
-- rebuilt off monthly_inventory in 008 and no longer references it.
ALTER TABLE public.inventory_items DROP COLUMN IF EXISTS on_hand;;
