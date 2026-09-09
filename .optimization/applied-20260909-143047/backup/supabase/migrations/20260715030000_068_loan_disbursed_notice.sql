-- =============================================================================
-- 068_loan_disbursed_notice.sql
-- Follow-up to migration 066: the 'loan_disbursed' notification template
-- assumed to exist from the SMS system's earliest migration does not
-- actually exist in this database (verified post-apply) — only the
-- payment_received template was ever seeded that way. Seed the template
-- itself here so the emitBusinessEvent('loan.disbursed') call added in
-- migration 066 actually reaches the borrower (B2C audit F10).
-- =============================================================================

INSERT INTO sms_templates (group_id, template_key, name, body, variables, category, is_system)
SELECT NULL, 'loan_disbursed', 'Loan Disbursed',
       'Dear {{first_name}}, KES {{amount}} has been disbursed to your M-Pesa. Receipt: {{receipt}}.',
       ARRAY['first_name','amount','receipt'], 'loan', true
WHERE NOT EXISTS (SELECT 1 FROM sms_templates WHERE template_key = 'loan_disbursed');

INSERT INTO sms_trigger_rules (name, description, event_type, template_key, recipient_spec, conditions)
SELECT
  'loan_disbursed_notice',
  'Notify the borrower when their loan disbursement completes via B2C.',
  'loan.disbursed',
  'loan_disbursed',
  '{"type":"event_member","field":"memberId"}'::jsonb,
  '{"field":"memberId","op":"exists"}'::jsonb
WHERE EXISTS (SELECT 1 FROM sms_templates WHERE template_key = 'loan_disbursed')
  AND NOT EXISTS (SELECT 1 FROM sms_trigger_rules WHERE name = 'loan_disbursed_notice');
