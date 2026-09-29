# Department mailboxes

Source of truth: `lib/departments.ts`. Any address can be overridden per environment with
`KITABU_EMAIL_<DEPARTMENT>` (e.g. `KITABU_EMAIL_BILLING`) without a code change.

| Mailbox       | Department                | Who works it today      | What reaches it                                                                                                                                                                                                                                                                                  |
| ------------- | ------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `info@`       | General / official        | super_admin             | Public contact address (footer, /contact, legal pages); the official alert address — receives **every** platform alert; the SMTP sender (`EMAIL_FROM`)                                                                                                                                           |
| `admin@`      | Platform administration   | super_admin             | Security events, role/permission/config changes, downtime and system failures, error spikes, campaign submissions, withdrawal approvals. Also set `EMAIL_ADMIN=admin@kitabuyetu.co.ke` — the existing staff channel (SMS-provider health, background-control alerts, overdue-invoice staff copy) |
| `billing@`    | Billing & finance         | super_admin             | Subscription, trial, payment, invoice, refund and reversal alerts; withdrawal releases; unrouted PayBill payments; the periodic activity digest. Customer-facing overdue-invoice notices name it as the contact; billing/receipt emails carry it as Reply-To                                     |
| `support@`    | Customer support          | `support` platform role | Account lockouts, password/login issues, SMS delivery failures and low credit, unrouted payments. Public /support page and the transactional-email footer; auth/contact emails carry it as Reply-To                                                                                              |
| `hr@`         | HR & recruiting           | super_admin             | New job applications from /careers (email alert with a link to `/admin/careers`); all public "careers" links (there is no `careers@` mailbox)                                                                                                                                                    |
| `enterprise@` | Enterprise & partnerships | super_admin             | New/approved/suspended organizations and organization-admin changes; the enterprise contact link on /enterprise-solutions                                                                                                                                                                        |

## How alerts are routed

`departmentsForEvent(eventType)` picks the departments to copy; `getAdminRecipients(eventType)` returns
`info@` (always) plus those department mailboxes. SMS always goes to the single official alert phone.
Each (event, channel, recipient) is its own tracked delivery with retries and an idempotency key.
Add a routing rule by editing the `EXACT` / `PREFIX` tables in `lib/departments.ts`.

## Sending

- **From** stays `info@` (`EMAIL_FROM`): cPanel SMTP only authorises the mailbox it logs in as. Departments are
  reached through **Reply-To** (`lib/services/email.service.ts`), so replies land in the right inbox.
- To send _as_ another department later, give it its own SMTP credentials (or a shared relay) — not needed today.

## Users

Platform roles are `super_admin`, `support`, `organization_coordinator`, `member`. There are no dedicated
billing / HR / enterprise roles yet, so those mailboxes are worked by super_admins. Adding roles means an RBAC
and migration change; say if you want it.

## Inbound

Nothing in the app reads these mailboxes. The public contact form opens the visitor's mail app addressed to
`info@`; job applications are stored in `job_applications` and also alert `hr@`.
