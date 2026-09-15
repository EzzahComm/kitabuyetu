-- =============================================================================
-- 176_group_surface_indexing_and_overfetch.sql
-- From the 2026-09 optimization audit's the-group-surface dimension
-- (docs/audits/optimization-2026-09/verified/
-- the-group-surface-member-officer-dashboa.json).
--
-- meetings.list's default (unfiltered) query is
-- `WHERE group_id = $1 ORDER BY scheduled_at DESC` — confirmed live no
-- existing index covers (group_id, scheduled_at) together;
-- idx_meetings_group_status_scheduled has status as its 2nd key column, so
-- it cannot serve an ordered scan when status isn't filtered, and
-- idx_meetings_group_created sorts a different column entirely. Low
-- urgency at current table size (2 meetings platform-wide, per the audit's
-- own caveat) but trivial and correct to add now.
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_meetings_group_scheduled_at
  ON public.meetings (group_id, scheduled_at DESC);
