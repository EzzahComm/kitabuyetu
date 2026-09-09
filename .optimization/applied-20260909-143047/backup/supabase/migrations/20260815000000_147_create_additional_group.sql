-- =============================================================================
-- 147: create_additional_group() — let an existing member found a SECOND
-- group under their existing identity, instead of the platform-wide
-- members.phone UNIQUE constraint dead-ending them.
--
-- register_group() (migration 140) is the public, unauthenticated signup
-- RPC — it always does an unconditional INSERT INTO members, correctly, since
-- every anonymous /register submission is assumed to be a brand-new person.
-- There has never been a path for an ALREADY-authenticated member to found or
-- join an additional group, even though group_members already fully supports
-- one member_id belonging to many groups (group-switcher.tsx / switch-group
-- already mint sessions across a member's existing memberships with no
-- password re-check).
--
-- This function is that path: authenticated-only (called with the caller's
-- OWN member_id, resolved server-side from their verified session, same
-- trust model as switch-group), reuses their existing member_id/person_id,
-- and only ever creates a NEW groups/group_member_counters/group_members/
-- group_officers/billing_accounts row (+ conditional chart-of-accounts seed).
-- Never touches members or person — there is nothing to insert there.
--
-- Deliberately a SEPARATE function from register_group(), not a shared
-- helper refactor. The duplicated group-creation steps below are bounded and
-- stable; reworking register_group() itself (the platform's most
-- safety-critical, most-tested RPC) for a marginal DRY win was not worth the
-- blast radius. See docs plan iterative-knitting-sutherland.md (2026-08-15).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_additional_group(p_member_id uuid, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- Input (group-only — person identity comes from the existing member row)
  v_group_name        TEXT;
  v_group_type        group_type;
  v_creator_role      officer_role;
  v_county_id         UUID;
  v_sub_county_text   TEXT;
  v_ward_text         TEXT;
  v_village_estate    TEXT;
  v_primary_objective primary_objective;
  v_meeting_frequency meeting_frequency;
  v_meeting_day       meeting_day;
  v_meeting_time      TIME;
  v_product           subscription_product;
  v_county_name       TEXT;

  -- Resolved from the caller's existing identity
  v_member_phone TEXT;
  v_member_email TEXT;
  v_first_name    TEXT;
  v_last_name     TEXT;
  v_platform_role platform_role;
  v_person_id     UUID;

  -- Output
  v_group_code TEXT;
  v_group_id   UUID;
  v_member_seq INT;
  v_member_code TEXT;
  v_group_role  member_role;
BEGIN
  v_group_name        := p_payload->>'groupName';
  v_group_type        := (p_payload->>'groupType')::group_type;
  v_creator_role       := (p_payload->>'creatorRole')::officer_role;
  v_county_id         := NULLIF(p_payload->>'countyId', '')::UUID;
  v_sub_county_text   := NULLIF(p_payload->>'subCountyText', '');
  v_ward_text         := NULLIF(p_payload->>'wardText', '');
  v_village_estate    := NULLIF(p_payload->>'villageEstate', '');
  v_primary_objective := NULLIF(p_payload->>'primaryObjective', '')::primary_objective;
  v_meeting_frequency := NULLIF(p_payload->>'meetingFrequency', '')::meeting_frequency;
  v_meeting_day       := NULLIF(p_payload->>'meetingDay', '')::meeting_day;
  v_meeting_time      := NULLIF(p_payload->>'meetingTime', '')::TIME;
  v_product           := COALESCE(NULLIF(p_payload->>'product', ''), 'kitabu_yetu')::subscription_product;

  IF v_group_name IS NULL OR length(trim(v_group_name)) < 3 THEN
    RAISE EXCEPTION 'group_name must be at least 3 characters' USING ERRCODE = '22023';
  END IF;
  IF v_creator_role NOT IN ('chairperson', 'secretary', 'treasurer') THEN
    RAISE EXCEPTION 'creator_role must be chairperson, secretary, or treasurer' USING ERRCODE = '22023';
  END IF;

  -- The caller must already be a real, active member with at least one
  -- active membership — this is what supplies both the group's contact
  -- phone/email and the person_id the new group_members row will reuse.
  -- p_member_id always comes from a verified JWT (see the route), so this is
  -- defensive rather than a real-world path, but the RPC is not the only
  -- caller a future session might add.
  SELECT m.phone, m.email, m.first_name, m.last_name, m.platform_role, gm.person_id
    INTO v_member_phone, v_member_email, v_first_name, v_last_name, v_platform_role, v_person_id
  FROM   members m
  JOIN   group_members gm ON gm.member_id = m.id AND gm.status = 'active'
  WHERE  m.id = p_member_id AND m.is_active = true
  ORDER  BY gm.created_at ASC
  LIMIT  1;

  IF v_person_id IS NULL THEN
    RAISE EXCEPTION 'No active member found to found a group from' USING ERRCODE = 'P0002';
  END IF;

  v_group_role := CASE v_creator_role
    WHEN 'chairperson' THEN 'chairperson'::member_role
    WHEN 'secretary'   THEN 'secretary'::member_role
    WHEN 'treasurer'   THEN 'treasurer'::member_role
  END;

  v_group_code := 'KY' || LPAD(NEXTVAL('group_seq')::text, 7, '0');

  IF v_county_id IS NOT NULL THEN
    SELECT name INTO v_county_name FROM counties WHERE id = v_county_id;
    IF v_county_name IS NULL THEN
      RAISE EXCEPTION 'county_id does not match any row in counties' USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO groups (
    name, "type", phone, email,
    status, group_code, creator_role,
    county_id, sub_county, ward,
    county, village_estate,
    primary_objective, meeting_frequency, meeting_day, meeting_time,
    signup_product
  ) VALUES (
    v_group_name, v_group_type, v_member_phone, v_member_email,
    'pending_verification', v_group_code, v_creator_role,
    v_county_id, v_sub_county_text, v_ward_text,
    v_county_name, v_village_estate,
    v_primary_objective, v_meeting_frequency, v_meeting_day, v_meeting_time,
    v_product
  )
  RETURNING id INTO v_group_id;

  INSERT INTO group_member_counters (group_id, last_seq) VALUES (v_group_id, 0);

  UPDATE group_member_counters
  SET    last_seq = last_seq + 1
  WHERE  group_id = v_group_id
  RETURNING last_seq INTO v_member_seq;

  v_member_code := v_group_code || LPAD(v_member_seq::text, 5, '0');

  -- Reuses the CALLER's existing member_id/person_id — the point of this
  -- function. No members or person row is ever inserted here.
  INSERT INTO group_members (
    group_id, member_id, person_id, member_code,
    role, status
  ) VALUES (
    v_group_id, p_member_id, v_person_id, v_member_code,
    v_group_role, 'active'
  );

  INSERT INTO group_officers (group_id, member_id, role, appointed_by)
  VALUES (v_group_id, p_member_id, v_creator_role, p_member_id);

  INSERT INTO billing_accounts (group_id) VALUES (v_group_id);

  -- Same conditional as register_group(): a Chama Reminder group has no
  -- contributions/loans/journals to post, so it gets no chart of accounts
  -- until (if ever) it also buys Kitabu Yetu.
  IF v_product = 'kitabu_yetu' THEN
    PERFORM seed_chart_of_accounts(v_group_id);
  END IF;

  RETURN jsonb_build_object(
    'success',        true,
    'group_id',       v_group_id,
    'group_code',     v_group_code,
    'group_name',     v_group_name,
    'group_status',   'pending_verification',
    'member_id',      p_member_id,
    'member_code',    v_member_code,
    'person_id',      v_person_id,
    'platform_role',  v_platform_role,
    'creator_role',   v_creator_role,
    'group_role',     v_group_role,
    'signup_product', v_product,
    -- The route has no local copy of these (unlike register_group()'s route,
    -- which has them straight from the request body) — it needs them to
    -- build the new session's `member` payload the client's login() expects.
    'first_name',     v_first_name,
    'last_name',      v_last_name,
    'phone',          v_member_phone,
    'email',          v_member_email
  );
END;
$function$;

-- Same posture as register_group()/link_member_to_group(): SECURITY DEFINER
-- and creates real tenant data, so PostgREST reachability by a self-registered
-- Supabase Auth user must stay impossible regardless of what CREATE OR REPLACE
-- resets — see feedback_create_or_replace_drops_grants.
REVOKE ALL ON FUNCTION public.create_additional_group(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_additional_group(uuid, jsonb) TO service_role;

-- app_tenant is provisioned out-of-band in production (ADR-001); a plain
-- fresh replay (CI's base "Tenant Isolation" job included) has no such role
-- at this point, and a bare GRANT would abort the whole migration.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.create_additional_group(uuid, jsonb) TO app_tenant';
  END IF;
END $do$;

COMMENT ON FUNCTION public.create_additional_group(uuid, jsonb) IS
  'Lets an ALREADY-authenticated member found an additional group under their '
  'existing identity (member_id/person_id reused, never re-inserted). Callable '
  'only via the withAuth-gated POST /api/v1/auth/create-group route — p_member_id '
  'must be the caller''s OWN verified id, resolved server-side, never client-supplied.';
