-- ─────────────────────────────────────────────────────────────────────────────
-- 098: link_member_to_group() — SECURITY DEFINER wrapper for the person /
-- group_member_counters / group_members writes lib/services/group-membership.ts
-- performs.
--
-- Context: docs/adr/001-bypassrls-two-role-split.md (ADR-001) Phase 1. `person`
-- and `group_member_counters` were deliberately built (migration 030) with NO
-- INSERT/UPDATE policy for any tenant-facing role — "Modifications go through
-- service-role (no policy granted)" — because `person` is a genuinely
-- cross-group identity table with no group_id to scope a real RLS boundary on.
--
-- That intent was never actually wired up: linkMemberToGroup() (called from
-- membersService.create() and the CSV bulk-import path — both real,
-- user-facing, tenant-context requests) writes to both tables directly over
-- whatever `client` it's handed, which today is the tenant connection. This
-- only ever worked because TENANT_DATABASE_URL is unset in every environment
-- so far, making the "tenant" pool and the BYPASSRLS admin pool the same
-- role (lib/db/index.ts's documented fallback). The app_tenant CI proof
-- (.github/workflows/ci.yml's db-integration job) caught this as a real
-- pre-cutover break: "add member" and CSV import would both fail outright
-- the moment app_tenant becomes real.
--
-- Fix: move the person-upsert + counter-allocate + group_members-insert
-- sequence into one SECURITY DEFINER function (same pattern already
-- established by register_group(), migration 032) so it keeps running with
-- the function owner's (postgres, BYPASSRLS) privileges regardless of the
-- caller's role — preserving migration 030's original trust boundary exactly
-- — while still executing inside the caller's already-open transaction, so
-- atomicity with the rest of membersService.create()'s writes is unchanged.
-- No new GRANT needed: scripts/ops/create-app-tenant-role.sql's blanket
-- `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public` (run after migrations
-- apply) and its `ALTER DEFAULT PRIVILEGES` already cover this function.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.link_member_to_group(
  p_member_id      uuid,
  p_group_id       uuid,
  p_role           member_role,
  p_first_name     text,
  p_last_name      text,
  p_phone          text DEFAULT NULL,
  p_national_id    text DEFAULT NULL,
  p_date_of_birth  date DEFAULT NULL,
  p_gender         gender DEFAULT NULL,
  p_joined_at      date DEFAULT NULL,
  p_invited_by     uuid DEFAULT NULL
)
RETURNS TABLE (
  group_members_id uuid,
  member_code      text,
  membership_no    text,
  person_id        uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_group_code    text;
  v_full_name     text;
  v_dob           date;
  v_person_id     uuid;
  v_last_seq      integer;
  v_member_code   text;
  v_gm_id         uuid;
  v_membership_no text;
BEGIN
  SELECT g.group_code INTO v_group_code FROM public.groups g WHERE g.id = p_group_id;
  IF v_group_code IS NULL THEN
    RAISE EXCEPTION 'Group % not found', p_group_id USING ERRCODE = 'no_data_found';
  END IF;

  v_full_name := trim(both ' ' from (p_first_name || ' ' || p_last_name));
  v_dob        := COALESCE(p_date_of_birth, '1970-01-01'::date);

  -- Upsert the cross-group person identity — mirrors linkMemberToGroup()'s
  -- original TS logic exactly. With a national_id, ON CONFLICT links to the
  -- existing row; without one, synthesise a placeholder so the NOT NULL +
  -- UNIQUE constraints hold.
  IF p_national_id IS NOT NULL THEN
    INSERT INTO public.person (national_id, full_name, dob, phone, gender)
    VALUES (p_national_id, v_full_name, v_dob, p_phone, p_gender)
    ON CONFLICT (national_id) DO UPDATE SET
      phone     = COALESCE(public.person.phone, EXCLUDED.phone),
      full_name = CASE WHEN public.person.full_name = '' THEN EXCLUDED.full_name ELSE public.person.full_name END
    RETURNING id INTO v_person_id;
  ELSE
    INSERT INTO public.person (national_id, full_name, dob, phone, gender)
    VALUES ('TEMP-' || gen_random_uuid()::text, v_full_name, v_dob, p_phone, p_gender)
    RETURNING id INTO v_person_id;
  END IF;

  -- Allocate the per-group sequential code. UPDATE acquires the row lock;
  -- INSERT-then-UPDATE seeds the counter for legacy/dev groups that
  -- pre-date migration 030.
  INSERT INTO public.group_member_counters (group_id, last_seq)
  VALUES (p_group_id, 0)
  ON CONFLICT (group_id) DO NOTHING;

  UPDATE public.group_member_counters
     SET last_seq = last_seq + 1
   WHERE group_id = p_group_id
   RETURNING last_seq INTO v_last_seq;

  IF v_last_seq IS NULL THEN
    RAISE EXCEPTION 'Group % has no member counter row', p_group_id USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  v_member_code := v_group_code || lpad(v_last_seq::text, 5, '0');

  -- The actual group_members link. membership_no is allocated by the
  -- existing BEFORE INSERT trigger (migration 056).
  INSERT INTO public.group_members (
    group_id, member_id, person_id, member_code,
    role, status, joined_at, invited_by
  ) VALUES (
    p_group_id, p_member_id, v_person_id, v_member_code,
    p_role, 'active'::member_status,
    COALESCE(p_joined_at, CURRENT_DATE), p_invited_by
  )
  -- Table-qualified: this function's own RETURNS TABLE columns are named
  -- member_code/membership_no too (implicitly declared as plpgsql variables
  -- from OUT params), which collide with the unqualified column names here
  -- and raise "column reference is ambiguous" otherwise.
  RETURNING group_members.id, group_members.membership_no INTO v_gm_id, v_membership_no;

  RETURN QUERY SELECT v_gm_id, v_member_code, v_membership_no, v_person_id;
END;
$$;

COMMENT ON FUNCTION public.link_member_to_group IS
  'SECURITY DEFINER — atomically upserts person, allocates the per-group member_code, and inserts group_members. Callable by app_tenant despite person/group_member_counters granting it no direct write policy, matching migration 030''s original "service-role writes only" intent for those two tables. See migration 098.';
