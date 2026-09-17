# BUILD CHANGISHA — KITABU YETU

You are working inside the existing Kitabu Yetu repository.

Your task is to build CHANGISHA as a first-class Kitabu Yetu product.

## PRODUCT

Kitabu Yetu products:

1. Bookkeeper
2. Chama Reminder
3. Changisha

Changisha positioning:

"Fund what matters."

Changisha is a fundraising and contribution-mobilization platform for:

- VSLAs
- Chamas
- Welfare groups
- Community projects
- CBOs
- NGOs
- Rotary and other clubs
- Organizations
- Approved initiatives

Changisha must remain part of the existing Kitabu Yetu platform.

DO NOT create a separate unrelated application.

DO NOT rewrite the existing application.

DO NOT break existing authentication, tenancy, RBAC, payments, Bookkeeper, Chama Reminder, SMS, email, or marketing functionality.

---

# PHASE 1 — AUDIT FIRST

Before writing code, inspect the actual repository.

Run and inspect:

git status
git branch --show-current
Get-ChildItem
Get-Content package.json

Then inspect:

- Next.js architecture
- App Router/pages
- Tailwind
- existing UI components
- Flowbite if installed
- Nextly marketing components
- Supabase configuration
- database schema
- migrations
- RLS
- authentication
- tenant architecture
- Organization model
- Group model
- RBAC
- Bookkeeper
- M-Pesa/Daraja
- SMS
- email
- notifications
- reporting
- audit logs
- API conventions
- tests
- environment variables
- proxy/middleware

Search the repository for:

fundraising
campaign
donation
contribution
payment
M-Pesa
Daraja
organization
group
beneficiary
project
Bookkeeper
Chama Reminder

Determine whether Changisha functionality already exists.

REUSE existing infrastructure wherever possible.

DO NOT create duplicate payment, accounting, authentication, tenant, notification, or user systems.

STOP after the audit and report the findings before making major architectural changes.

---

# PHASE 2 — ARCHITECTURE

Design Changisha around:

Campaign
→ Contribution
→ Payment
→ Reconciliation
→ Financial record
→ Impact reporting

Changisha must NOT create a second accounting/balance engine.

Successful campaign contributions should eventually integrate with Bookkeeper using the existing financial architecture.

Do not directly manipulate balances.

Respect the existing:

Platform
Organization
Group
User
Membership
RBAC

architecture.

Campaign ownership must be tied to the appropriate existing Organization or Group.

---

# PHASE 3 — DATABASE

Design additive Supabase migrations.

Potential entities:

campaigns
campaign_updates
campaign_contributions
campaign_supporters
campaign_payment_transactions
campaign_beneficiaries
campaign_categories
campaign_media
campaign_team_members
campaign_notifications
campaign_audit_logs

Inspect existing tables before creating any of these.

Avoid duplicate data where existing entities can be reused.

Campaign should support:

- public reference ID
- organization/group
- title
- slug
- short description
- story
- target amount
- currency
- start date
- end date
- status
- visibility
- beneficiary
- organizer
- cover image
- category
- location
- payment destination
- published_at
- created_at
- updated_at

Prefer deriving raised amounts from successful immutable contribution/payment records rather than trusting a mutable amount_raised field.

Implement:

- foreign keys
- indexes
- constraints
- RLS
- appropriate unique constraints

Never expose internal database IDs publicly if an existing public reference convention exists.

---

# PHASE 4 — CAMPAIGN LIFECYCLE

Use explicit states:

draft
pending_review
published
paused
completed
cancelled
archived

Define valid transitions.

Enforce transitions server-side.

Public users can only see eligible published campaigns.

---

# PHASE 5 — PUBLIC CAMPAIGN

Create:

/changisha/[campaign-slug]

The page should include:

- Changisha branding
- campaign title
- campaign image
- campaign story
- target
- amount raised
- percentage achieved
- contributor count
- deadline/status
- SUPPORT THIS CAMPAIGN CTA
- organizer
- beneficiary
- campaign updates
- payment options
- sharing tools
- accountability information

Optimize for mobile.

Support:

WhatsApp
Facebook
X
SMS
Email
Copy Link
QR code where appropriate

Never expose private contributor information.

---

# PHASE 6 — CAMPAIGN CREATION

Create:

/changisha/campaigns/new

Workflow:

1. Basic information
2. Story
3. Target and dates
4. Beneficiary
5. Payment configuration
6. Media
7. Preview
8. Submit/publish

Support draft saving.

Validate all financial fields server-side.

Sensitive payment configuration must require appropriate authorization.

---

# PHASE 7 — CHANGISHA DASHBOARD

Create:

/changisha

Include:

- active campaigns
- total raised
- contributors
- campaign performance
- recent contributions
- pending actions
- campaign status
- recent updates
- payment/reconciliation status

Create:

/changisha/campaigns

Create:

/changisha/campaigns/[id]

Sections:

Overview
Contributions
Supporters
Payments
Updates
Reports
Team
Settings

Reuse the existing Kitabu Yetu dashboard/UI architecture.

If Flowbite is already installed, use it consistently.

Do not introduce Bootstrap.

Do not introduce another design system unnecessarily.

---

# PHASE 8 — CONTRIBUTIONS

Contribution statuses:

initiated
pending
successful
failed
cancelled
reversed
refunded

A pending M-Pesa transaction MUST NOT be treated as successful.

Support:

- amount
- currency
- campaign
- supporter
- anonymous option
- payment method
- payment reference
- transaction reference
- status
- optional message
- reconciliation status
- timestamps

Implement idempotency.

Repeated callbacks/webhooks must never create duplicate contributions.

---

# PHASE 9 — M-PESA

FIRST inspect the existing Kitabu Yetu Daraja implementation.

Reuse existing:

- credentials
- payment services
- callbacks
- transaction model
- reconciliation
- idempotency
- audit logging
- error handling
- environment variables

Do not build a parallel M-Pesa system.

Where supported, Changisha should work with:

- STK
- PayBill
- Till
- other existing payment methods

Payment success must come from authoritative payment confirmation.

Never trust client-supplied payment status.

---

# PHASE 10 — SUPPORTERS

Allow contributions without unnecessary account creation.

Support:

- name
- phone
- email
- anonymous contribution
- optional message

Never publicly expose phone numbers or email addresses.

Do not incorrectly merge separate supporters merely because names are similar.

---

# PHASE 11 — NOTIFICATIONS

Reuse existing Kitabu Yetu notification infrastructure.

Support:

SMS
Email
In-app

Events:

- contribution initiated
- contribution successful
- contribution failed
- campaign published
- campaign milestone
- campaign update
- campaign completed
- organizer notification

Prevent duplicate notifications.

Respect existing opt-out/preferences.

Do not create email/SMS notification loops.

---

# PHASE 12 — CAMPAIGN UPDATES

Authorized campaign team members can create updates.

Support:

- title
- content
- media
- author
- publication date
- visibility

Display updates chronologically on public campaign pages.

---

# PHASE 13 — BOOKKEEPER INTEGRATION

Design a clean integration boundary:

Changisha Campaign
↓
Successful Contribution
↓
Payment Reconciliation
↓
Campaign Financial Record
↓
Group/Organization Account
↓
Bookkeeper Transaction

Follow the existing Kitabu Yetu accounting architecture.

Do NOT create another ledger or balance system.

Do NOT directly modify balances.

---

# PHASE 14 — ORGANIZATIONS

Changisha should support campaigns belonging to:

- Groups
- Organizations
- Community projects
- NGOs
- CBOs
- Clubs
- Other approved entities

Organizations should eventually support multiple campaigns.

Use the existing Organization model and RBAC.

---

# PHASE 15 — RBAC

Inspect existing roles first.

Do not create duplicate roles.

Determine appropriate permissions for:

- create campaign
- edit campaign
- submit campaign
- publish campaign
- pause campaign
- view contributions
- export reports
- manage campaign team
- configure payments
- publish updates

Enforce authorization server-side.

---

# PHASE 16 — ADMIN

Integrate Changisha into the existing admin system.

Authorized platform administrators should be able to:

- review campaigns
- approve/reject campaigns
- pause campaigns
- archive campaigns
- view campaign metrics
- review payment issues
- review suspicious activity
- manage campaign categories
- view audit logs

Respect existing platform RBAC.

---

# PHASE 17 — REPORTING

Campaign reports should include:

- target
- total raised
- achievement percentage
- contribution count
- average contribution
- payment method breakdown
- successful transactions
- failed transactions
- pending transactions
- daily fundraising
- weekly fundraising
- monthly fundraising
- supporter statistics

Reuse existing reporting/export infrastructure.

---

# PHASE 18 — SECURITY

Implement:

- Supabase RLS
- server-side authorization
- input validation
- rate limiting
- idempotency
- audit logging
- secure payment callbacks
- webhook verification
- upload validation
- file restrictions
- slug validation
- XSS-safe rendering

Never trust client-provided:

campaign ownership
organization ID
group ID
role
payment status
transaction status
raised amount

---

# PHASE 19 — MARKETING

Add Changisha to the existing Products navigation:

Products
├── Bookkeeper
├── Chama Reminder
└── Changisha

Create:

/products/changisha

Use:

CHANGISHA

Fund what matters.

"Create a campaign, mobilize your community, collect contributions and keep everyone informed from the first contribution to the final impact."

Primary CTA:

Create a Campaign

Secondary CTA:

Explore Campaigns

Do not unnecessarily rewrite the existing Kitabu Yetu homepage.

Preserve the current Kitabu Yetu positioning.

---

# PHASE 20 — API

Follow the existing API architecture.

Potential routes:

GET    /api/v1/changisha/campaigns
POST   /api/v1/changisha/campaigns
GET    /api/v1/changisha/campaigns/:id
PATCH  /api/v1/changisha/campaigns/:id
POST   /api/v1/changisha/campaigns/:id/publish
POST   /api/v1/changisha/campaigns/:id/pause
POST   /api/v1/changisha/campaigns/:id/updates
GET    /api/v1/changisha/campaigns/:id/contributions
POST   /api/v1/changisha/campaigns/:id/contribute
GET    /api/v1/changisha/campaigns/:id/reports

Use actual repository conventions if they differ.

---

# PHASE 21 — TESTING

Add tests covering:

- campaign creation
- authorization
- publishing
- lifecycle
- public visibility
- contribution creation
- payment idempotency
- payment callbacks
- failed payments
- duplicate callbacks
- campaign totals
- RBAC
- RLS
- supporter privacy
- Bookkeeper integration
- notification deduplication

Run the existing test suite.

---

# PHASE 22 — REGRESSION

Verify that Changisha does not break:

/login
/admin-login
/enterprise/login

authenticated routing
proxy/middleware
Bookkeeper
Chama Reminder
M-Pesa
SMS
email
organization access
group access
existing dashboards
existing marketing pages

Pay particular attention to existing authentication and tenant context.

---

# PHASE 23 — BUILD

Inspect package.json first.

Use the repository's actual scripts.

Run the appropriate:

npm install
npm run lint
npm run typecheck
npm run test
npm run build

Do not suppress TypeScript errors.

Do not use `any` merely to make the build pass.

Fix underlying errors.

---

# PHASE 24 — GIT

Before changes:

git status
git branch --show-current

Never discard existing user changes.

At completion:

git status
git diff --stat
git diff --check

Report:

- files created
- files modified
- migrations
- APIs
- routes
- tests
- remaining TODOs
- build result
- known limitations

DO NOT commit or push automatically.

---

# FINAL ACCEPTANCE

Changisha is complete only when:

[ ] Existing application builds
[ ] Existing authentication works
[ ] Existing tenancy works
[ ] Existing RBAC remains intact
[ ] Changisha database exists
[ ] RLS exists
[ ] Campaign creation works
[ ] Campaign editing works
[ ] Campaign publishing works
[ ] Public campaign works
[ ] Contributions work
[ ] Payment status is authoritative
[ ] Duplicate callbacks are prevented
[ ] Campaign totals are accurate
[ ] Supporter privacy is protected
[ ] Campaign updates work
[ ] Notifications are deduplicated
[ ] Reporting works
[ ] Admin moderation works
[ ] Bookkeeper integration boundary exists
[ ] Changisha appears in Products
[ ] Changisha product page exists
[ ] Mobile experience works
[ ] Existing tests pass
[ ] Build passes
[ ] No TypeScript errors are suppressed
[ ] No unrelated functionality has been rewritten

START WITH THE REPOSITORY AUDIT.

DO NOT START CODING UNTIL THE AUDIT AND ARCHITECTURE HAVE BEEN REPORTED.
