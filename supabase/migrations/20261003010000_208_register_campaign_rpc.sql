-- =============================================================================
-- 208: register_campaign() — public, self-serve Changi$ha campaign creation
--
-- THE GAP
-- Campaign creation (campaigns.service.ts's createCampaign) requires an
-- authenticated tenant session with campaigns.manage (chairperson/treasurer/
-- secretary of an EXISTING group) — there was no path at all for someone with
-- no Kitabu Yetu account to start a fundraiser. app/fundraise/page.tsx's own
-- fallback copy ("talk to us about starting one for your group") confirmed
-- this: today, with no group, the only route in is contacting the platform
-- directly.
--
-- THE FIX
-- A single public RPC, same shape as register_group()/register_organization()
-- (SECURITY DEFINER, REVOKE FROM PUBLIC / GRANT TO postgres only, reached via
-- withAdminDb — never a direct anon/PostgREST grant): it registers a new
-- group (reusing register_group() itself rather than duplicating its person/
-- member/billing_accounts logic) with the caller as sole chairperson, then
-- creates the campaign directly in 'pending_review' status in the SAME
-- transaction — skipping the normal 'draft' stage entirely, since a one-shot
-- public form has nothing to iterate on before submitting.
--
-- group_type='welfare' / primary_objective='welfare' is the closest existing
-- fit for a single cause-based fundraiser (harambee), not a special case —
-- there is no "fundraising" group_type and inventing one is out of scope here.
--
-- DELIBERATELY UNCHANGED: the subscription gate. A group this RPC creates
-- starts with NO subscription, same as any other new group (migration 139 —
-- "every plan is paid"), and the campaign's own admin-review visibility does
-- not depend on it (SECURITY DEFINER writes the row directly, bypassing RLS
-- entirely for this one operation). The creator DOES need to subscribe
-- before they can log into the dashboard to manage the campaign afterward —
-- confirmed as the intended behavior, not a gap, before this was built.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.register_campaign(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Input — creator identity
  v_first_name       TEXT;
  v_last_name        TEXT;
  v_phone            TEXT;
  v_password_hash    TEXT;

  -- Input — campaign
  v_title              TEXT;
  v_story              TEXT;
  v_target_amount      NUMERIC;
  v_beneficiary_name   TEXT;
  v_beneficiary_consent BOOLEAN;
  v_cover_image_url    TEXT;
  v_ends_at            TIMESTAMPTZ;

  -- Input — payout destination
  v_payout_method       TEXT;
  v_payout_phone        TEXT;
  v_payout_shortcode    TEXT;
  v_payout_account      TEXT;
  v_payout_payee_name   TEXT;

  -- Working
  v_group_payload    JSONB;
  v_group_result     JSONB;
  v_group_id         UUID;
  v_member_id        UUID;
  v_group_code       TEXT;
  v_base_slug        TEXT;
  v_slug             TEXT;
  v_account_code     TEXT;
  v_alphabet         TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_campaign_id      UUID;
BEGIN
  -- ── Extract + cast payload ────────────────────────────────────────────────
  v_first_name    := p_payload->>'firstName';
  v_last_name     := p_payload->>'lastName';
  v_phone         := p_payload->>'phone';
  v_password_hash := p_payload->>'passwordHash';

  v_title              := p_payload->>'title';
  v_story              := p_payload->>'story';
  v_target_amount      := NULLIF(p_payload->>'targetAmount', '')::NUMERIC;
  v_beneficiary_name   := NULLIF(p_payload->>'beneficiaryName', '');
  v_beneficiary_consent := COALESCE((p_payload->>'beneficiaryConsentConfirmed')::BOOLEAN, false);
  v_cover_image_url    := NULLIF(p_payload->>'coverImageUrl', '');
  v_ends_at            := NULLIF(p_payload->>'endsAt', '')::TIMESTAMPTZ;

  v_payout_method     := p_payload->>'payoutMethod';
  v_payout_phone      := NULLIF(p_payload->>'payoutPhone', '');
  v_payout_shortcode  := NULLIF(p_payload->>'payoutShortcode', '');
  v_payout_account    := NULLIF(p_payload->>'payoutAccount', '');
  v_payout_payee_name := NULLIF(p_payload->>'payoutPayeeName', '');

  -- ── Required-field validation (defence in depth — the API route validates first) ─
  IF v_first_name IS NULL OR v_last_name IS NULL THEN
    RAISE EXCEPTION 'firstName and lastName are required' USING ERRCODE = '22023';
  END IF;
  IF v_phone IS NULL OR v_phone !~ '^254(7|1)[0-9]{8}$' THEN
    RAISE EXCEPTION 'phone must be E.164 Kenyan format (2547######## or 2541########)' USING ERRCODE = '22023';
  END IF;
  IF v_password_hash IS NULL OR length(v_password_hash) < 20 THEN
    RAISE EXCEPTION 'password_hash missing or too short' USING ERRCODE = '22023';
  END IF;
  IF v_title IS NULL OR length(trim(v_title)) < 3 THEN
    RAISE EXCEPTION 'title must be at least 3 characters' USING ERRCODE = '22023';
  END IF;
  IF v_story IS NULL OR length(trim(v_story)) < 20 THEN
    RAISE EXCEPTION 'story must be at least 20 characters' USING ERRCODE = '22023';
  END IF;
  IF v_target_amount IS NULL OR v_target_amount <= 0 OR v_target_amount > 50000000 THEN
    RAISE EXCEPTION 'targetAmount must be a positive number up to 50,000,000' USING ERRCODE = '22023';
  END IF;
  IF v_beneficiary_name IS NOT NULL AND NOT v_beneficiary_consent THEN
    RAISE EXCEPTION 'beneficiaryConsentConfirmed must be true when a beneficiary name is set' USING ERRCODE = '22023';
  END IF;

  IF v_payout_method NOT IN ('phone', 'paybill', 'till') THEN
    RAISE EXCEPTION 'payoutMethod must be phone, paybill, or till' USING ERRCODE = '22023';
  END IF;
  IF v_payout_method = 'phone' THEN
    IF v_payout_phone IS NULL OR v_payout_phone !~ '^254(7|1)[0-9]{8}$' THEN
      RAISE EXCEPTION 'payoutPhone must be E.164 Kenyan format when payoutMethod is phone' USING ERRCODE = '22023';
    END IF;
    v_payout_shortcode := NULL; v_payout_account := NULL; v_payout_payee_name := NULL;
  ELSIF v_payout_method = 'paybill' THEN
    IF v_payout_shortcode IS NULL OR v_payout_shortcode !~ '^[0-9]{5,7}$' THEN
      RAISE EXCEPTION 'payoutShortcode must be 5-7 digits for a paybill' USING ERRCODE = '22023';
    END IF;
    IF v_payout_account IS NULL OR length(v_payout_account) < 1 OR length(v_payout_account) > 20 THEN
      RAISE EXCEPTION 'payoutAccount is required (max 20 characters) for a paybill' USING ERRCODE = '22023';
    END IF;
    IF v_payout_payee_name IS NULL OR length(trim(v_payout_payee_name)) < 2 THEN
      RAISE EXCEPTION 'payoutPayeeName must be at least 2 characters for a paybill' USING ERRCODE = '22023';
    END IF;
    v_payout_phone := NULL;
  ELSE -- till
    IF v_payout_shortcode IS NULL OR v_payout_shortcode !~ '^[0-9]{5,7}$' THEN
      RAISE EXCEPTION 'payoutShortcode must be 5-7 digits for a till' USING ERRCODE = '22023';
    END IF;
    IF v_payout_payee_name IS NULL OR length(trim(v_payout_payee_name)) < 2 THEN
      RAISE EXCEPTION 'payoutPayeeName must be at least 2 characters for a till' USING ERRCODE = '22023';
    END IF;
    v_payout_phone := NULL; v_payout_account := NULL;
  END IF;

  -- ── Register the group the campaign will live under ──────────────────────
  -- The campaign's own title doubles as the group name: this group exists
  -- only to host this one fundraiser, so there is no separate name to ask for.
  v_group_payload := jsonb_build_object(
    'groupName',    v_title,
    'groupType',    'welfare',
    'firstName',    v_first_name,
    'lastName',     v_last_name,
    'phone',        v_phone,
    'passwordHash', v_password_hash,
    'creatorRole',  'chairperson',
    'primaryObjective', 'welfare',
    'product',      'kitabu_yetu'
  );
  v_group_result := register_group(v_group_payload);
  v_group_id   := (v_group_result->>'group_id')::UUID;
  v_member_id  := (v_group_result->>'member_id')::UUID;
  v_group_code := v_group_result->>'group_code';

  -- ── Unique slug (mirrors campaigns.service.ts's uniqueSlug) ──────────────
  v_base_slug := regexp_replace(lower(trim(v_title)), '[^a-z0-9]+', '-', 'g');
  v_base_slug := trim(both '-' from v_base_slug);
  IF v_base_slug = '' THEN v_base_slug := 'campaign'; END IF;
  v_base_slug := left(v_base_slug, 80);
  v_slug := v_base_slug;
  FOR i IN 1..20 LOOP
    EXIT WHEN NOT EXISTS (SELECT 1 FROM campaigns WHERE slug = v_slug);
    v_slug := left(v_base_slug, 76) || '-' || (i + 1);
  END LOOP;

  -- ── Unique account_code (mirrors campaigns.service.ts's uniqueAccountCode) ─
  FOR i IN 1..20 LOOP
    v_account_code := 'CH';
    FOR j IN 1..6 LOOP
      v_account_code := v_account_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM campaigns WHERE account_code = v_account_code);
  END LOOP;

  -- ── Create the campaign, already submitted for review ────────────────────
  -- Straight to 'pending_review', not 'draft' — a one-shot public form has no
  -- later editing session to submit from, unlike the authenticated dashboard
  -- flow (createCampaign -> setPayoutDestination -> submitForReview).
  INSERT INTO campaigns (
    group_id, title, slug, account_code, story, beneficiary_name,
    target_amount, cover_image_url, ends_at, created_by, status,
    payout_method, payout_phone, payout_shortcode, payout_account, payout_payee_name
  ) VALUES (
    v_group_id, v_title, v_slug, v_account_code, v_story, v_beneficiary_name,
    v_target_amount, v_cover_image_url, v_ends_at, v_member_id, 'pending_review',
    v_payout_method, v_payout_phone, v_payout_shortcode, v_payout_account, v_payout_payee_name
  )
  RETURNING id INTO v_campaign_id;

  INSERT INTO audit_logs (group_id, actor_id, action, resource_type, resource_id, new_values)
  VALUES (
    v_group_id, v_member_id, 'campaign.register_self_serve', 'campaign', v_campaign_id,
    jsonb_build_object('title', v_title, 'targetAmount', v_target_amount, 'status', 'pending_review')
  );

  RETURN jsonb_build_object(
    'success',       true,
    'group_id',      v_group_id,
    'group_code',    v_group_code,
    'member_id',     v_member_id,
    'campaign_id',   v_campaign_id,
    'campaign_slug', v_slug,
    'account_code',  v_account_code,
    'status',        'pending_review'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.register_campaign(JSONB) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.register_campaign(JSONB) TO postgres;
