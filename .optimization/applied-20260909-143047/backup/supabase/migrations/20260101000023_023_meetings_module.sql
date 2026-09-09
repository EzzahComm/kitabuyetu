-- ─────────────────────────────────────────────────────────────────────────────
-- 023: Meetings module — meetings, attendance, resolutions, RLS
--
-- Amended 2026-05-26: actor FKs changed from public.users(id) to
-- public.members(id). The original file referenced a non-existent public.users
-- table; the live DB was hand-fixed at deploy time. This rewrite makes the
-- repo file match what's actually on Supabase, so fresh deploys produce the
-- same schema. No data migration needed.
-- ─────────────────────────────────────────────────────────────────────────────

-- Enums
CREATE TYPE public.meeting_type AS ENUM (
  'regular','special','agm','emergency','committee','training'
);

CREATE TYPE public.meeting_status AS ENUM (
  'scheduled','in_progress','completed','cancelled','postponed'
);

CREATE TYPE public.attendance_status AS ENUM ('present','absent','excused','late');

-- ── Meetings ──────────────────────────────────────────────────────────────────
CREATE TABLE public.meetings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id         uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  title            varchar(255) NOT NULL,
  meeting_type     public.meeting_type NOT NULL DEFAULT 'regular',
  status           public.meeting_status NOT NULL DEFAULT 'scheduled',
  scheduled_at     timestamptz NOT NULL,
  ended_at         timestamptz,
  venue            varchar(255),
  is_virtual       boolean NOT NULL DEFAULT false,
  meeting_link     text,
  agenda           jsonb NOT NULL DEFAULT '[]',
  minutes          text,
  quorum_required  integer CHECK (quorum_required > 0),
  quorum_achieved  integer CHECK (quorum_achieved >= 0),
  created_by       uuid NOT NULL REFERENCES public.members(id),
  chaired_by       uuid REFERENCES public.members(id),
  secretary_id     uuid REFERENCES public.members(id),
  attachments      jsonb NOT NULL DEFAULT '[]',
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX meetings_group_id_idx     ON public.meetings(group_id);
CREATE INDEX meetings_status_idx       ON public.meetings(status);
CREATE INDEX meetings_scheduled_at_idx ON public.meetings(scheduled_at DESC);
CREATE INDEX meetings_type_idx         ON public.meetings(meeting_type);

CREATE TRIGGER trg_meetings_updated_at
  BEFORE UPDATE ON public.meetings
  FOR EACH ROW EXECUTE FUNCTION private.set_updated_at();

-- ── Meeting attendance ────────────────────────────────────────────────────────
CREATE TABLE public.meeting_attendance (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id   uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  group_id     uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  member_id    uuid NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  status       public.attendance_status NOT NULL DEFAULT 'absent',
  excuse_reason text,
  fine_amount  numeric NOT NULL DEFAULT 0,
  fine_waived  boolean NOT NULL DEFAULT false,
  marked_at    timestamptz NOT NULL DEFAULT now(),
  marked_by    uuid REFERENCES public.members(id),
  UNIQUE (meeting_id, member_id)
);

CREATE INDEX meeting_attendance_meeting_id_idx ON public.meeting_attendance(meeting_id);
CREATE INDEX meeting_attendance_group_id_idx   ON public.meeting_attendance(group_id);
CREATE INDEX meeting_attendance_member_id_idx  ON public.meeting_attendance(member_id);

-- ── Meeting resolutions ───────────────────────────────────────────────────────
CREATE TABLE public.meeting_resolutions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id             uuid NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  group_id               uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  sort_order             integer NOT NULL DEFAULT 0,
  resolution_text        text NOT NULL,
  proposed_by            uuid REFERENCES public.members(id),
  seconded_by            uuid REFERENCES public.members(id),
  votes_for              integer NOT NULL DEFAULT 0,
  votes_against          integer NOT NULL DEFAULT 0,
  votes_abstain          integer NOT NULL DEFAULT 0,
  status                 varchar(20) NOT NULL DEFAULT 'carried',
  implementation_deadline date,
  responsible_party      uuid REFERENCES public.members(id),
  implemented            boolean NOT NULL DEFAULT false,
  implemented_at         timestamptz,
  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX meeting_resolutions_meeting_id_idx ON public.meeting_resolutions(meeting_id);
CREATE INDEX meeting_resolutions_group_id_idx   ON public.meeting_resolutions(group_id);

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_resolutions ENABLE ROW LEVEL SECURITY;

CREATE POLICY meetings_group_isolation ON public.meetings
  USING (group_id = current_setting('app.current_group_id', true)::uuid);

CREATE POLICY meeting_attendance_group_isolation ON public.meeting_attendance
  USING (group_id = current_setting('app.current_group_id', true)::uuid);

CREATE POLICY meeting_resolutions_group_isolation ON public.meeting_resolutions
  USING (group_id = current_setting('app.current_group_id', true)::uuid);
