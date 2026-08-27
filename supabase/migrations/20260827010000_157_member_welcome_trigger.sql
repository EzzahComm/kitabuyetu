-- =============================================================================
-- 157: welcome SMS when a member is added to a group
--
-- `member.registered` has been in the SMS event catalog (lib/sms/events.ts)
-- since the trigger engine shipped, and a `welcome` template has been in
-- DEFAULT_TEMPLATES just as long — but no rule ever connected the two, so
-- adding a member sent nothing. Confirmed in production 2026-08-27: only two
-- trigger rules existed platform-wide (loan.disbursed, payment.received), and
-- Ndengelwa Community Water Project had exactly one SMS in its entire history
-- despite six members being added the previous day.
--
-- One group (THE FIONA'S) had already written a `welcome` template override
-- named "Karibu", clearly expecting this to work. Wiring the rule to the
-- `welcome` key means they get their own wording automatically, via the
-- group-override-then-system-then-builtin resolution in loadTemplateBody.
--
-- Deliberately NOT guarded on a `welcome` row existing in sms_templates, the
-- way migration 066 guarded loan_disbursed: this key has a compiled-in default
-- that every group falls back to, so requiring a DB row would make the rule
-- fire only for the one group that happens to have an override.
--
-- The producer side is members.service.ts's create(), which emits AFTER its
-- transaction commits and only from the single-member path — the CSV importer
-- shares linkMemberToGroup but deliberately stays silent, so a 500-row import
-- cannot spend 500 credits. See the comment on emitMemberRegisteredEvent.
-- =============================================================================

INSERT INTO sms_trigger_rules (name, description, event_type, template_key, recipient_spec, conditions)
SELECT
  'member_welcome',
  'Welcome a member by SMS when they are added to a group.',
  'member.registered',
  'welcome',
  '{"type":"event_member","field":"memberId"}'::jsonb,
  -- Same guard the disbursement rule uses: without a memberId there is nobody
  -- to resolve a phone number for, and the dispatch would no-op anyway.
  '{"field":"memberId","op":"exists"}'::jsonb
WHERE NOT EXISTS (SELECT 1 FROM sms_trigger_rules WHERE name = 'member_welcome');
