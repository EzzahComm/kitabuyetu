-- Migration: 029 — Remove SECURITY DEFINER from updated_at trigger functions
--
-- Three trigger functions were created directly in the database (not through
-- migrations) with SECURITY DEFINER. This is wrong: trigger functions run in
-- the context of the statement that fired them and have no need for elevated
-- owner privileges. SECURITY DEFINER on a trigger function also exposes it as
-- a callable RPC endpoint (/rest/v1/rpc/) with owner-level privileges.
--
-- This migration recreates all three as plain SECURITY INVOKER functions and
-- records the correct state for future fresh deployments.

CREATE OR REPLACE FUNCTION public.update_investments_updated_at()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_meetings_updated_at()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_welfare_requests_updated_at()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Ensure the triggers are wired correctly (idempotent)
DROP TRIGGER IF EXISTS trg_investments_updated_at    ON public.investments;
DROP TRIGGER IF EXISTS trg_meetings_updated_at       ON public.meetings;
DROP TRIGGER IF EXISTS trg_welfare_requests_updated_at ON public.welfare_requests;

CREATE TRIGGER trg_investments_updated_at
  BEFORE UPDATE ON public.investments
  FOR EACH ROW EXECUTE FUNCTION public.update_investments_updated_at();

CREATE TRIGGER trg_meetings_updated_at
  BEFORE UPDATE ON public.meetings
  FOR EACH ROW EXECUTE FUNCTION public.update_meetings_updated_at();

CREATE TRIGGER trg_welfare_requests_updated_at
  BEFORE UPDATE ON public.welfare_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_welfare_requests_updated_at();
