-- =============================================================================
-- 216_reminder_starter_templates.sql
-- A Chama Reminder group sees only system templates plus its own, and the only
-- system rows were the two Kitabu Yetu finance ones (loan_disbursed,
-- payment_received) -- so its Templates page had nothing usable. Seed
-- reminder-oriented starters. Keys are prefixed `reminder_` so they never
-- shadow the in-code fallbacks the trigger engine resolves by bare key
-- (birthday, meeting_reminder, ...), and none mention a product name.
-- group_id is NULL, so the (group_id, template_key) unique constraint cannot
-- catch a re-run; each insert is guarded with WHERE NOT EXISTS instead.
-- =============================================================================

INSERT INTO sms_templates (group_id, template_key, name, body, variables, category, is_system)
SELECT NULL, v.template_key, v.name, v.body, v.variables, v.category, true
FROM (VALUES
  ('reminder_birthday', 'Birthday greeting',
   'Happy Birthday {{first_name}}! Your {{group_name}} family wishes you a wonderful year ahead.',
   ARRAY['first_name','group_name'], 'birthday'),
  ('reminder_meeting', 'Meeting reminder',
   'Dear {{first_name}}, reminder: {{group_name}} meets on {{meeting_date}} at {{meeting_location}}. Kindly attend.',
   ARRAY['first_name','group_name','meeting_date','meeting_location'], 'reminder'),
  ('reminder_event_invite', 'Event invitation',
   'Dear {{first_name}}, you are invited to {{event_name}} on {{event_date}} at {{event_location}}.',
   ARRAY['first_name','event_name','event_date','event_location'], 'announcement'),
  ('reminder_announcement', 'Group announcement',
   '{{group_name}}: {{message}}',
   ARRAY['group_name','message'], 'announcement'),
  ('reminder_urgent', 'Urgent notice',
   'Dear {{first_name}}, URGENT from {{group_name}}: {{message}}',
   ARRAY['first_name','group_name','message'], 'announcement'),
  ('reminder_thank_you', 'Thank you',
   'Dear {{first_name}}, thank you for being part of {{group_name}}. We appreciate you.',
   ARRAY['first_name','group_name'], 'announcement')
) AS v(template_key, name, body, variables, category)
WHERE NOT EXISTS (
  SELECT 1 FROM sms_templates t WHERE t.group_id IS NULL AND t.template_key = v.template_key
);
