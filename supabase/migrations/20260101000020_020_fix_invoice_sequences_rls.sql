-- Enable RLS on invoice_sequences (was the only table without it)
ALTER TABLE public.invoice_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY invoice_sequences_group_isolation ON public.invoice_sequences
  USING (group_id = current_setting('app.current_group_id', true)::uuid);
