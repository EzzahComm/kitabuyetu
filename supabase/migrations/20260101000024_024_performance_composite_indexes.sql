-- ─────────────────────────────────────────────────────────────────────────────
-- 024: Composite indexes for welfare, investments, meetings
-- ─────────────────────────────────────────────────────────────────────────────

-- welfare_requests: group+status filter (dashboard pending count, page filter)
CREATE INDEX IF NOT EXISTS idx_welfare_requests_group_status
  ON public.welfare_requests (group_id, status);

-- welfare_requests: newest first per group (list default sort)
CREATE INDEX IF NOT EXISTS idx_welfare_requests_group_created
  ON public.welfare_requests (group_id, created_at DESC);

-- welfare_requests: priority queue ordering
CREATE INDEX IF NOT EXISTS idx_welfare_requests_group_priority_status
  ON public.welfare_requests (group_id, priority DESC, status);

-- welfare_pool_contributions: aggregation by type and period
CREATE INDEX IF NOT EXISTS idx_welfare_pool_group_type
  ON public.welfare_pool_contributions (group_id, contribution_type);

CREATE INDEX IF NOT EXISTS idx_welfare_pool_group_period
  ON public.welfare_pool_contributions (group_id, period_year DESC, period_month DESC);

-- investments: group+status filter (list page, summary query)
CREATE INDEX IF NOT EXISTS idx_investments_group_status
  ON public.investments (group_id, status);

-- investments: group+type for portfolio breakdown
CREATE INDEX IF NOT EXISTS idx_investments_group_type
  ON public.investments (group_id, investment_type);

-- investments: start_date for ROI calculations
CREATE INDEX IF NOT EXISTS idx_investments_group_start_date
  ON public.investments (group_id, start_date DESC);

-- investment_returns: per investment sorted by date (detail page, ROI rollup)
CREATE INDEX IF NOT EXISTS idx_investment_returns_inv_date
  ON public.investment_returns (investment_id, return_date DESC);

-- investment_returns: group-level SUM aggregation
CREATE INDEX IF NOT EXISTS idx_investment_returns_group_date
  ON public.investment_returns (group_id, return_date DESC);

-- meetings: dashboard query — scheduled meetings per group, soonest first
CREATE INDEX IF NOT EXISTS idx_meetings_group_status_scheduled
  ON public.meetings (group_id, status, scheduled_at ASC);

-- meetings: list default sort (newest first per group)
CREATE INDEX IF NOT EXISTS idx_meetings_group_created
  ON public.meetings (group_id, created_at DESC);

-- meetings: stats count by type
CREATE INDEX IF NOT EXISTS idx_meetings_group_type
  ON public.meetings (group_id, meeting_type);

-- meeting_attendance: attendance count by status per meeting (quorum check)
CREATE INDEX IF NOT EXISTS idx_attendance_meeting_status
  ON public.meeting_attendance (meeting_id, status);

-- meeting_attendance: member history across meetings
CREATE INDEX IF NOT EXISTS idx_attendance_member_status
  ON public.meeting_attendance (member_id, status);

-- meeting_resolutions: display order within a meeting
CREATE INDEX IF NOT EXISTS idx_resolutions_meeting_order
  ON public.meeting_resolutions (meeting_id, sort_order ASC);

-- meeting_resolutions: track unimplemented resolutions per group
CREATE INDEX IF NOT EXISTS idx_resolutions_group_pending
  ON public.meeting_resolutions (group_id, implemented, implementation_deadline ASC)
  WHERE implemented = false;
