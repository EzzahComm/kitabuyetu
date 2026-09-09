-- =============================================================================
-- 154 — Broaden group_type to the legal forms Kenyan groups actually register as
-- =============================================================================
--
-- The enum has only ever held five values:
--
--     chama, sacco, welfare, investment, ngo_group
--
-- and the signup dropdown labelled `ngo_group` as "Organization". That label is
-- the last remnant of the bug migration 147-era PR #95 fixed: the form used to
-- SUBMIT 'organization_group', which is not an enum member, so /register and
-- /groups/new 500'd for anyone picking it. PR #95 corrected the submitted value
-- to 'ngo_group' but left the visible text as "Organization" — so the crash went
-- away while the wrong word stayed on screen, which is why it still looks
-- unfixed.
--
-- "Organization" was also the wrong word on its own terms. It collides with the
-- `organizations` table (the enterprise/NGO tenant that OWNS groups), so a
-- self-help group registering itself was being offered a type named after an
-- entirely different entity in the model.
--
-- Six additions, matching how groups actually register in Kenya:
--
--   self_help_group  Dept. of Social Development (the most common form by far)
--   cbo              Community Based Organisation — also Social Development
--   society          Registrar of Societies, Societies Act Cap.108
--   cooperative      Commissioner for Co-operative Development
--   faith_based      church / mosque / faith welfare group
--   other            escape hatch, so an unlisted form is never a dead end
--
-- ADDITIVE ONLY. No existing value is renamed or dropped and no row is
-- rewritten, so this cannot break the 8 live groups. `ngo_group` stays exactly
-- as it is and simply gets relabelled "NGO" in the UI.
--
-- ── Why one ALTER TYPE per statement, and no usage below ───────────────────
-- ALTER TYPE ... ADD VALUE is allowed inside a transaction on PG 12+ (this is
-- PG 17), but the new label cannot be *used* by the same transaction that adds
-- it. Nothing here casts to group_type afterwards, so the migration is safe to
-- run as a single transactional batch the way Supabase applies it.
--
-- IF NOT EXISTS makes each statement idempotent — re-running is a no-op rather
-- than a duplicate_object error.
-- =============================================================================

ALTER TYPE group_type ADD VALUE IF NOT EXISTS 'self_help_group';
ALTER TYPE group_type ADD VALUE IF NOT EXISTS 'cbo';
ALTER TYPE group_type ADD VALUE IF NOT EXISTS 'society';
ALTER TYPE group_type ADD VALUE IF NOT EXISTS 'cooperative';
ALTER TYPE group_type ADD VALUE IF NOT EXISTS 'faith_based';
ALTER TYPE group_type ADD VALUE IF NOT EXISTS 'other';
