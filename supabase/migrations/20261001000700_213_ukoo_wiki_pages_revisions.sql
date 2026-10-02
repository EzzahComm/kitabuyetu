-- Phase 2: Wiki & Biography Pages
-- Migration ukoo_008: Pages, revisions, bio sections, memories

-- Pages (biography for a person, spec §6)
create table page (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person(id) on delete cascade,
  space_id uuid not null references space(id) on delete cascade,
  bio_mode bio_mode not null default 'private',
  head_rev_id uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index page_person_id on page(person_id);
create index page_space_id on page(space_id);

-- Page revisions (append-only, spec §6.2)
create table page_revision (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references page(id) on delete cascade,
  content jsonb not null,
  created_by uuid not null,
  summary text,
  created_at timestamp with time zone not null default now(),
  unique (page_id, id)
);

create index page_revision_page_id on page_revision(page_id);
create index page_revision_created_by on page_revision(created_by);

-- Add circular FK: page.head_rev_id -> page_revision.id
alter table page add constraint fk_page_head_rev
  foreign key (head_rev_id) references page_revision(id) on delete set null;

-- Bio sections (narrative, sources, etc., spec §6.3)
create table bio_section (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references page(id) on delete cascade,
  key text not null,
  position int not null,
  enabled boolean not null default true,
  visibility privacy_class not null default 'living_family',
  created_at timestamp with time zone not null default now(),
  unique (page_id, key)
);

create index bio_section_page_id on bio_section(page_id);

-- Memories (signed stories from others, spec §6.4)
create table memory (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person(id) on delete cascade,
  body text not null,
  media_id uuid,
  author_id uuid not null,
  hidden_by_subject boolean not null default false,
  hidden_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

create index memory_person_id on memory(person_id);
create index memory_author_id on memory(author_id);

-- Biography prompts (guided questions)
create table bio_prompt (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references space(id) on delete cascade,
  section_key text not null,
  prompt_en text not null,
  prompt_sw text not null,
  position int not null,
  created_at timestamp with time zone not null default now()
);

create index bio_prompt_space_id on bio_prompt(space_id);

-- Sources & citations (evidence, spec §6.5)
create table source (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references space(id) on delete cascade,
  kind text not null check (kind in ('birth_certificate', 'marriage_license', 'death_certificate', 'letter', 'photo', 'oral', 'other')),
  title text,
  description text,
  media_id uuid,
  serial_hmac text,
  transcription text,
  created_by uuid not null,
  created_at timestamp with time zone not null default now()
);

create index source_space_id on source(space_id);

-- Citations (link source to relationship or event)
create table citation (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references source(id) on delete cascade,
  cited_entity_type text not null check (cited_entity_type in ('parentage', 'union', 'life_event', 'memory')),
  cited_entity_id uuid not null,
  created_at timestamp with time zone not null default now()
);

create index citation_source_id on citation(source_id);
create index citation_entity on citation(cited_entity_type, cited_entity_id);

-- Namesakes (people named after others, spec §5.3)
create table namesake (
  person_id uuid not null references person(id) on delete cascade,
  namesake_person_id uuid not null references person(id) on delete cascade,
  name_source text,
  created_at timestamp with time zone not null default now(),
  primary key (person_id, namesake_person_id)
);

create index namesake_namesake_person_id on namesake(namesake_person_id);

-- Enable RLS
alter table page enable row level security;
alter table page_revision enable row level security;
alter table bio_section enable row level security;
alter table memory enable row level security;
alter table bio_prompt enable row level security;
alter table source enable row level security;
alter table citation enable row level security;
alter table namesake enable row level security;
