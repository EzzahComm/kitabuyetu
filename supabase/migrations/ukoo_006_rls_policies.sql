-- Phase 0: RLS Policies
-- Migration ukoo_006: Row-level security for all Ukoo Yetu tables

-- Helper function: can_view_person (spec §9.3)
create or replace function can_view_person(person_id uuid)
returns boolean as $$
declare
  person_privacy privacy_class;
  current_user_id uuid;
  is_space_member boolean;
  has_grant boolean;
begin
  current_user_id := auth.uid();

  if current_user_id is null then
    return false;
  end if;

  -- Get person's privacy class
  select privacy into person_privacy from person where id = person_id;

  if person_privacy is null then
    return false;
  end if;

  -- Subject can always view themselves
  if person_id = (select claimed_by from person where id = person_id) then
    return true;
  end if;

  -- Check if user has explicit grant
  select exists(
    select 1 from person_grant
    where person_id = $1 and user_id = current_user_id
  ) into has_grant;

  if has_grant then
    return true;
  end if;

  -- Check if deceased_public
  if person_privacy = 'deceased_public'::privacy_class then
    return true;
  end if;

  -- Check if user is space member (for living_family/deceased_family)
  select exists(
    select 1 from space_member sm
    join person p on sm.space_id = p.space_id
    where p.id = $1 and sm.user_id = current_user_id
  ) into is_space_member;

  return is_space_member;
end;
$$ language plpgsql security definer;

-- Space policies
create policy "Users can view spaces they are members of"
  on space for select
  using (
    auth.uid() in (
      select user_id from space_member where space_id = id
    )
  );

create policy "Custodians can update space"
  on space for update
  using (
    auth.uid() in (
      select user_id from space_member
      where space_id = id and role = 'custodian'
    )
  );

-- Person policies
create policy "Users can view persons via can_view_person"
  on person for select
  using (can_view_person(id));

create policy "Space custodians can insert persons"
  on person for insert
  with check (
    auth.uid() in (
      select user_id from space_member
      where space_id = space_id and role = 'custodian'
    )
  );

create policy "Persons editable by custodian and subject"
  on person for update
  using (
    auth.uid() in (
      select user_id from space_member
      where space_id = space_id and role in ('custodian', 'editor')
    )
    or claimed_by = auth.uid()
  );

-- Parentage policies
create policy "Parentage visible if both persons viewable"
  on parentage for select
  using (
    can_view_person(child_id) and can_view_person(parent_id)
  );

create policy "Editors can modify parentage"
  on parentage for insert
  with check (
    auth.uid() in (
      select sm.user_id from space_member sm
      join person p on sm.space_id = p.space_id
      where p.id = child_id and sm.role in ('custodian', 'editor')
    )
  );

-- Space member policies
create policy "Members can view own membership"
  on space_member for select
  using (user_id = auth.uid() or space_id in (
    select space_id from space_member where user_id = auth.uid() and role = 'custodian'
  ));

-- Person grant policies
create policy "Grants visible to custodians only"
  on person_grant for select
  using (
    auth.uid() in (
      select user_id from space_member sm
      join person p on sm.space_id = p.space_id
      where p.id = person_id and sm.role = 'custodian'
    )
  );

create policy "Custodians can grant access"
  on person_grant for insert
  with check (
    auth.uid() in (
      select sm.user_id from space_member sm
      join person p on sm.space_id = p.space_id
      where p.id = person_id and sm.role = 'custodian'
    )
  );

-- Billing policies (products/plans visible to all authenticated; entitlements to admins)
create policy "Authenticated users can view products"
  on products for select
  using (auth.role() = 'authenticated');

create policy "Authenticated users can view plans"
  on plans for select
  using (auth.role() = 'authenticated');

create policy "Authenticated users can view plan entitlements"
  on plan_entitlements for select
  using (auth.role() = 'authenticated');
