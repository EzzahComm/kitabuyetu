-- Phase 3: KYC & Privacy RPCs
-- Migration ukoo_011: Profile claiming, consent, erasure, death verification

-- Claim a person (user asserts identity, spec §9.2)
create or replace function claim_profile(
  p_person_id uuid,
  p_user_id uuid
)
returns json as $$
declare
  v_person_record json;
begin
  update person set claimed_by = p_user_id, updated_at = now()
  where id = p_person_id;

  select row_to_json(person.*) into v_person_record from person where id = p_person_id;

  insert into audit_event (category, action, user_id, resource_id, after)
  values ('person', 'claim', p_user_id, p_person_id, v_person_record);

  return v_person_record;
end;
$$ language plpgsql security definer;

-- Record consent (GDPR, spec §8.3)
create or replace function record_consent(
  p_person_id uuid,
  p_purpose text,
  p_program_system text,
  p_program_ref text,
  p_granted_by uuid,
  p_method text,
  p_language text,
  p_copy_version text
)
returns json as $$
declare
  v_result json;
begin
  insert into consent_record (
    person_id, purpose, program_system, program_ref,
    granted_by, method, language, copy_version
  )
  values (p_person_id, p_purpose, p_program_system, p_program_ref,
          p_granted_by, p_method, p_language, p_copy_version)
  returning row_to_json(consent_record.*) into v_result;

  insert into audit_event (category, action, user_id, resource_id, after)
  values ('consent', 'grant', p_granted_by, p_person_id, v_result);

  return v_result;
end;
$$ language plpgsql security definer;

-- Withdraw consent (right to withdraw, spec §8.4)
create or replace function withdraw_consent(
  p_consent_record_id uuid,
  p_withdrawn_by uuid
)
returns void as $$
begin
  update consent_record set withdrawn_at = now() where id = p_consent_record_id;

  insert into audit_event (category, action, user_id, resource_id, after)
  values ('consent', 'withdraw', p_withdrawn_by, p_consent_record_id,
          json_build_object('withdrawn_at', now()));
end;
$$ language plpgsql security definer;

-- Request erasure (right to be forgotten, spec §8.6)
create or replace function request_erasure(
  p_person_id uuid,
  p_requested_by uuid,
  p_scope text,
  p_reason text
)
returns json as $$
declare
  v_result json;
begin
  -- Only subject can request full erasure
  if p_scope = 'full_tree' and p_person_id != (select claimed_by from person where id = p_person_id) then
    raise exception 'Only subject can request full tree erasure';
  end if;

  insert into erasure_request (person_id, requested_by, scope, status, reason)
  values (p_person_id, p_requested_by, p_scope, 'requested', p_reason)
  returning row_to_json(erasure_request.*) into v_result;

  insert into audit_event (category, action, user_id, resource_id, after)
  values ('erasure', 'request', p_requested_by, p_person_id, v_result);

  return v_result;
end;
$$ language plpgsql security definer;

-- Report death (user reports person dead, spec §9.6)
create or replace function report_death(
  p_person_id uuid,
  p_reported_by uuid,
  p_death_date timestamp with time zone
)
returns json as $$
declare
  v_result json;
  v_space_id uuid;
begin
  select space_id into v_space_id from person where id = p_person_id;

  if v_space_id is null then
    raise exception 'Person not found';
  end if;

  if not exists(
    select 1 from space_member
    where space_id = v_space_id and user_id = p_reported_by
  ) then
    raise exception 'Unauthorized: not a space member';
  end if;

  insert into death_report (person_id, state, reported_by, death_date_from_claim)
  values (p_person_id, 'reported', p_reported_by, p_death_date)
  returning row_to_json(death_report.*) into v_result;

  update person set death_state = 'reported', updated_at = now() where id = p_person_id;

  insert into audit_event (category, action, user_id, resource_id, after)
  values ('death_report', 'create', p_reported_by, p_person_id, v_result);

  return v_result;
end;
$$ language plpgsql security definer;

-- Confirm death (level-2 relative verifies, spec §9.6)
create or replace function confirm_death(
  p_person_id uuid,
  p_confirmed_by uuid
)
returns json as $$
declare
  v_report_id uuid;
  v_confirmation_count int;
  v_result json;
begin
  -- Get or create death report
  select id, confirmation_count into v_report_id, v_confirmation_count
  from death_report where person_id = p_person_id and state = 'reported'
  limit 1;

  if v_report_id is null then
    raise exception 'No death report to confirm';
  end if;

  -- Add confirmation
  update death_report
  set confirmation_count = v_confirmation_count + 1,
      confirmed_by = array_append(confirmed_by, p_confirmed_by),
      updated_at = now()
  where id = v_report_id;

  -- On second confirmation, verify
  if v_confirmation_count + 1 >= 2 then
    update death_report set state = 'verified' where id = v_report_id;
    update person set death_state = 'verified' where id = p_person_id;
  end if;

  select row_to_json(death_report.*) into v_result from death_report where id = v_report_id;

  insert into audit_event (category, action, user_id, resource_id, after)
  values ('death_report', 'confirm', p_confirmed_by, p_person_id, v_result);

  return v_result;
end;
$$ language plpgsql security definer;

-- Dispute death (relative disputes, reverses state)
create or replace function dispute_death(
  p_person_id uuid,
  p_disputed_by uuid
)
returns json as $$
declare
  v_result json;
begin
  update death_report
  set state = 'disputed', disputed_by = p_disputed_by, disputed_at = now()
  where person_id = p_person_id and state in ('reported', 'verified');

  update person set death_state = 'living' where id = p_person_id;

  select row_to_json(death_report.*) into v_result
  from death_report where person_id = p_person_id;

  insert into audit_event (category, action, user_id, resource_id, after)
  values ('death_report', 'dispute', p_disputed_by, p_person_id, v_result);

  return v_result;
end;
$$ language plpgsql security definer;
