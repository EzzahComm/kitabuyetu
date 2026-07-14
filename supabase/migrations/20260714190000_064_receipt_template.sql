-- =============================================================================
-- 064_receipt_template.sql
-- Phase 4 (PAYMENT_ARCHITECTURE_REDESIGN.md §8; audit M-2): the payment
-- receipt SMS names the group, the Membership Number, the product, and the
-- updated balance, so a multi-group member always knows which membership a
-- payment landed on:
--
--   KitabuYetu: KES 1,000 savings received for Bungoma Women's VSLA
--   (A/C BG 10253 4). Receipt XYZ123. Balance: KES 26,000.
--
-- The emit site enriches the payload with {{group_name}} {{membership_no}}
-- {{product}} {{balance}} when the payment allocated to a membership; for
-- other payments (invoices, top-ups) the engine strips the unresolved
-- placeholders and the message degrades to the previous wording. Only the
-- platform-seeded template is updated — group-customised copies are theirs.
-- =============================================================================

UPDATE sms_templates
SET    body = 'KitabuYetu: KES {{amount}} {{product}} received for {{group_name}} (A/C {{membership_no}}). Receipt: {{receipt}}. Balance: KES {{balance}}.',
       variables = ARRAY['amount','product','group_name','membership_no','receipt','balance']
WHERE  template_key = 'payment_received'
  AND  body = 'KitabuYetu: Payment of KES {{amount}} received. Receipt: {{receipt}}. Thank you.';
