-- Phase 1: Kinship Operations
-- Migration ukoo_007: RPCs for person, parentage, union management (SECURITY DEFINER)

-- Add person (custodian action, returns person record)
create or replace function add_person(
  p_space_id uuid,
  p_display_name text,
  p_sex text,
  p_birth_fuzzy fuzzy_date,
  p_death_fuzzy fuzzy_date,
  p_privacy privacy_class,
  p_created_by uuid
)
returns json as $$
declare
  v_person_id uuid;
  v_person_record json;
begin
  -- Check custodian permission
  if not exists(
    select 1 from space_member
    where space_id = p_space_id and user_id = p_created_by and role = 'custodian'
  ) then
    raise exception 'Unauthorized: not a custodian';
  end if;

  -- Validate sex enum
  if p_sex not in ('male', 'female', 'other') then
    raise exception 'Invalid sex value: %', p_sex;
  end if;

  -- Validate fuzzy dates
  if p_birth_fuzzy is not null and not valid_fuzzy_date(p_birth_fuzzy) then
    raise exception 'Invalid birth date';
  end if;

  if p_death_fuzzy is not null and not valid_fuzzy_date(p_death_fuzzy) then
    raise exception 'Invalid death date';
  end if;

  -- Insert person
  insert into person (space_id, display_name, sex, birth_fuzzy, death_fuzzy, privacy)
  values (p_space_id, p_display_name, p_sex, p_birth_fuzzy, p_death_fuzzy, p_privacy)
  returning row_to_json(person.*) into v_person_record;

  -- Audit log
  insert into audit_event (category, action, user_id, resource_id, after)
  values ('person', 'create', p_created_by, (v_person_record->>'id')::uuid, v_person_record);

  return v_person_record;
end;
$$ language plpgsql security definer;

-- Add parentage relationship (custodian action, maintains closure)
create or replace function add_parentage(
  p_child_id uuid,
  p_parent_id uuid,
  p_kind parentage_kind,
  p_certainty parentage_certainty,
  p_created_by uuid
)
returns json as $$
declare
  v_space_id uuid;
  v_existing_count int;
  v_result json;
begin
  -- Verify both persons in same space
  select space_id into v_space_id from person where id = p_child_id;
  if v_space_id is null then
    raise exception 'Child person not found';
  end if;

  if not exists(select 1 from person where id = p_parent_id and space_id = v_space_id) then
    raise exception 'Parent person not in same space';
  end if;

  -- Check custodian permission
  if not exists(
    select 1 from space_member
    where space_id = v_space_id and user_id = p_created_by and role in ('custodian', 'editor')
  ) then
    raise exception 'Unauthorized';
  end if;

  -- Check biological parent count (max 2)
  if p_kind = 'biological' then
    select count(*) into v_existing_count from parentage
    where child_id = p_child_id and kind = 'biological';
    if v_existing_count >= 2 then
      raise exception 'Child already has 2 biological parents';
    end if;
  end if;

  -- Prevent cycles (simple check: parent is not descendant of child)
  if exists(
    select 1 from ancestry_closure
    where descendant_id = p_parent_id and ancestor_id = p_child_id
  ) then
    raise exception 'Adding parent would create a cycle';
  end if;

  -- Insert parentage
  insert into parentage (child_id, parent_id, kind, certainty)
  values (p_child_id, p_parent_id, p_kind, p_certainty)
  on conflict do nothing;

  -- Rebuild ancestry closure for this subtree (advisory lock)
  perform pg_advisory_lock(p_child_id::bigint);

  -- Delete old closure for descendants of child
  delete from ancestry_closure
  where descendant_id = p_child_id or descendant_id in (
    select descendant_id from ancestry_closure where ancestor_id = p_child_id
  );

  -- Rebuild closure (child -> ancestors, descendants -> child -> ancestors)
  insert into ancestry_closure (descendant_id, ancestor_id, distance, path)
  with recursive closure as (
    select p_child_id::uuid as desc_id, p_parent_id::uuid as anc_id, 1 as dist, array[p_child_id, p_parent_id] as pth
    union all
    select closure.desc_id, a.ancestor_id, closure.dist + 1, closure.pth || a.ancestor_id
    from closure
    join ancestry_closure a on a.descendant_id = closure.anc_id
  )
  select desc_id, anc_id, dist, pth from closure
  on conflict (descendant_id, ancestor_id, distance) do nothing;

  perform pg_advisory_unlock(p_child_id::bigint);

  -- Audit log
  select row_to_json(parentage.*) into v_result from parentage
  where child_id = p_child_id and parent_id = p_parent_id and kind = p_kind;

  insert into audit_event (category, action, user_id, resource_id, after)
  values ('parentage', 'create', p_created_by, p_child_id, v_result);

  return v_result;
end;
$$ language plpgsql security definer;

-- Remove parentage (custodian action, rebuilds closure)
create or replace function remove_parentage(
  p_child_id uuid,
  p_parent_id uuid,
  p_kind parentage_kind,
  p_removed_by uuid
)
returns void as $$
declare
  v_space_id uuid;
begin
  select space_id into v_space_id from person where id = p_child_id;
  if v_space_id is null then
    raise exception 'Child person not found';
  end if;

  if not exists(
    select 1 from space_member
    where space_id = v_space_id and user_id = p_removed_by and role in ('custodian', 'editor')
  ) then
    raise exception 'Unauthorized';
  end if;

  -- Delete parentage
  delete from parentage
  where child_id = p_child_id and parent_id = p_parent_id and kind = p_kind;

  -- Rebuild closure (same as add_parentage but starting from child)
  perform pg_advisory_lock(p_child_id::bigint);

  delete from ancestry_closure
  where descendant_id = p_child_id or descendant_id in (
    select descendant_id from ancestry_closure where ancestor_id = p_child_id
  );

  with recursive closure as (
    select p.child_id::uuid as desc_id, p.parent_id::uuid as anc_id, 1 as dist, array[p.child_id, p.parent_id] as pth
    from parentage p
    where p.child_id = p_child_id
    union all
    select closure.desc_id, a.ancestor_id, closure.dist + 1, closure.pth || a.ancestor_id
    from closure
    join ancestry_closure a on a.descendant_id = closure.anc_id
  )
  insert into ancestry_closure (descendant_id, ancestor_id, distance, path)
  select desc_id, anc_id, dist, pth from closure
  on conflict (descendant_id, ancestor_id, distance) do nothing;

  perform pg_advisory_unlock(p_child_id::bigint);

  -- Audit log
  insert into audit_event (category, action, user_id, resource_id, before)
  values ('parentage', 'delete', p_removed_by, p_child_id, json_build_object('child_id', p_child_id, 'parent_id', p_parent_id));
end;
$$ language plpgsql security definer;

-- Get relationship label between two persons (spec §5.2)
create or replace function get_relationship_label(
  p_ancestor_id uuid,
  p_descendant_id uuid,
  p_locale text default 'en'
)
returns json as $$
declare
  v_distance int;
  v_label text;
  v_certainty parentage_certainty;
begin
  -- Check if direct ancestor
  select distance, certainty into v_distance, v_certainty
  from ancestry_closure
  join parentage on parentage.child_id = p_descendant_id and parentage.parent_id = p_ancestor_id
  where descendant_id = p_descendant_id and ancestor_id = p_ancestor_id
  limit 1;

  if v_distance is null then
    return json_build_object('label', 'relative', 'certainty', 'presumed');
  end if;

  -- Map distance to label
  if p_locale = 'sw' then
    case v_distance
      when 1 then v_label := 'mzazi';
      when 2 then v_label := 'babu/bibi';
      else v_label := 'ukoo';
    end case;
  else
    case v_distance
      when 1 then v_label := 'parent';
      when 2 then v_label := 'grandparent';
      else v_label := 'ancestor';
    end case;
  end if;

  return json_build_object('label', v_label, 'certainty', v_certainty, 'distance', v_distance);
end;
$$ language plpgsql security definer;
