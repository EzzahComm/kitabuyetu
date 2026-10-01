-- Phase 3: Privacy & Access Control
-- Migration ukoo_010: Privacy grants and consent tracking

-- Consent records (GDPR purposes, spec §8)
create table consent_record (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person(id) on delete cascade,
  purpose text not null check (purpose in (
    'profile', 'photo', 'clan_field', 'kitabu_link', 'public_memorial',
    'program_membership', 'program_contact', 'welfare_eligibility'
  )),
  program_system text,
  program_ref text,
  granted_by uuid not null,
  method text not null check (method in ('explicit', 'implicit', 'inferred')),
  language text default 'en',
  copy_version text,
  granted_at timestamp with time zone not null default now(),
  withdrawn_at timestamp with time zone,
  created_at timestamp with time zone not null default now()
);

create index consent_record_person_id on consent_record(person_id);
create index consent_record_purpose on consent_record(purpose);

-- Death reports (spec §9.6)
create table death_report (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person(id) on delete cascade,
  state text not null check (state in ('reported', 'verified', 'disputed')),
  reported_by uuid not null,
  reported_at timestamp with time zone not null default now(),
  death_date_from_claim timestamp with time zone,
  confirmation_count int default 0,
  confirmed_by uuid[],
  disputed_by uuid,
  disputed_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index death_report_person_id on death_report(person_id);
create index death_report_state on death_report(state);

-- Erasure requests (data subject rights, spec §8.6)
create table erasure_request (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person(id) on delete cascade,
  requested_by uuid not null,
  scope text not null check (scope in ('personal_data', 'all_except_skeleton', 'full_tree')),
  status text not null check (status in ('requested', 'processing', 'completed', 'denied')),
  reason text,
  requested_at timestamp with time zone not null default now(),
  completed_at timestamp with time zone,
  created_at timestamp with time zone not null default now()
);

create index erasure_request_person_id on erasure_request(person_id);
create index erasure_request_status on erasure_request(status);

-- Enable RLS
alter table consent_record enable row level security;
alter table death_report enable row level security;
alter table erasure_request enable row level security;

-- RLS Policies
create policy "Persons can view own consents"
  on consent_record for select
  using (person_id = (select claimed_by from person where id = person_id));

create policy "Custodians can view space consents"
  on consent_record for select
  using (person_id in (
    select p.id from person p
    join space_member sm on p.space_id = sm.space_id
    where sm.role = 'custodian'
  ));

create policy "Custodians can update death state"
  on death_report for update
  using (person_id in (
    select p.id from person p
    join space_member sm on p.space_id = sm.space_id
    where sm.role = 'custodian'
  ));
