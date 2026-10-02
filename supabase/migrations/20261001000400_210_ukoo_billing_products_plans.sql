-- Phase 0: Database-driven billing catalog
-- Migration ukoo_005: Products, plans, and entitlements (replaces enum model)

-- Products (ukoo, future: other family-tree products)
create table products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

-- Plans (free, premium, clan)
create table plans (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  code text not null,
  name text not null,
  monthly_price_kes int not null default 0,
  annual_price_kes int not null default 0,
  description text,
  active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  unique (product_id, code)
);

create index plans_product_id on plans(product_id);

-- Entitlements (features per plan)
create table plan_entitlements (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans(id) on delete cascade,
  entitlement_key text not null,
  value text not null,
  created_at timestamp with time zone not null default now(),
  unique (plan_id, entitlement_key)
);

create index plan_entitlements_plan_id on plan_entitlements(plan_id);

-- Space billing (which space -> which plan)
create table space_billing (
  space_id uuid not null references space(id) on delete cascade,
  plan_id uuid not null references plans(id),
  status text not null check (status in ('active', 'past_due', 'lapsed')),
  renewal_date timestamp with time zone,
  linked_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  primary key (space_id)
);

-- Seed initial data: ukoo product and three plans
insert into products (code, name, description) values
  ('ukoo', 'Ukoo Yetu', 'Family tree and genealogy platform')
on conflict (code) do nothing;

with ukoo_product as (select id from products where code = 'ukoo')
insert into plans (product_id, code, name, monthly_price_kes, annual_price_kes, description)
select id, 'ukoo_free', 'Free', 0, 0, 'Free tier: limited persons and features'
from ukoo_product
on conflict (product_id, code) do nothing;

with ukoo_product as (select id from products where code = 'ukoo')
insert into plans (product_id, code, name, monthly_price_kes, annual_price_kes, description)
select id, 'ukoo_premium', 'Premium', 299, 2990, 'Premium: unlimited persons, SMS, media'
from ukoo_product
on conflict (product_id, code) do nothing;

with ukoo_product as (select id from products where code = 'ukoo')
insert into plans (product_id, code, name, monthly_price_kes, annual_price_kes, description)
select id, 'ukoo_clan', 'Clan', 999, 9990, 'Clan: all features + advanced APIs'
from ukoo_product
on conflict (product_id, code) do nothing;

-- Seed entitlements for each plan
with plan_free as (select id from plans where code = 'ukoo_free')
insert into plan_entitlements (plan_id, entitlement_key, value)
values
  ((select id from plan_free), 'max_persons', '50'),
  ((select id from plan_free), 'max_members', '5'),
  ((select id from plan_free), 'storage_bytes', '1073741824'),
  ((select id from plan_free), 'sms_enabled', 'false'),
  ((select id from plan_free), 'sms_daily_cap', '0'),
  ((select id from plan_free), 'gedcom_export_full', 'false'),
  ((select id from plan_free), 'family_data_api', 'false')
on conflict (plan_id, entitlement_key) do nothing;

with plan_premium as (select id from plans where code = 'ukoo_premium')
insert into plan_entitlements (plan_id, entitlement_key, value)
values
  ((select id from plan_premium), 'max_persons', '5000'),
  ((select id from plan_premium), 'max_members', '100'),
  ((select id from plan_premium), 'storage_bytes', '10737418240'),
  ((select id from plan_premium), 'sms_enabled', 'true'),
  ((select id from plan_premium), 'sms_daily_cap', '1000'),
  ((select id from plan_premium), 'gedcom_export_full', 'true'),
  ((select id from plan_premium), 'family_data_api', 'true')
on conflict (plan_id, entitlement_key) do nothing;

with plan_clan as (select id from plans where code = 'ukoo_clan')
insert into plan_entitlements (plan_id, entitlement_key, value)
values
  ((select id from plan_clan), 'max_persons', '50000'),
  ((select id from plan_clan), 'max_members', '1000'),
  ((select id from plan_clan), 'storage_bytes', '107374182400'),
  ((select id from plan_clan), 'sms_enabled', 'true'),
  ((select id from plan_clan), 'sms_daily_cap', '10000'),
  ((select id from plan_clan), 'gedcom_export_full', 'true'),
  ((select id from plan_clan), 'family_data_api', 'true')
on conflict (plan_id, entitlement_key) do nothing;

alter table products enable row level security;
alter table plans enable row level security;
alter table plan_entitlements enable row level security;
alter table space_billing enable row level security;
