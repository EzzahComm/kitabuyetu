BEGIN;
CREATE TABLE public.organization_website_artwork (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organization_websites(organization_id) ON DELETE CASCADE,
  alt text NOT NULL CHECK (length(alt) BETWEEN 1 AND 180),
  webp bytea NOT NULL CHECK (octet_length(webp) BETWEEN 1 AND 180000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX website_artwork_owner ON public.organization_website_artwork(organization_id,created_at);
ALTER TABLE public.organization_website_artwork ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organization_website_artwork FROM PUBLIC,anon,authenticated;
COMMIT;
