
-- STORAGE FIX 1: Add missing w2r, w3r, w4r to barcodes
-- (w1r existed; the migration file was written but never applied)
ALTER TABLE barcodes ADD COLUMN IF NOT EXISTS w2r numeric(10,2) DEFAULT 0;
ALTER TABLE barcodes ADD COLUMN IF NOT EXISTS w3r numeric(10,2) DEFAULT 0;
ALTER TABLE barcodes ADD COLUMN IF NOT EXISTS w4r numeric(10,2) DEFAULT 0;

-- Backfill NULLs to 0
UPDATE barcodes SET w2r = 0 WHERE w2r IS NULL;
UPDATE barcodes SET w3r = 0 WHERE w3r IS NULL;
UPDATE barcodes SET w4r = 0 WHERE w4r IS NULL;
;
