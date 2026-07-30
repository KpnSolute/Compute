
-- Sheet 2: draft / PR sheet — batches waiting for manager approval
CREATE TABLE public.staging_area (
  id            uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id     uuid    NOT NULL REFERENCES public.centers(id),
  proposed_rows jsonb   NOT NULL DEFAULT '[]'::jsonb,
  status        text    NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'rejected')),
  source        text    DEFAULT 'manual',   -- 'xlsx_upload' | 'manual' | 'scanner_batch'
  submitted_by  uuid    REFERENCES auth.users(id),
  reviewed_by   uuid    REFERENCES auth.users(id),
  notes         text,
  created_at    timestamptz DEFAULT now(),
  reviewed_at   timestamptz
);

ALTER TABLE public.staging_area ENABLE ROW LEVEL SECURITY;

-- Corporate: global read-only
CREATE POLICY "staging_corporate_select"
  ON public.staging_area FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'corporate')
  );

-- Admin / Manager: full access (approve, reject, read all)
CREATE POLICY "staging_manager_all"
  ON public.staging_area FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role IN ('admin', 'manager'))
  );

-- Staff: can submit (INSERT) and read their own drafts
CREATE POLICY "staging_staff_insert"
  ON public.staging_area FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'staff')
    AND submitted_by = auth.uid()
  );

CREATE POLICY "staging_staff_select_own"
  ON public.staging_area FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'staff')
    AND submitted_by = auth.uid()
  );
;
