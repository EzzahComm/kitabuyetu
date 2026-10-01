-- Phase 2: Wiki RPCs
-- Migration ukoo_009: Page revision, merge, revert operations (SECURITY DEFINER)

-- Save page revision (handle stale_base conflict with three-way merge)
create or replace function save_revision(
  p_page_id uuid,
  p_base_rev_id uuid,
  p_content jsonb,
  p_summary text,
  p_created_by uuid
)
returns json as $$
declare
  v_space_id uuid;
  v_current_rev_id uuid;
  v_base_content jsonb;
  v_current_content jsonb;
  v_merged_content jsonb;
  v_new_rev_id uuid;
  v_result json;
begin
  -- Get page + check permissions
  select space_id, head_rev_id into v_space_id, v_current_rev_id
  from page where id = p_page_id;

  if v_space_id is null then
    raise exception 'Page not found';
  end if;

  if not exists(
    select 1 from space_member
    where space_id = v_space_id and user_id = p_created_by and role in ('custodian', 'editor')
  ) then
    raise exception 'Unauthorized';
  end if;

  -- Check if base revision matches current (no conflict)
  if p_base_rev_id = v_current_rev_id or p_base_rev_id is null then
    -- No conflict: insert new revision
    insert into page_revision (page_id, content, created_by, summary)
    values (p_page_id, p_content, p_created_by, p_summary)
    returning id into v_new_rev_id;

    -- Update head_rev_id
    update page set head_rev_id = v_new_rev_id, updated_at = now() where id = p_page_id;

    select row_to_json(page_revision.*) into v_result from page_revision where id = v_new_rev_id;

    insert into audit_event (category, action, user_id, resource_id, after)
    values ('page_revision', 'create', p_created_by, p_page_id, v_result);

    return v_result;
  else
    -- Conflict: return error with current state (client handles three-way merge)
    select content into v_base_content from page_revision where id = p_base_rev_id;
    select content into v_current_content from page_revision where id = v_current_rev_id;

    return json_build_object(
      'error', 'stale_base',
      'base_rev_id', p_base_rev_id,
      'current_rev_id', v_current_rev_id,
      'base_content', v_base_content,
      'current_content', v_current_content,
      'your_content', p_content
    );
  end if;
end;
$$ language plpgsql security definer;

-- Revert to a previous revision (creates new rev pointing to old content)
create or replace function revert_to(
  p_page_id uuid,
  p_rev_id uuid,
  p_reverted_by uuid
)
returns json as $$
declare
  v_space_id uuid;
  v_revert_content jsonb;
  v_new_rev_id uuid;
  v_result json;
begin
  -- Get page + check permissions
  select space_id into v_space_id from page where id = p_page_id;

  if v_space_id is null then
    raise exception 'Page not found';
  end if;

  if not exists(
    select 1 from space_member
    where space_id = v_space_id and user_id = p_reverted_by and role in ('custodian', 'editor')
  ) then
    raise exception 'Unauthorized';
  end if;

  -- Get content from revision to revert to
  select content into v_revert_content from page_revision where id = p_rev_id;

  if v_revert_content is null then
    raise exception 'Revision not found';
  end if;

  -- Create new revision with reverted content
  insert into page_revision (page_id, content, created_by, summary)
  values (p_page_id, v_revert_content, p_reverted_by, 'Reverted to revision')
  returning id into v_new_rev_id;

  -- Update head_rev_id
  update page set head_rev_id = v_new_rev_id, updated_at = now() where id = p_page_id;

  select row_to_json(page_revision.*) into v_result from page_revision where id = v_new_rev_id;

  insert into audit_event (category, action, user_id, resource_id, before, after)
  values ('page_revision', 'revert', p_reverted_by, p_page_id, json_build_object('from_rev_id', p_rev_id), v_result);

  return v_result;
end;
$$ language plpgsql security definer;

-- Hide a memory (subject-only or custodian)
create or replace function hide_memory(
  p_memory_id uuid,
  p_hidden_by uuid
)
returns void as $$
declare
  v_memory_record record;
  v_space_id uuid;
begin
  select m.id, m.person_id, p.space_id
  into v_memory_record
  from memory m
  join person p on m.person_id = p.id
  where m.id = p_memory_id;

  if v_memory_record.id is null then
    raise exception 'Memory not found';
  end if;

  -- Check permission: subject or custodian
  if not (
    v_memory_record.person_id = (select claimed_by from person where id = v_memory_record.person_id)
    or exists(
      select 1 from space_member
      where space_id = v_memory_record.space_id and user_id = p_hidden_by and role in ('custodian')
    )
  ) then
    raise exception 'Unauthorized';
  end if;

  update memory set hidden_by_subject = true, hidden_at = now() where id = p_memory_id;

  insert into audit_event (category, action, user_id, resource_id, after)
  values ('memory', 'hide', p_hidden_by, p_memory_id, json_build_object('hidden_at', now()));
end;
$$ language plpgsql security definer;

-- Set bio mode (custodian)
create or replace function set_bio_mode(
  p_page_id uuid,
  p_new_mode bio_mode,
  p_updated_by uuid
)
returns void as $$
declare
  v_space_id uuid;
begin
  select space_id into v_space_id from page where id = p_page_id;

  if v_space_id is null then
    raise exception 'Page not found';
  end if;

  if not exists(
    select 1 from space_member
    where space_id = v_space_id and user_id = p_updated_by and role = 'custodian'
  ) then
    raise exception 'Unauthorized';
  end if;

  update page set bio_mode = p_new_mode, updated_at = now() where id = p_page_id;

  insert into audit_event (category, action, user_id, resource_id, after)
  values ('page', 'update_bio_mode', p_updated_by, p_page_id, json_build_object('bio_mode', p_new_mode));
end;
$$ language plpgsql security definer;
