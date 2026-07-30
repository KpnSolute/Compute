
-- Sheet 3: immutable audit ledger
-- Rule: NEVER UPDATE or DELETE rows here — append only
-- quantity_change stores the delta (+N or -N), not the final sum
CREATE TABLE public.transaction_history (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id       uuid    NOT NULL REFERENCES public.centers(id),
  barcode         text    NOT NULL,
  item_name       text,
  action          text    NOT NULL
                          CHECK (action IN ('scan_in', 'scan_out', 'merge', 'adjustment', 'rollover')),
  quantity_change numeric NOT NULL,   -- delta: +50 received, -10 issued
  quantity_after  numeric,            -- snapshot of quantity after the change
  stage_id        uuid    REFERENCES public.staging_area(id),  -- set for 'merge' actions
  performed_by    uuid    REFERENCES auth.users(id),
  created_at      timestamptz DEFAULT now()
  -- intentionally no updated_at: this table is append-only
);

-- Prevent any UPDATE or DELETE at the DB level via a trigger
CREATE OR REPLACE FUNCTION public.block_txn_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'transaction_history is append-only — UPDATE and DELETE are not permitted';
END;
$$;

CREATE TRIGGER txn_history_no_update
  BEFORE UPDATE ON public.transaction_history
  FOR EACH ROW EXECUTE FUNCTION public.block_txn_history_mutation();

CREATE TRIGGER txn_history_no_delete
  BEFORE DELETE ON public.transaction_history
  FOR EACH ROW EXECUTE FUNCTION public.block_txn_history_mutation();

ALTER TABLE public.transaction_history ENABLE ROW LEVEL SECURITY;

-- Corporate: global read
CREATE POLICY "txn_corporate_select"
  ON public.transaction_history FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'corporate')
  );

-- Admin / Manager: read + insert only
CREATE POLICY "txn_manager_select"
  ON public.transaction_history FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role IN ('admin', 'manager'))
  );

CREATE POLICY "txn_manager_insert"
  ON public.transaction_history FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role IN ('admin', 'manager'))
  );

-- Staff: insert (scanner) + read
CREATE POLICY "txn_staff_insert"
  ON public.transaction_history FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'staff')
  );

CREATE POLICY "txn_staff_select"
  ON public.transaction_history FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'staff')
  );
;
