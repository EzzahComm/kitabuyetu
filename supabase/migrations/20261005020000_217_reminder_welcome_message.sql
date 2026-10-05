-- =============================================================================
-- 217_reminder_welcome_message.sql
-- The platform `member_welcome` rule sends the `welcome` template, whose text
-- says "you have joined <group> on Kitabu Yetu ... Your member number is ..." --
-- wrong for a Chama Reminder group, which has no member numbers and does not
-- use Kitabu Yetu. members.service now puts `product` on the member.registered
-- payload ('chama_reminder' for a reminder-only group, else 'kitabu_yetu').
--
-- This adds a reminder-specific template and rule, and excludes reminder groups
-- from the original rule so a member never gets two welcomes. The exclusion
-- uses {not:{eq}} rather than {neq}: `neq` is false when the field is absent,
-- which would silence the welcome for any emitter that predates `product`
-- (e.g. scripts/backfill-member-welcome-sms.ts). Group-level `welcome`
-- overrides are untouched.
-- =============================================================================

INSERT INTO sms_templates (group_id, template_key, name, body, variables, category, is_system)
SELECT NULL, 'welcome_chama_reminder', 'Welcome (Chama Reminder)',
       'Dear {{first_name}}, you have joined {{group_name}} on Chama Reminder and will receive its reminders and greetings. Karibu.',
       ARRAY['first_name','group_name'], 'onboarding', true
WHERE NOT EXISTS (
  SELECT 1 FROM sms_templates WHERE group_id IS NULL AND template_key = 'welcome_chama_reminder'
);

UPDATE sms_trigger_rules
SET conditions = '{"all":[{"field":"memberId","op":"exists"},{"not":{"field":"product","op":"eq","value":"chama_reminder"}}]}'::jsonb
WHERE name = 'member_welcome' AND group_id IS NULL AND organization_id IS NULL;

INSERT INTO sms_trigger_rules (name, description, event_type, template_key, recipient_spec, conditions)
SELECT
  'member_welcome_chama_reminder',
  'Welcome a member by SMS when they are added to a Chama Reminder group.',
  'member.registered',
  'welcome_chama_reminder',
  '{"type":"event_member","field":"memberId"}'::jsonb,
  '{"all":[{"field":"memberId","op":"exists"},{"field":"product","op":"eq","value":"chama_reminder"}]}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM sms_trigger_rules WHERE name = 'member_welcome_chama_reminder');
