-- Recovered from supabase_migrations.schema_migrations (applied on production).
-- version: 20260606130000  name: 076_membership_roles
-- Statements as recorded by the Supabase CLI; original comments/formatting are not retained.

CREATE TABLE IF NOT EXISTS public.roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    uuid REFERENCES public.groups(id) ON DELETE CASCADE,
  code        text NOT NULL,
  name        text NOT NULL,
  description text,
  base_role   member_role NOT NULL,
  rank        int     NOT NULL DEFAULT 0,
  is_system   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roles_code_unique UNIQUE (group_id, code)
);
CREATE INDEX IF NOT EXISTS idx_roles_group ON public.roles (group_id);

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS roles_select ON public.roles;
CREATE POLICY roles_select ON public.roles
  FOR SELECT USING (group_id IS NULL OR group_id = app_current_group_id() OR is_super_admin());

INSERT INTO public.roles (group_id, code, name, description, base_role, rank, is_system)
SELECT v.group_id, v.code, v.name, v.description, v.base_role, v.rank, v.is_system
FROM (VALUES
  (NULL::uuid, 'member',      'Member',      'Standard group member',                      'member'::member_role,      20, true),
  (NULL::uuid, 'secretary',   'Secretary',   'Keeps records, manages members & meetings',  'secretary'::member_role,   40, true),
  (NULL::uuid, 'treasurer',   'Treasurer',   'Manages finances, contributions & loans',    'treasurer'::member_role,   60, true),
  (NULL::uuid, 'chairperson', 'Chairperson', 'Group administrator / chair',                'group_admin'::member_role, 80, true)
) AS v(group_id, code, name, description, base_role, rank, is_system)
WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE group_id IS NULL);

ALTER TABLE public.group_members
  ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES public.roles(id);
CREATE INDEX IF NOT EXISTS idx_group_members_role_id ON public.group_members (role_id);

UPDATE public.group_members gm
SET    role_id = r.id
FROM   public.roles r
WHERE  r.group_id IS NULL
  AND  r.base_role = gm.role
  AND  gm.role_id IS NULL;

CREATE OR REPLACE FUNCTION public.sync_group_member_role_id()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.role_id IS NULL THEN
    SELECT id INTO NEW.role_id
      FROM public.roles
     WHERE group_id IS NULL AND base_role = NEW.role
     LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_group_member_role_id ON public.group_members;
CREATE TRIGGER trg_sync_group_member_role_id
  BEFORE INSERT ON public.group_members
  FOR EACH ROW EXECUTE FUNCTION public.sync_group_member_role_id();
