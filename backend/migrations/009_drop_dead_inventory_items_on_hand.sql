-- Migration 009 — drop inventory_items.on_hand (2026-06-19).
-- Dead column: code documents it as "not maintained"; monthly_inventory is the
-- real quantity source. live_inventory was rebuilt off monthly_inventory in 008.
ALTER TABLE public.inventory_items DROP COLUMN IF EXISTS on_hand;
