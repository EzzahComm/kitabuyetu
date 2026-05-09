# Kitabu Yetu — Deployment Guide

## Stack

| Service | Provider |
|---------|---------|
| Database (PostgreSQL) | Supabase (project: `qztcgryhoanennsizcll`) |
| Redis (sessions, M-Pesa cache, rate-limit) | Upstash Redis |
| App server | VPS + PM2 cluster **or** any Node.js host |
| Reverse proxy | Nginx (see `nginx.conf`) |

---

## Part 1 — Supabase Setup

### 1a. Install Supabase CLI (once)

```bash
npm install -g supabase
# or via npx: npx supabase <command>
```

### 1b. Authenticate and link

```bash
supabase login                                      # opens browser
supabase link --project-ref qztcgryhoanennsizcll    # links local repo
```

### 1c. Push all migrations

```bash
supabase db push
```

This runs all 11 files in `supabase/migrations/` against the remote project in order.
Check the Supabase dashboard → Table Editor to confirm tables were created.

### 1d. Get your DATABASE_URL

⚠️ **Use the DIRECT connection (port 5432), NOT pgBouncer (port 6543).**

The app uses `SET LOCAL` session variables for Row Level Security.
pgBouncer transaction mode does not support this.

Go to: **Supabase Dashboard → Settings → Database → Connection string → URI**

It looks like:
```
postgresql://postgres:[PASSWORD]@db.qztcgryhoanennsizcll.supabase.co:5432/postgres
```

---

## Part 2 — Upstash Redis

1. Go to https://console.upstash.com and create a free Redis database
2. Copy the **ioredis** compatible URL (starts with `rediss://`)
3. Set it as `REDIS_URL` in your `.env`

---

## Part 3 — Environment Variables

```bash
cp .env.example .env
nano .env   # fill in all values
```

Required values:

| Key | Where to get |
|-----|-------------|
| `DATABASE_URL` | Supabase → Settings → Database → URI (port 5432 direct) |
| `REDIS_URL` | Upstash console → ioredis URL |
| `JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
| `MPESA_CONSUMER_KEY/SECRET` | Safaricom Developer Portal |
| `MPESA_CALLBACK_URL` | `https://yourdomain.com/api/v1/mpesa/callback` |
| `AT_API_KEY` | Africa's Talking dashboard |
| `ENCRYPTION_KEY` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

---

## Part 4 — Build & Deploy

```bash
npm install
npm run build
pm2 start ecosystem.config.js
pm2 save && pm2 startup    # follow printed command for auto-restart on reboot
```

---

## Part 5 — Nginx

```bash
sudo cp nginx.conf /etc/nginx/sites-available/kitabuyetu
# Replace yourdomain.com with your actual domain
sudo sed -i 's/yourdomain.com/yourrealdomain.com/g' /etc/nginx/sites-available/kitabuyetu
sudo ln -s /etc/nginx/sites-available/kitabuyetu /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# SSL
sudo certbot --nginx -d yourrealdomain.com
```

---

## Part 6 — M-Pesa Go-Live

- [ ] `MPESA_ENV=production`
- [ ] Update shortcode + passkey in `.env`
- [ ] Ensure `MPESA_CALLBACK_URL` is publicly accessible over HTTPS
- [ ] Register C2B URLs (one-time): `POST /api/v1/mpesa/register-urls` with your Bearer token

---

## Quick reference

```bash
# View app logs
pm2 logs kitabuyetu

# Restart after a code update
git pull && npm run build && pm2 reload kitabuyetu

# Re-run migrations after a schema change
supabase db push

# Pull remote DB changes to local (for diffing)
supabase db pull
```
