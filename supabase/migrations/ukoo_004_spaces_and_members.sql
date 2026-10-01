-- Phase 0: Ukoo Yetu initialization
-- Migration ukoo_004: Spaces members and permissions

-- Space members (users in a family group)
create table space_member (
  space_id uuid not null references space(id) on delete cascade,
  user_id uuid not null,
  role space_role not null default 'member',
  person_id uuid references person(id) on delete set null,
  joined_at timestamp with time zone not null default now(),
  primary key (space_id, user_id)
);

create index space_member_user_id on space_member(user_id);
create index space_member_person_id on space_member(person_id);

-- Person access grants (who can view which persons)
create table person_grant (
  person_id uuid not null references person(id) on delete cascade,
  user_id uuid not null,
  scope text not null check (scope in ('subject', 'custodian', 'editor')),
  granted_at timestamp with time zone not null default now(),
  primary key (person_id, user_id)
);

create index person_grant_user_id on person_grant(user_id);

-- Space invitations
create table space_invite (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references space(id) on delete cascade,
  token text not null unique,
  email text,
  phone text,
  role space_role not null default 'member',
  created_by uuid not null,
  expires_at timestamp with time zone,
  accepted_by uuid,
  accepted_at timestamp with time zone,
  created_at timestamp with time zone not null default now()
);

create index space_invite_space_id on space_invite(space_id);
create index space_invite_token on space_invite(token);

-- Enable RLS
alter table space_member enable row level security;
alter table person_grant enable row level security;
alter table space_invite enable row level security;
