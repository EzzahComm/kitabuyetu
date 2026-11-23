# Kitabu Yetu

Kitabu Yetu is a multi-tenant application for community organisations. This repository contains the public website, Bookkeeper, Chama Reminder, Changi$ha, the Enterprise portal, and the platform back office.

The application uses Next.js App Router, React, TypeScript, and PostgreSQL. Next.js route handlers run the API and provider webhooks. Vercel hosts the application. Supabase supplies hosted PostgreSQL and storage. PostgreSQL stores the job queue, with cron entry points and optional Upstash QStash dispatch. M-Pesa Daraja handles payments, TextSMS handles SMS, and the configured email adapter handles transactional mail. Sanity supplies public resources and articles.

## Local setup

Use Node.js 22 or later, npm, OpenSSL, and Docker Compose v2. Run these commands from the repository directory.

```bash
npm ci --include=dev
docker compose up --build -d --wait
cp -n .env.example .env.local
```

PostgreSQL applies the SQL migrations and bootstraps the local Supabase roles on a new volume. Existing volumes are preserved. Use an isolated Compose project and new volumes when testing migration replay. For example, set `DB_PORT=55432 REDIS_PORT=56379` and use `docker compose -p kitabuyetu-test up --build -d --wait`. Update `DATABASE_URL` to match the PostgreSQL port.

Populate the three local keys before starting the app. This command fills only blank entries in `.env.local`.

```bash
node --input-type=module -e '
  import { readFileSync, writeFileSync } from "node:fs";
  import { randomBytes } from "node:crypto";
  const file = ".env.local";
  const contents = readFileSync(file, "utf8").replace(
    /^(JWT_SECRET|ENCRYPTION_KEY|WORKER_SECRET)=$/gm,
    (_, name) => `${name}=${randomBytes(32).toString("hex")}`,
  );
  writeFileSync(file, contents, { mode: 0o600 });
'
npm run dev
```

The default sample configuration supports local rendering with a disposable database. The application uses the Upstash HTTPS REST API for sessions, locks, and caching. The Compose Redis service exposes the native Redis protocol. Use an isolated Upstash development endpoint and token or provider mocks for workflows that depend on Redis. Use Daraja sandbox or mocks for payments, and keep SMS, email, and other outbound integrations mocked or in dry run during local QA. Keep `.env.local` out of version control.

Check development liveness and the public homepage.

```bash
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:3000/ -o /dev/null
```

## Build and tests

```bash
npm run lint
npm run format:check
npm run typecheck
npm run test:ci -- --runInBand
npm run build
```

Next.js downloads font files during the production build. The integration suites create and delete fixtures and require a **disposable local database**. Run them sequentially when they use the same database.

```bash
DATABASE_URL=postgresql://kitabuyetu:changeme@127.0.0.1:5432/kitabuyetu npm run test:integration
```

For the least-privileged suite, follow the role provisioning step in the [CI workflow](.github/workflows/ci.yml), then set `TENANT_DATABASE_URL` for the same disposable database and run `npm run test:integration:app-tenant`.

## Communication maintenance

Member notifications start in [notifications.service.ts](lib/services/notifications.service.ts). SMS delivery and billing use [sms.service.ts](lib/services/sms.service.ts). Transactional email uses the [email provider](lib/email/provider.ts). The [job handlers](lib/jobs/handlers.ts) show which operations run asynchronously.

Run the unit tests for these paths locally. Run the integration command against the disposable database described above. It covers delivery deduplication, consent, credit accounting and messaging permissions.

```bash
npm run test:ci -- --runInBand --testPathPatterns='sms|email|notification|whatsapp'
DATABASE_URL="${TEST_DATABASE_URL:?Set TEST_DATABASE_URL to the disposable database URI}" npm run test:integration -- --testPathPatterns='sms|email|notification|whatsapp'
```

For reminder incidents, start with the [troubleshooting guide](docs/SMS_REMINDER_TROUBLESHOOTING.md). The [SMS invariants](docs/audits/SMS-INVARIANTS-v3.md) record the billing, delivery and tenant-isolation expectations behind the tests.

## API and group integrations

The [Postman collection](Kitabu_Yetu_API.postman_collection.json) defaults to `http://127.0.0.1:3000`. Set local variables for your test account, then copy the access token and rotating refresh token from each successful sign-in or refresh response. The [group domain guide](docs/integrations/GROUP-DOMAINS.md) covers sign-in from externally hosted group websites.

## Deployment

The [CI workflow](.github/workflows/ci.yml) tests the build and deploys qualifying changes to Vercel. Deployment setup, service bindings, and environment variables are documented in [DEPLOY.md](DEPLOY.md) and [.env.example](.env.example). The Docker images in the local setup provide PostgreSQL and Redis.
