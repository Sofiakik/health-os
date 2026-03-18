-- Allow authenticated users to read only their own daily_health_summary rows.
-- Required for calendar WHOOP block; without this, RLS blocks all SELECTs (no policies = default deny).

CREATE POLICY "Users can read own daily health summaries"
ON public.daily_health_summary
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);
