-- Allow authenticated users to read only their own insight_dialogue rows.
-- Calendar loads dialogue by insight_id after loading daily_insights; RLS with no policies blocked all SELECTs.

CREATE POLICY "Users can read own insight dialogue"
ON public.insight_dialogue
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);
