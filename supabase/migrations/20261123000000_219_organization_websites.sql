-- An organization gets early access only when a platform admin provisions its site.
-- The default-off flag is shared with the existing backoffice feature flag console.
BEGIN;
INSERT INTO public.feature_flags (key,name,description,enabled) VALUES
  ('websites_enabled','Organization websites','Enable provisioned organization websites and Website Studio',false)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE public.organization_websites (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE CHECK (length(slug) BETWEEN 2 AND 70 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  enabled boolean NOT NULL DEFAULT true,
  draft jsonb NOT NULL CHECK (jsonb_typeof(draft) = 'object'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  publication integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.organization_website_publications (
  organization_id uuid NOT NULL REFERENCES public.organization_websites(organization_id) ON DELETE CASCADE,
  revision integer NOT NULL,
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  published_by uuid NOT NULL REFERENCES public.members(id),
  published_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, revision)
);
ALTER TABLE public.organization_websites ADD FOREIGN KEY (organization_id,publication)
  REFERENCES public.organization_website_publications(organization_id,revision);

-- Both tables are server-owned. No client role may read drafts or write a publication.
ALTER TABLE public.organization_websites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_website_publications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organization_websites, public.organization_website_publications FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.get_published_organization_website(site_slug text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p.snapshot FROM public.organization_websites w
  JOIN public.organization_website_publications p ON (p.organization_id,p.revision) = (w.organization_id,w.publication)
  JOIN public.organizations o ON o.id = w.organization_id AND o.is_active
  WHERE w.slug = site_slug AND w.enabled AND EXISTS (
    SELECT 1 FROM public.feature_flags WHERE key = 'websites_enabled' AND enabled
      AND applies_to = 'all' AND rollout_pct = 100
  )
$$;
REVOKE ALL ON FUNCTION public.get_published_organization_website(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_published_organization_website(text) TO anon,authenticated;
COMMIT;
