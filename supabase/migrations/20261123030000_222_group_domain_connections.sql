BEGIN;
-- Remove the publishing entry point and grants. Retain prior business records
-- privately for installations that accepted enquiries before retiring the builder.
UPDATE public.organization_websites SET enabled=false, publication=NULL WHERE enabled OR publication IS NOT NULL;
DELETE FROM public.feature_flags WHERE key='websites_enabled';
DROP FUNCTION IF EXISTS public.get_published_organization_website(text);

CREATE TABLE public.group_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL UNIQUE REFERENCES public.groups(id) ON DELETE CASCADE,
  hostname text NOT NULL CHECK (length(hostname) BETWEEN 4 AND 253 AND hostname=lower(hostname)),
  challenge text NOT NULL,
  verified_until timestamptz,
  next_dns_check timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX group_domains_verified_host ON public.group_domains(hostname) WHERE verified_until IS NOT NULL;

CREATE TABLE public.group_domain_grants (
  code_hash text PRIMARY KEY,
  domain_id uuid NOT NULL REFERENCES public.group_domains(id) ON DELETE CASCADE,
  membership_id uuid NOT NULL REFERENCES public.group_members(id) ON DELETE CASCADE,
  auth_version integer NOT NULL,
  session_version integer NOT NULL,
  pkce text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('identity','group.read','meetings.write')),
  access_hash text UNIQUE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX group_domain_grants_expiry ON public.group_domain_grants(domain_id,expires_at);
ALTER TABLE public.group_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_domain_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.group_domains, public.group_domain_grants FROM PUBLIC,anon,authenticated;
COMMIT;
