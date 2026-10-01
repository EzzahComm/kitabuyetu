-- Phase 0: Ukoo Yetu initialization
-- Migration ukoo_002: Person, names, places, and life events tables

-- Spaces (family groups)
create table space (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  description text,
  privacy privacy_class not null default 'living_family',
  created_by uuid not null,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

-- Persons
create table person (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references space(id) on delete cascade,
  display_name text not null,
  sex text not null check (sex in ('male', 'female', 'other')),
  birth_fuzzy fuzzy_date check (valid_fuzzy_date(birth_fuzzy)),
  death_fuzzy fuzzy_date check (valid_fuzzy_date(death_fuzzy)),
  death_state death_state not null default 'living',
  privacy privacy_class not null default 'living_private',
  kyc_level kyc_level not null default '0',
  claimed_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index person_space_id on person(space_id);
create index person_death_state on person(death_state);

-- Person names (alternate names, nicknames)
create table person_name (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('given', 'family', 'nickname', 'maiden')),
  language text not null default 'en',
  created_at timestamp with time zone not null default now()
);

create index person_name_person_id on person_name(person_id);

-- Places
create table place (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references space(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('county', 'subcounty', 'town', 'village', 'landmark')),
  county_code text,
  coordinates text,
  created_at timestamp with time zone not null default now()
);

create index place_space_id on place(space_id);

-- Life events (birth, marriage, death, migration, etc.)
create table life_event (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person(id) on delete cascade,
  event_type text not null check (event_type in ('birth', 'marriage', 'death', 'migration', 'education', 'employment', 'other')),
  event_date fuzzy_date check (valid_fuzzy_date(event_date)),
  place_id uuid references place(id),
  description text,
  created_at timestamp with time zone not null default now()
);

create index life_event_person_id on life_event(person_id);

-- Enable RLS for all tables
alter table space enable row level security;
alter table person enable row level security;
alter table person_name enable row level security;
alter table place enable row level security;
alter table life_event enable row level security;
