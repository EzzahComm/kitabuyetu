-- =============================================================================
-- 158: drop the redundant "KitabuYetu:" prefix from live SMS bodies
--
-- Two problems in one string, both logged as defect D3 in
-- docs/audits/SMS_INVENTORY_AND_COVERAGE_2026-08.md:
--
--   1. "KitabuYetu" is not the brand. It is written "Kitabu Yetu" everywhere
--      a human reads it, and the codebase carried both spellings.
--   2. The prefix is redundant. Every message already arrives from the
--      registered alphanumeric sender ID "KITABU YETU" (lib/env.ts's
--      TEXTSMS_SENDER_ID), so the recipient sees the brand twice — once as
--      the sender, once as the first word of the body.
--
-- Removing it is not only cosmetic: it returns 12 characters to a receipt
-- that is already 134 characters rendered against a real 33-character group
-- name. The margin before a second SMS segment (and a doubled credit charge)
-- was thinner than it looked.
--
-- Guarded on the EXACT current body, the same way migration 064 guarded its
-- rewrite: a group that has customised this template keeps its own wording,
-- and a rerun is a no-op.
--
-- NOT touched here, deliberately:
--   • migrations 013 / 052 / 064, which contain the old strings — they are
--     applied history and must stay as they were run.
--   • daraja.service.ts's INITIATOR_NAME, still 'KitabuYetu'. That is a B2C
--     credential registered with Safaricom, not copy; "fixing" its spelling
--     breaks every disbursement. It carries its own warning comment.
-- =============================================================================

UPDATE public.sms_templates
SET    body = 'KES {{amount}} {{product}} received for {{group_name}} (A/C {{membership_no}}). Receipt: {{receipt}}. Balance: KES {{balance}}.',
       updated_at = NOW()
WHERE  template_key = 'payment_received'
  AND  body = 'KitabuYetu: KES {{amount}} {{product}} received for {{group_name}} (A/C {{membership_no}}). Receipt: {{receipt}}. Balance: KES {{balance}}.';

-- The pre-064 wording, still live for any group that never got the 064
-- rewrite (it was guarded on the same exact-body condition).
UPDATE public.sms_templates
SET    body = 'Payment of KES {{amount}} received. Receipt: {{receipt}}. Thank you.',
       updated_at = NOW()
WHERE  template_key = 'payment_received'
  AND  body = 'KitabuYetu: Payment of KES {{amount}} received. Receipt: {{receipt}}. Thank you.';

-- Built-in defaults that were also seeded into the table by migration 013.
-- Each is guarded on its exact seeded body; a customised row is left alone.
UPDATE public.sms_templates
SET    body = 'Dear {{first_name}}, payment of KES {{amount}} confirmed. Receipt: {{receipt}}.',
       updated_at = NOW()
WHERE  template_key = 'payment_confirmed'
  AND  body = 'Dear {{first_name}}, payment of KES {{amount}} confirmed. Receipt: {{receipt}}. KitabuYetu.';

UPDATE public.sms_templates
SET    body = 'Your Kitabu Yetu verification code is {{otp}}. Valid for 10 minutes. Do not share this code.',
       updated_at = NOW()
WHERE  template_key = 'otp'
  AND  body = 'Your KitabuYetu verification code is {{otp}}. Valid for 10 minutes. Do not share this code.';

-- The seeded welcome body predates the member_welcome trigger (migration 157)
-- and never included the member's number. Bring it in line with the built-in
-- default so a group reading its template list sees what actually goes out.
UPDATE public.sms_templates
SET    body = 'Dear {{first_name}}, you have joined {{group_name}} on Kitabu Yetu. Your member number is {{membership_no}}. Karibu.',
       updated_at = NOW()
WHERE  template_key = 'welcome'
  AND  body = 'Welcome to {{group_name}} on KitabuYetu! Your digital savings hub is ready. Contact your group admin to get started.';
