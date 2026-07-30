
-- STORAGE FIX 2: Create pending_changes table
-- Referenced heavily by Scan.tsx, ProposedChanges.tsx — was never created
CREATE TABLE IF NOT EXISTS pending_changes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  barcode_id  TEXT NOT NULL,
  field       TEXT NOT NULL,
  old_value   TEXT,
  new_value   TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','declined')),
  note        TEXT,
  created_by  UUID REFERENCES profiles(id),
  reviewed_by UUID REFERENCES profiles(id),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);

ALTER TABLE pending_changes ENABLE ROW LEVEL SECURITY;

-- Managers/admins see all; staff see only their own
CREATE POLICY "pending_select"
  ON pending_changes FOR SELECT
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin','manager','sudo')
    )
  );

-- Any authenticated user can insert their own proposed change
CREATE POLICY "pending_insert"
  ON pending_changes FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Only managers/admins can approve or decline
CREATE POLICY "pending_update"
  ON pending_changes FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin','manager','sudo')
    )
  );

CREATE POLICY "pending_delete"
  ON pending_changes FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin','manager','sudo')
    )
  );
;
