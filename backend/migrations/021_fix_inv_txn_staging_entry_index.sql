-- Migration 021: Fix uq_inv_txn_staging_entry unique index
--
-- The original index (staging_entry_id alone) was too strict: one staging entry
-- legitimately produces multiple inventory_transactions rows (one per weekly column:
-- w1/w2/w3/w4 received/issued + week_number=0 aggregate pull). The single-column
-- uniqueness caused 23505 on the second row for any full-month staging entry.
--
-- Replace with a composite index on (staging_entry_id, item_id, week_number, txn_type)
-- which prevents true duplicate rows while allowing multi-row-per-entry writes.
-- The dispatch DELETE-before-INSERT already provides retry idempotency.

DROP INDEX IF EXISTS uq_inv_txn_staging_entry;

CREATE UNIQUE INDEX uq_inv_txn_staging_entry
    ON inventory_transactions (staging_entry_id, item_id, week_number, txn_type)
    WHERE staging_entry_id IS NOT NULL;
