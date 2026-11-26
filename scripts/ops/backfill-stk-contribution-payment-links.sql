-- =============================================================================
-- backfill-stk-contribution-payment-links.sql
--
-- ONE-TIME, MANUAL data-correction script — NOT a supabase/migrations file.
-- CI seeds no historical data, so this has nothing to run against there; it
-- belongs in this project's ops scripts, applied by hand to production only.
--
-- PROBLEM: completed STK contribution payments whose contribution row exists
-- (the money IS in the group ledger, journal posted) but has payment_id NULL.
-- Payment-level reporting, including the platform revenue classifier
-- (lib/services/platform-revenue-classification.ts), then reads that money as
-- "unclassified". Nothing is missing — only the link.
--
-- Two code paths produced these rows:
--   1. The reconciliation self-heal (mpesa-reconciliation.service.ts
--      fulfilReconciledContribution) inserted the contribution without
--      payment_id. Fixed in the same change as this script.
--   2. STK contributions whose payments row never got its mpesa_receipt_number,
--      so the receipt-based link in mpesa-stk.service.ts could not match.
--
-- THIS SCRIPT DOES NOT ALLOCATE MONEY. It creates no contribution, journal, or
-- credit. It only sets contributions.payment_id on rows that already exist,
-- and marks the matching payment allocation_status = 'allocated'.
--
-- MATCHING IS EXACT, NEVER FUZZY (no amount/time-window guessing):
--   Rule A — mpesa_stk_requests.contribution_id points at the contribution;
--            the payment is the one with that request's checkout id.
--   Rule B — the stored STK callback (mpesa_callbacks) for the payment's
--            checkout id carries an MpesaReceiptNumber equal to the
--            contribution's mpesa_receipt_number, in the same group.
-- Both rules require contributions.payment_id IS NULL and that no other
-- contribution already holds the payment (uq_contributions_payment).
--
-- A payment that matches two DIFFERENT contributions was credited twice and is
-- skipped and reported, never linked (see section 1).
--
-- At authoring time (2026-10-07) the read-only preview found 3 payments to
-- LINK (Rule A, one contribution each) and 2 to SKIP as double credits (a
-- reconciliation row AND a receipt row for one payment, each with its own
-- journal entry). Two older contribution payments with no stored callback and
-- no request link match neither rule and are left alone. The script's own
-- preview output is authoritative; re-read it before committing.
--
-- IDEMPOTENT: every UPDATE is guarded on payment_id IS NULL, so a second run
-- matches nothing.
--
-- RUN:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/ops/backfill-stk-contribution-payment-links.sql
-- The script ends in ROLLBACK, so the first run is a dry run. Check the
-- preview and verify output, then swap the final ROLLBACK for COMMIT.
-- =============================================================================

BEGIN;

-- ─── 1. Candidate links (preview) ─────────────────────────────────────────────

CREATE TEMP TABLE stk_link_candidates ON COMMIT DROP AS
WITH callback_receipts AS (
  SELECT DISTINCT ON (c.body->'Body'->'stkCallback'->>'CheckoutRequestID')
         c.body->'Body'->'stkCallback'->>'CheckoutRequestID' AS checkout_request_id,
         (SELECT item->>'Value'
          FROM jsonb_array_elements(c.body->'Body'->'stkCallback'->'CallbackMetadata'->'Item') item
          WHERE item->>'Name' = 'MpesaReceiptNumber') AS receipt
  FROM mpesa_callbacks c
  WHERE c.callback_type = 'stk_push'
    AND c.body->'Body'->'stkCallback'->>'ResultCode' = '0'
  ORDER BY c.body->'Body'->'stkCallback'->>'CheckoutRequestID', c.created_at
),
rule_a AS (
  SELECT ct.id AS contribution_id, p.id AS payment_id, 'A'::text AS rule
  FROM mpesa_stk_requests s
  JOIN payments p       ON p.mpesa_checkout_request_id = s.checkout_request_id
  JOIN contributions ct ON ct.id = s.contribution_id
  WHERE s.purpose = 'contribution'
    AND p.status = 'completed'
    AND ct.payment_id IS NULL
),
rule_b AS (
  SELECT ct.id AS contribution_id, p.id AS payment_id, 'B'::text AS rule
  FROM payments p
  JOIN mpesa_stk_requests s ON s.checkout_request_id = p.mpesa_checkout_request_id
                           AND s.purpose = 'contribution'
  JOIN callback_receipts cr ON cr.checkout_request_id = p.mpesa_checkout_request_id
  JOIN contributions ct     ON ct.mpesa_receipt_number = cr.receipt
                           AND ct.group_id = p.group_id
  WHERE p.status = 'completed'
    AND ct.payment_id IS NULL
)
SELECT payment_id,
       MIN(contribution_id::text)::uuid       AS contribution_id,
       string_agg(DISTINCT rule, '+')         AS rule,
       COUNT(DISTINCT contribution_id)        AS distinct_contributions
FROM (SELECT * FROM rule_a UNION ALL SELECT * FROM rule_b) x
WHERE NOT EXISTS (SELECT 1 FROM contributions taken WHERE taken.payment_id = x.payment_id)
GROUP BY payment_id;

-- A payment that matches TWO different contributions was credited twice (the
-- reconciliation self-heal and the receipt path both created a row). Linking
-- either one would hide the duplicate, so these are reported and skipped.
-- Resolving them (reversing the duplicate contribution and its journal) is a
-- money decision for finance, not this script.
SELECT 'DOUBLE CREDIT — skipped, resolve by hand' AS conflict,
       l.payment_id, p.amount, g.name AS group_name,
       (SELECT string_agg(x.contribution_id::text, ', ')
        FROM (SELECT s.contribution_id FROM mpesa_stk_requests s
              WHERE s.checkout_request_id = p.mpesa_checkout_request_id
              UNION
              SELECT ct.id FROM contributions ct
              JOIN mpesa_callbacks c ON c.callback_type = 'stk_push'
               AND c.body->'Body'->'stkCallback'->>'CheckoutRequestID' = p.mpesa_checkout_request_id
              JOIN LATERAL jsonb_array_elements(c.body->'Body'->'stkCallback'->'CallbackMetadata'->'Item') item
                ON item->>'Name' = 'MpesaReceiptNumber'
              WHERE ct.mpesa_receipt_number = item->>'Value' AND ct.group_id = p.group_id) x
       ) AS contribution_ids
FROM stk_link_candidates l
JOIN payments p ON p.id = l.payment_id
LEFT JOIN groups g ON g.id = p.group_id
WHERE l.distinct_contributions > 1;

DELETE FROM stk_link_candidates WHERE distinct_contributions > 1;

-- Abort if any contribution would be linked to more than one payment.
DO $$
BEGIN
  IF EXISTS (
    SELECT contribution_id FROM stk_link_candidates
    GROUP BY contribution_id HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'A contribution matched more than one payment — resolve by hand before linking';
  END IF;
END $$;

SELECT l.rule, l.payment_id, l.contribution_id, p.amount, g.name AS group_name, p.created_at
FROM stk_link_candidates l
JOIN payments p ON p.id = l.payment_id
LEFT JOIN groups g ON g.id = p.group_id
ORDER BY p.created_at DESC;

-- ─── 2. Link contributions to their payments ─────────────────────────────────

UPDATE contributions ct
SET    payment_id = l.payment_id
FROM   stk_link_candidates l
WHERE  ct.id = l.contribution_id
  AND  ct.payment_id IS NULL
RETURNING ct.id AS contribution_id, ct.payment_id;

-- ─── 3. Mark the linked payments allocated ───────────────────────────────────

UPDATE payments p
SET    allocation_status = 'allocated'
FROM   stk_link_candidates l
WHERE  p.id = l.payment_id
  AND  p.allocation_status = 'received'
RETURNING p.id AS payment_id, p.allocation_status;

-- ─── 4. Verify — linked candidates remaining should be 0 ─────────────────────

SELECT COUNT(*) AS unlinked_candidates_remaining
FROM stk_link_candidates l
JOIN contributions ct ON ct.id = l.contribution_id
WHERE ct.payment_id IS DISTINCT FROM l.payment_id;

-- Dry run by default. Swap to COMMIT once the preview and verify look right.
ROLLBACK;
-- COMMIT;
