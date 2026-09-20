-- =============================================================================
-- 199: Phase 12 groundwork — job applications
--
-- Job POSTING content (title, description, department, location) stays in
-- Sanity Studio (kitabuyetu-studio/) — that's already built, works, and
-- editors already use it (Phase 10 audit confirmed it live). This migration
-- only adds what Sanity structurally cannot hold: tracked candidate
-- applications, since Sanity is a content CMS with no per-visitor write path
-- back into it.
--
-- job_slug is therefore a SOFT reference (text, not a FK) to a Sanity job
-- document's slug — Postgres has no way to enforce referential integrity
-- against an external content system. job_title is denormalized at
-- application time so a candidate record stays readable even if the Sanity
-- posting is later edited or deleted (an application is a historical
-- record of what someone applied to, not a live join against current
-- content).
--
-- Platform-level (no group_id/organization_id), same as hr_employees (198)
-- and newsletter_subscribers (197) — Kitabu Yetu's own hiring, not a
-- multi-tenant job board (roadmap: "Do not build full marketplace yet").
--
-- hired_employee_id closes the loop into Phase 11: hiring a candidate
-- creates an hr_employees row and links back here, so "who did we hire and
-- from which application" is one join, not two systems that happen to agree.
-- =============================================================================

CREATE TYPE job_application_stage AS ENUM (
  'applied', 'screening', 'interview', 'offer', 'hired', 'rejected'
);

CREATE TABLE job_applications (
  id                UUID                    PRIMARY KEY DEFAULT gen_random_uuid(),

  job_slug          TEXT                    NOT NULL,
  job_title         TEXT                    NOT NULL,

  applicant_name    TEXT                    NOT NULL,
  applicant_email   TEXT                    NOT NULL,
  applicant_phone   TEXT,
  cover_note        TEXT,
  -- Storage OBJECT PATH in the private `resumes` bucket, not a public URL —
  -- every read goes through a freshly minted, short-lived signed URL
  -- (lib/supabase/storage.ts's existing pattern). Nullable: a resume is
  -- optional, never a hard blocker on submitting.
  resume_path       TEXT,

  stage             job_application_stage  NOT NULL DEFAULT 'applied',
  stage_notes       TEXT,
  source            VARCHAR(50)             NOT NULL DEFAULT 'website',

  -- Set only once, when this candidate is hired (updateApplicationStage
  -- never sets stage='hired' directly — only hireApplicant() does, in the
  -- same transaction as creating the hr_employees row).
  hired_employee_id UUID                    REFERENCES hr_employees (id) ON DELETE SET NULL,
  reviewed_by       UUID                    REFERENCES members (id) ON DELETE SET NULL,

  created_at        TIMESTAMPTZ             NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ             NOT NULL DEFAULT NOW(),

  CONSTRAINT job_applications_hired_consistent CHECK (
    (stage = 'hired') = (hired_employee_id IS NOT NULL)
  )
);

CREATE INDEX idx_job_applications_job_slug ON job_applications (job_slug);
CREATE INDEX idx_job_applications_stage    ON job_applications (stage);
CREATE INDEX idx_job_applications_created  ON job_applications (created_at DESC);
CREATE INDEX idx_job_applications_email    ON job_applications (lower(applicant_email));

ALTER TABLE job_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_applications FORCE ROW LEVEL SECURITY;

-- Candidate PII, same tier as hr_employees.
CREATE POLICY rls_job_applications_super_admin ON job_applications
  FOR ALL
  USING ((SELECT is_super_admin()));

REVOKE ALL ON public.job_applications FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_applications TO service_role;

-- ── Storage bucket for resumes ──────────────────────────────────────────────
-- Guarded exactly like migration 181's `reports` bucket: storage.buckets is
-- part of Supabase's Storage extension and doesn't exist on a plain
-- Postgres image (e.g. the CI integration-test container).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'storage' AND table_name = 'buckets'
  ) THEN
    EXECUTE $sql$
      INSERT INTO storage.buckets (id, name, public)
      VALUES ('resumes', 'resumes', false)
      ON CONFLICT (id) DO NOTHING
    $sql$;
  END IF;
END $$;
