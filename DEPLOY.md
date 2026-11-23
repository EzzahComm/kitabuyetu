# Kitabu Yetu — Deployment Guide (Vercel + Supabase)

## Stack

| Service                                    | Provider                  |
| ------------------------------------------ | ------------------------- |
| Frontend + API                             | Vercel (serverless)       |
| Database (PostgreSQL + RLS)                | Supabase                  |
| Redis (sessions, rate-limit, M-Pesa cache) | Upstash                   |
| Email                                      | Resend                    |
| SMS                                        | TextSMS (textsms.co.ke)   |
| Payments                                   | Safaricom Daraja (M-Pesa) |

---

## Part 1 — Supabase Setup

### 1a. Create project

1. Go to https://supabase.com and create a new project.
2. Copy the project reference from its dashboard.

### 1b. Get the DATABASE_URL

Use the Supavisor **Session pooler** URI from the project's **Connect** dialog. Copy the supplied username, hostname and port. Set `DATABASE_URL` for the server's administrative connection and `TENANT_DATABASE_URL` for the `app_tenant` connection to the same database. The tenant pool runs group requests with row-level security. [Role provisioning](scripts/ops/create-app-tenant-role.sql)

### 1c. Push migrations

```bash
npx supabase login
npx supabase link --project-ref "$SUPABASE_PROJECT_REF"
npx supabase db push --dry-run
npx supabase db push
```

Verify in **Supabase Dashboard → Table Editor** that all tables were created.

### 1d. Verify RLS

In the Supabase SQL editor run:

```sql
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
```

Check that tenant-owned tables have RLS enabled. Exercise both group contexts against a disposable database with the [least-privileged integration suite](README.md#build-and-tests).

---

## Part 2 — Upstash Redis

Create an Upstash Redis database. Set `REDIS_URL` to its credential-bearing `rediss://` connection string. The app uses the Upstash HTTPS REST interface for session storage and rate limiting.

---

## Part 3 — Generate secrets

Run these locally to generate strong secrets:

```bash
# JWT_SECRET and ENCRYPTION_KEY
openssl rand -hex 32

# WORKER_SECRET
openssl rand -hex 32
```

---

## Part 4 — Vercel Deployment

### 4a. Install Vercel CLI

```bash
npm install -g vercel
```

### 4b. Link the project

```bash
vercel link
```

### 4c. Set environment variables

Configure the production values in **Vercel Dashboard → Project → Settings → Environment Variables**. The local template includes optional provider settings. [Environment template](.env.example)

| Variable                  | Where to get                                                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`            | Supabase → Settings → Database → URI, "Session pooler" tab (port 5432, `aws-0-<region>.pooler.supabase.com` host — see 1b above) |
| `TENANT_DATABASE_URL`     | Required in production. Use the session-pooler URI for the least-privileged `app_tenant` role (see section 1b).                  |
| `REDIS_URL`               | Upstash connection string with its REST credential (section 2)                                                                   |
| `JWT_SECRET`              | `openssl rand -hex 32`                                                                                                           |
| `ENCRYPTION_KEY`          | `openssl rand -hex 32`                                                                                                           |
| `WORKER_SECRET`           | `openssl rand -hex 32`                                                                                                           |
| `CRON_SECRET`             | `openssl rand -hex 32` (you choose — same value goes into Supabase pg_cron SQL)                                                  |
| `MPESA_CONSUMER_KEY`      | Safaricom Daraja portal                                                                                                          |
| `MPESA_CONSUMER_SECRET`   | Safaricom Daraja portal                                                                                                          |
| `MPESA_SHORTCODE`         | Safaricom Daraja portal                                                                                                          |
| `MPESA_PASSKEY`           | Safaricom Daraja portal                                                                                                          |
| `MPESA_CALLBACK_BASE_URL` | The deployment’s HTTPS callback origin                                                                                           |
| `TEXTSMS_API_KEY`         | TextSMS Kenya dashboard                                                                                                          |
| `TEXTSMS_PARTNER_ID`      | TextSMS Kenya dashboard                                                                                                          |
| `RESEND_API_KEY`          | Resend dashboard                                                                                                                 |
| `EMAIL_FROM`              | Verified sender address in Resend                                                                                                |
| `NEXT_PUBLIC_APP_URL`     | Your Vercel deployment URL                                                                                                       |

### 4d. Deploy

```bash
vercel --prod
```

### 4e. Verify the deployment

Set `APP_ORIGIN` to the deployed HTTPS origin. The liveness endpoint is public.

```bash
curl -fsS "${APP_ORIGIN:?Set APP_ORIGIN}/api/health"
```

The [monitoring guide](PRODUCTION_MONITORING.md) covers database and Redis connectivity.

---

## Part 5 — Supabase Scheduler (pg_cron + pg_net)

> The scheduler uses Supabase `pg_cron` and `pg_net` to call the application every five minutes.

### 5a. Enable extensions

In **Supabase Dashboard → Database → Extensions**, enable:

- `pg_cron`
- `pg_net`

### 5b. Run the job queue migration

```bash
npx supabase db push
```

This applies `supabase/migrations/20260526120000_041_job_queue.sql` which creates the `job_queue` and `job_logs` tables.

### 5c. Schedule the cron job

Open **Supabase Dashboard → SQL Editor** and run:

```sql
SELECT cron.schedule(
  'kitabuyetu-every-5-min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://YOUR-APP.vercel.app/api/cron',
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'Authorization', 'Bearer YOUR_CRON_SECRET'
               ),
    body    := jsonb_build_object('source', 'pg_cron')
  );
  $$
);
```

Replace `YOUR-APP.vercel.app` with your actual Vercel domain and `YOUR_CRON_SECRET` with the value from Step 4c.

### 5c-1. Schedule cron.job_run_details pruning

`cron.job_run_details` has no retention of its own — with a 5-minute job
running 288 times/day, it grows ~30 MB/month of history nothing reads
(docs/audits/optimization-2026-09/verified/
postgres-schema-indexing-and-storage-eff.json). Same reasoning as migration
042's header comment: this touches the `cron` schema, which CI's plain
Postgres doesn't have, so it's a runtime step here rather than a migration.
Run once per environment (Supabase Dashboard → SQL Editor):

```sql
SELECT cron.schedule(
  'kitabuyetu-prune-cron-job-run-details',
  '0 3 * * *',
  $$DELETE FROM cron.job_run_details WHERE start_time < now() - interval '7 days'$$
);
```

### 5d. Verify the schedule

```sql
-- See all scheduled jobs
SELECT jobid, jobname, schedule, active FROM cron.job;

-- See recent execution history
SELECT jobid, runid, status, start_time, end_time FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;

-- See job queue state
SELECT status, count(*) FROM job_queue GROUP BY status;

-- See recent job logs
SELECT jq.type, jl.status, jl.message, jl.duration_ms, jl.created_at
FROM job_logs jl
JOIN job_queue jq ON jq.id = jl.job_id
ORDER BY jl.created_at DESC LIMIT 50;
```

### 5e. Update the URL after redeployment

If your Vercel domain changes:

```sql
SELECT cron.alter_job(
  job_id  := (SELECT jobid FROM cron.job WHERE jobname = 'kitabuyetu-every-5-min'),
  command := $$
    SELECT net.http_post(
      url     := 'https://NEW-DOMAIN.vercel.app/api/cron',
      headers := jsonb_build_object(
                   'Content-Type',  'application/json',
                   'Authorization', 'Bearer YOUR_CRON_SECRET'
                 ),
      body    := jsonb_build_object('source', 'pg_cron')
    );
  $$
);
```

### 5f. Pause / resume

```sql
-- Pause
SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'kitabuyetu-every-5-min'),
  active := false
);

-- Resume
SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'kitabuyetu-every-5-min'),
  active := true
);
```

---

## Part 6 — M-Pesa Go-Live

- [ ] Set `MPESA_ENV=production` in Vercel env vars
- [ ] Update shortcode + passkey to production values
- [ ] Ensure `MPESA_CALLBACK_BASE_URL` is your production Vercel URL (HTTPS, no trailing slash)
- [ ] Register C2B callback URLs using the authenticated platform administrator endpoint `POST /api/admin/mpesa/register-c2b` with a super-admin backoffice session. The GET handler shows the configured callback URLs.

---

## Part 7 — Email (Resend)

1. Add and verify your sending domain in Resend.
2. Set SPF, DKIM, DMARC records in your DNS.
3. Set `EMAIL_FROM` to an address at your verified domain.

---

## Quick reference

```bash
vercel logs --prod
npx supabase migration list --linked
```

For an intentional queue run, send a POST to `/api/cron` with the configured `CRON_SECRET` in the Authorization bearer header. The handler enqueues due work and processes a batch.
