-- Phase 0: Ukoo Yetu initialization
-- Migration ukoo_001: Types, extensions, and helper functions

-- Extensions
create extension if not exists pg_trgm;
create extension if not exists ltree;
create extension if not exists pgcrypto;

-- Enum types (spec §4)
create type date_precision as enum ('year', 'month', 'day');
create type fuzzy_date as (year int, month int, day int, precision date_precision);
create type privacy_class as enum ('living_private', 'living_family', 'deceased_family', 'deceased_public');
create type death_state as enum ('living', 'reported', 'verified', 'disputed');
create type parentage_kind as enum ('biological', 'adoptive', 'foster', 'step');
create type parentage_certainty as enum ('presumed', 'documented', 'verified');
create type union_kind as enum ('marriage', 'partnership', 'cohabitation');
create type bio_mode as enum ('closed', 'private', 'family', 'public');
create type kyc_level as enum ('0', '1', '2', '3');
create type media_class as enum ('photo', 'audio', 'video', 'document', 'other');
create type media_state as enum ('uploading', 'scanning', 'ready', 'rejected');
create type space_role as enum ('custodian', 'member', 'guest');

-- Helper function to validate fuzzy_date
create or replace function valid_fuzzy_date(fd fuzzy_date)
returns boolean as $$
begin
  if fd.year < 1800 or fd.year > extract(year from now()) then
    return false;
  end if;
  if fd.month is not null and (fd.month < 1 or fd.month > 12) then
    return false;
  end if;
  if fd.day is not null and (fd.day < 1 or fd.day > 31) then
    return false;
  end if;
  if fd.precision = 'month' and fd.month is null then
    return false;
  end if;
  if fd.precision = 'day' and (fd.month is null or fd.day is null) then
    return false;
  end if;
  return true;
end;
$$ language plpgsql immutable;
