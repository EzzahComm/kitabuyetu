# Kitabu Yetu — Deployment Guide (Vercel + Supabase)

## Stack

| Service | Provider |
|---------|---------|
| Frontend + API | Vercel (serverless) |
| Database (PostgreSQL + RLS) | Supabase |
| Redis (sessions, rate-limit, M-Pesa cache) | Upstash |
| Email | Resend |
| SMS | Africa's Talking |
| Payments | Safaricom Daraja (M-Pesa) |

---

## Part 1 — Supabase Setup

### 1a. Create project

1. Go to https://supabase.com and create a new project.
2. Note your **Project Ref** (e.g. `qztcgryhoanennsizcll`).

### 1b. Get the direct DATABASE_URL

> ⚠️ Use the **DIRECT** connection (port 5432), NOT pgBouncer (port 6543).  
> The app uses `SET LOCAL` session variables for Row Level Security.  
> pgBouncer transaction mode does not support this.

**Supabase Dashboard → Settings → Database → Connection string → URI**

```
postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
```

### 1c. Push migrations

```bash
npm install -g supabase
supabase login
supabase link --project-ref [YOUR-PROJECT-REF]
supabase db push
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

Every table should show `rowsecurity = true`.

---

## Part 2 — Upstash Redis

1. Go to https://console.upstash.com and create a free Redis database.
2. Copy the **ioredis** compatible URL (starts with `rediss://`).
3. Set it as `REDIS_URL` in Vercel environment variables.

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

Add every variable from `.env.example` in:  
**Vercel Dashboard → Project → Settings → Environment Variables**

Required variables:

| Variable | Where to get |
|----------|-------------|
| `DATABASE_URL` | Supabase → Settings → Database → URI (port 5432) |
| `REDIS_URL` | Upstash console → ioredis URL |
| `JWT_SECRET` | `openssl rand -hex 32` |
| `ENCRYPTION_KEY` | `openssl rand -hex 32` |
| `WORKER_SECRET` | `openssl rand -hex 32` |
| `CRON_SECRET` | `openssl rand -hex 32` (you choose — same value goes into Supabase pg_cron SQL) |
| `MPESA_CONSUMER_KEY` | Safaricom Daraja portal |
| `MPESA_CONSUMER_SECRET` | Safaricom Daraja portal |
| `MPESA_SHORTCODE` | Safaricom Daraja portal |
| `MPESA_PASSKEY` | Safaricom Daraja portal |
| `MPESA_CALLBACK_BASE_URL` | `https://kitabuyetu.vercel.app` (no trailing slash, callback paths derived) |
| `TEXTSMS_API_KEY` | TextSMS Kenya dashboard |
| `TEXTSMS_PARTNER_ID` | TextSMS Kenya dashboard |
| `RESEND_API_KEY` | Resend dashboard |
| `EMAIL_FROM` | Verified sender address in Resend |
| `NEXT_PUBLIC_APP_URL` | Your Vercel deployment URL |

### 4d. Deploy

```bash
vercel --prod
```

### 4e. Verify the deployment

```bash
# Health check
curl -I https://kitabuyetu.vercel.app/api/v1/groups

# Manual cron trigger (replace YOUR_WORKER_SECRET)
curl -X POST https://kitabuyetu.vercel.app/api/v1/workers/cron \
  -H "Authorization: Bearer YOUR_WORKER_SECRET"
```

---

## Part 5 — Supabase Scheduler (pg_cron + pg_net)

> **Why not Vercel Cron?**  
> Vercel Hobby plan limits cron jobs to once per day.  
> Supabase pg_cron runs in the database itself — no plan restrictions.

### 5a. Enable extensions

In **Supabase Dashboard → Database → Extensions**, enable:

- `pg_cron`
- `pg_net`

### 5b. Run the job queue migration

```bash
supabase db push
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
    body    := jsonb_build_object('source', 'pg_cron')::text
  );
  $$
);
```

Replace `YOUR-APP.vercel.app` with your actual Vercel domain and `YOUR_CRON_SECRET` with the value from Step 4c.

### 5d. Verify the schedule

```sql
-- See all scheduled jobs
SELECT * FROM cron.job;

-- See recent execution history
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;

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
      body    := jsonb_build_object('source', 'pg_cron')::text
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
- [ ] Register callback URL (one-time): `POST /api/v1/mpesa/register-urls` with your Bearer token
- [ ] Vercel deployment IPs are dynamic — do NOT whitelist Vercel IPs at Safaricom.  
      Safaricom's IP whitelist is applied at **our** callback (we validate their IPs, not the reverse).

---

## Part 7 — Email (Resend)

1. Add and verify your sending domain in Resend.
2. Set SPF, DKIM, DMARC records in your DNS.
3. Set `EMAIL_FROM` to an address at your verified domain.

---

## Quick reference

```bash
# Tail production logs
vercel logs --prod

# Redeploy after a code change
git push origin main   # auto-deploys if connected to GitHub

# Run migrations after a schema change (includes 013_job_queue.sql)
supabase db push

# Trigger cron manually (uses WORKER_SECRET — separate from CRON_SECRET)
curl -X POST https://kitabuyetu.vercel.app/api/v1/workers/cron \
  -H "Authorization: Bearer YOUR_WORKER_SECRET"

# Trigger via the pg_cron endpoint (uses CRON_SECRET)
curl -X POST https://kitabuyetu.vercel.app/api/cron \
  -H "Authorization: Bearer YOUR_CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"source":"manual"}'

# Inspect job queue in Supabase SQL Editor
# SELECT status, count(*) FROM job_queue GROUP BY status;
# SELECT * FROM job_logs ORDER BY created_at DESC LIMIT 50;
```
