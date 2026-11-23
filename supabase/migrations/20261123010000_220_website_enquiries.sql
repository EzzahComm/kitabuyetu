BEGIN;
CREATE TABLE public.organization_website_enquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organization_websites(organization_id) ON DELETE CASCADE,
  request_key uuid NOT NULL,
  sender_hash text NOT NULL,
  reply_email text NOT NULL CHECK (length(reply_email) <= 254),
  message text NOT NULL CHECK (length(message) BETWEEN 1 AND 1500),
  received_at timestamptz NOT NULL DEFAULT now(),
  handled_at timestamptz,
  UNIQUE(organization_id, request_key)
);
CREATE INDEX website_enquiries_recent ON public.organization_website_enquiries(organization_id,received_at DESC);
ALTER TABLE public.organization_website_enquiries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organization_website_enquiries FROM PUBLIC,anon,authenticated;
COMMIT;
