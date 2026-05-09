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
| `MPESA_CONSUMER_KEY` | Safaricom Daraja portal |
| `MPESA_CONSUMER_SECRET` | Safaricom Daraja portal |
| `MPESA_SHORTCODE` | Safaricom Daraja portal |
| `MPESA_PASSKEY` | Safaricom Daraja portal |
| `MPESA_CALLBACK_URL` | `https://your-app.vercel.app/api/v1/mpesa/callback` |
| `AT_API_KEY` | Africa's Talking dashboard |
| `RESEND_API_KEY` | Resend dashboard |
| `EMAIL_FROM` | Verified sender address in Resend |
| `NEXT_PUBLIC_APP_URL` | Your Vercel deployment URL |

> `CRON_SECRET` is generated automatically by Vercel once you deploy with `vercel.json`.  
> Copy it from the dashboard and add it as an env var so the cron route can validate it.

### 4d. Deploy

```bash
vercel --prod
```

### 4e. Verify the deployment

```bash
# Health check
curl -I https://your-app.vercel.app/api/v1/groups

# Confirm cron is registered
vercel cron ls
```

---

## Part 5 — Vercel Cron

`vercel.json` configures a cron job that calls `GET /api/v1/workers/cron` every 5 minutes.  
Vercel automatically adds `Authorization: Bearer <CRON_SECRET>` to each request.

To verify cron is running:

```bash
vercel logs --prod | grep workers/cron
```

---

## Part 6 — M-Pesa Go-Live

- [ ] Set `MPESA_ENV=production` in Vercel env vars
- [ ] Update shortcode + passkey to production values
- [ ] Ensure `MPESA_CALLBACK_URL` is your production Vercel URL
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

# Re-run migrations after a schema change
supabase db push

# Trigger cron manually (replace with your WORKER_SECRET)
curl -X POST https://your-app.vercel.app/api/v1/workers/cron \
  -H "Authorization: Bearer YOUR_WORKER_SECRET"
```
