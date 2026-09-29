# Platform activity & administrator alerts

Every material platform event is written once to `platform_activity_logs` and, depending on its
routing, alerted to the official Kitabu Yetu contacts by SMS and/or email.

```
business logic (commits) ─► emitActivity() ─► platform_activity_logs (audit)
                                   │
                    aggregate? ────┴──── individual
                        │                     │
                  digest job (≤60 min)   notification_deliveries (sms/email × recipient)
                                              ├─ inline send (HIGH/CRITICAL)
                                              └─ job_queue `admin_alert_deliver` (retry, backoff, max 5)
```

## Emitting an event (all products)

```ts
import { emitActivity, ActivityEventType } from '@/lib/notifications';

await emitActivity({
  type: ActivityEventType.SOMETHING_HAPPENED, // add it to lib/notifications/activity-events.ts
  dedupKey: `thing:${id}:happened`, // idempotency key (recommended)
  group: { id: groupId, name: '' }, // names are filled in from ids
  actor: { userId },
  transaction: { reference, amount, currency: 'KES', status },
  metadata: { anything: 'non-secret' }, // secrets are stripped by key name
});
```

- Call it **after** the business operation committed. It never throws and never rolls anything back.
- Inside an open DB transaction (payment callbacks) use `recordActivityInTx(db, …)` instead: the row
  commits with the payment (transactional outbox) and delivery is picked up by the 5-minute job.
- A new event type needs only an entry in the registry (title, severity, default channels, aggregate).

## Routing & severity

Defaults live in `activity-events.ts`; per-event overrides in `admin_notification_preferences`
(`sms_enabled`, `email_enabled`, `aggregate`; NULL = default). INFO → email (unless listed), WARNING/HIGH/
CRITICAL → SMS + email. Routine high-volume events (`aggregate`) go to the digest; a routine payment at or
above `KITABU_HIGH_VALUE_THRESHOLD_KES` (default 100,000) is alerted individually as HIGH.

## Configuration

| Variable                          | Purpose                                          |
| --------------------------------- | ------------------------------------------------ |
| `KITABU_ADMIN_ALERT_PHONE`        | SMS recipient(s), e.g. `+254182625807`           |
| `KITABU_ADMIN_ALERT_EMAIL`        | Email recipient(s), e.g. `info@kitabuyetu.co.ke` |
| `KITABU_HIGH_VALUE_THRESHOLD_KES` | Individual-alert threshold for routine payments  |
| `KITABU_ADMIN_DIGEST_MINUTES`     | Digest window (min 5, default 60)                |

Delivery uses the existing SMS (TextSMS) and email (Resend/SMTP) providers. Admin SMS goes straight to the
provider, not through the group-billed path, so alerts never consume a customer's credits.

## Availability monitoring

`system_health_check` (every 5 min) checks the database, Redis, job-queue lag, the SMS circuit breaker and the
M-Pesa callback backlog, records a heartbeat and reports a gap as downtime once the app is back. A burst of
server errors raises `ERROR_SPIKE`. If the database is unreachable, HIGH/CRITICAL alerts are sent directly
(unpersisted). **A total outage can only be reported by an external monitor** — point one at `/api/health` and
`/api/health/deep` and route its alerts to the contacts above.

## Privacy

Secrets (`password`, `otp`, `token`, `api_key`, `pin`, `credential`, …) are stripped from every payload by key
name. SMS bodies contain only whitelisted fields (never a metadata dump). Campaign donations record no donor
identity. Group SMS alerts include a message preview so administrators can spot misuse; that content is the
group's own message text.

## Operating

- Dashboard: `/admin/activity` (super-admin): filters, delivery status per channel, retry for failed deliveries.
- Tables are RLS-protected (super-admin SELECT only, no grants to `anon`/`authenticated`).
