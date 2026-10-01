-- Phase 0: Ukoo Yetu initialization
-- Migration ukoo_003: Kinship (parentage, unions) and ancestry closure

-- Parentage relationships (spec §5.1)
create table parentage (
  child_id uuid not null references person(id) on delete cascade,
  parent_id uuid not null references person(id) on delete cascade,
  kind parentage_kind not null,
  certainty parentage_certainty not null default 'presumed',
  evidence_source_id uuid,
  created_at timestamp with time zone not null default now(),
  primary key (child_id, parent_id, kind)
);

create index parentage_child_id on parentage(child_id);
create index parentage_parent_id on parentage(parent_id);

-- Constraint: max 2 biological parents per child
alter table parentage
add constraint check_biological_parent_count check (
  kind != 'biological' or (
    select count(*) from parentage where child_id = parentage.child_id and kind = 'biological'
  ) <= 2
);

-- Union relationships (marriages, partnerships)
create table union_rel (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references space(id) on delete cascade,
  kind union_kind not null,
  started_fuzzy fuzzy_date check (valid_fuzzy_date(started_fuzzy)),
  ended_fuzzy fuzzy_date check (valid_fuzzy_date(ended_fuzzy)),
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index union_rel_space_id on union_rel(space_id);

-- Union partners (people in a union)
create table union_partner (
  union_id uuid not null references union_rel(id) on delete cascade,
  person_id uuid not null references person(id) on delete cascade,
  seniority int not null default 0,
  primary key (union_id, person_id)
);

create index union_partner_person_id on union_partner(person_id);

-- Ancestry closure table for fast ancestor/descendant queries (spec §5.2)
create table ancestry_closure (
  descendant_id uuid not null references person(id) on delete cascade,
  ancestor_id uuid not null references person(id) on delete cascade,
  distance int not null check (distance > 0),
  path uuid[] not null,
  created_at timestamp with time zone not null default now(),
  primary key (descendant_id, ancestor_id, distance)
);

create index ancestry_closure_ancestor_id on ancestry_closure(ancestor_id);

-- Relationship labels
create table relationship_label (
  ancestor_id uuid not null references person(id) on delete cascade,
  descendant_id uuid not null references person(id) on delete cascade,
  label text not null,
  certainty parentage_certainty not null,
  primary key (ancestor_id, descendant_id)
);

-- Namesakes (people named after others)
create table namesake (
  person_id uuid not null references person(id) on delete cascade,
  namesake_person_id uuid not null references person(id) on delete cascade,
  name_source text,
  created_at timestamp with time zone not null default now(),
  primary key (person_id, namesake_person_id)
);

create index namesake_namesake_person_id on namesake(namesake_person_id);

-- Enable RLS
alter table parentage enable row level security;
alter table union_rel enable row level security;
alter table union_partner enable row level security;
alter table ancestry_closure enable row level security;
alter table relationship_label enable row level security;
alter table namesake enable row level security;
