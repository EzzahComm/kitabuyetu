You are working inside the existing Kitabu Yetu codebase.

PROJECT:
Kitabu Yetu — financial operating system for Kenya's community groups.

OBJECTIVE:
Build CHANGISHA as a first-class Kitabu Yetu product.

Changisha is a fundraising and contribution-mobilization platform for groups, community projects, organizations, NGOs, clubs, initiatives and other approved campaign organizers.

IMPORTANT:
Do NOT rewrite, replace, or destabilize the existing Kitabu Yetu application.
Do NOT create a separate unrelated application.
Extend the existing architecture and reuse existing authentication, tenancy, RBAC, payments, SMS, email, reporting, UI components and database patterns wherever appropriate.

==================================================
1. FIRST: AUDIT THE EXISTING APPLICATION
==================================================

Before modifying anything:

1. Inspect the repository structure.
2. Identify:
   - Next.js version and routing architecture
   - TypeScript configuration
   - Tailwind configuration
   - existing UI/component system
   - existing marketing/Nextly components
   - authentication architecture
   - tenant/group/organization model
   - RBAC
   - Supabase schema
   - payment architecture
   - M-Pesa/Daraja integration
   - SMS functionality
   - email functionality
   - notification architecture
   - existing reporting
   - existing audit logging
   - existing API conventions
   - existing tests
   - environment variables
   - middleware/proxy/auth routing
3. Search for anything related to:
   - fundraising
   - campaigns
   - donations
   - contributions
   - projects
   - organizations
   - beneficiaries
   - payments
   - M-Pesa
4. Determine whether any Changisha-related implementation already exists.
5. Reuse existing infrastructure instead of duplicating functionality.

Create an implementation plan based on the actual repository.

DO NOT modify files until the audit is complete.

==================================================
2. PRODUCT ARCHITECTURE
==================================================

Changisha must be a product within Kitabu Yetu.

Kitabu Yetu products:

- Bookkeeper
- Chama Reminder
- Changisha

Product positioning:

BOOKKEEPER
Manage the group's money and financial records.

CHAMA REMINDER
Keep members informed and engaged.

CHANGISHA
Help groups and organizations mobilize funding.

Core Changisha proposition:

"Fund what matters."

Supporting proposition:

"Create a campaign, mobilize your community, collect contributions and keep everyone informed from the first contribution to the final impact."

Changisha should support:

Campaign creation
→ Campaign publishing
→ Campaign sharing
→ Contribution collection
→ Payment reconciliation
→ Supporter management
→ Campaign updates
→ Financial reporting
→ Impact/accountability reporting

==================================================
3. DO NOT BREAK TENANCY
==================================================

Respect the existing Kitabu Yetu multi-tenant architecture.

Changisha must distinguish between:

- Platform
- Organization
- Group
- Campaign
- Campaign organizer
- Beneficiary
- Supporter/contributor

Do not introduce a second competing tenant model.

Where appropriate, campaigns should belong to an existing Group or Organization.

A campaign may eventually support standalone organizers, but this must fit the existing authorization model.

Use existing IDs and conventions wherever possible.

Never expose internal database IDs publicly when an existing public/reference identifier convention exists.

==================================================
4. CAMPAIGN DATA MODEL
==================================================

Design the database carefully before implementing UI.

At minimum consider:

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

Campaign fields should support:

- id
- public campaign/reference ID
- organization/group ownership
- title
- slug
- short description
- full story
- target amount
- amount raised
- currency
- start date
- end date
- campaign status
- visibility
- beneficiary
- organizer
- cover image
- category
- location where applicable
- payment destination
- published_at
- created_at
- updated_at

Do NOT blindly duplicate amount_raised if the existing financial architecture can derive it safely from immutable contribution/payment records.

Prefer ledger/transaction-derived financial truth.

Use appropriate indexes, foreign keys, constraints and RLS policies.

==================================================
5. CAMPAIGN STATES
==================================================

Implement explicit campaign lifecycle states.

For example:

draft
pending_review
published
paused
completed
cancelled
archived

Do not allow arbitrary state transitions.

Define permitted transitions and enforce authorization.

Public users must only see campaigns that are publicly published and eligible for public viewing.

==================================================
6. PUBLIC CAMPAIGN EXPERIENCE
==================================================

Create a polished public campaign page.

Suggested route:

/changisha/[campaign-slug]

The page should contain:

- Changisha branding
- campaign title
- campaign image
- campaign story
- fundraising target
- amount raised
- percentage achieved
- contributor count
- campaign deadline/status
- prominent SUPPORT THIS PROJECT / CONTRIBUTE CTA
- campaign organizer
- beneficiary
- campaign updates
- contribution/supporter information where privacy permits
- sharing tools
- payment options
- trust/accountability information

Design for:

mobile first
WhatsApp sharing
Facebook sharing
X sharing
SMS sharing
email sharing
copy link
QR code where appropriate

Do not expose private contributor information.

==================================================
7. CAMPAIGN CREATION
==================================================

Create an authenticated campaign creation workflow.

Suggested route:

/changisha/campaigns/new

Steps:

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

Prevent campaign organizers from modifying financial/payment configuration without authorization.

==================================================
8. CHANGISHA DASHBOARD
==================================================

Create:

/changisha

Dashboard should provide:

- active campaigns
- total raised
- total contributors
- campaign performance
- recent contributions
- pending actions
- campaign status
- campaign completion
- recent updates
- payment/reconciliation status

Campaign management:

/changisha/campaigns

Campaign detail:

/changisha/campaigns/[id]

Include tabs/sections such as:

Overview
Contributions
Supporters
Payments
Updates
Reports
Team
Settings

Use the existing Kitabu Yetu UI system.

Do not introduce an unnecessary second design language.

==================================================
9. CONTRIBUTIONS
==================================================

Build a robust contribution model.

A contribution should support:

- campaign
- amount
- currency
- supporter
- anonymous contribution option
- payment method
- payment reference
- transaction reference
- status
- timestamp
- optional message
- reconciliation status

Statuses should distinguish between:

initiated
pending
successful
failed
cancelled
reversed
refunded

Do not treat an initiated/pending M-Pesa transaction as a successful contribution.

Use idempotency protection.

Never create duplicate contributions from repeated callbacks/webhooks.

==================================================
10. M-PESA INTEGRATION
==================================================

Inspect the existing Kitabu Yetu Daraja implementation before adding anything.

Reuse the existing payment infrastructure where possible.

Changisha should support appropriate configured payment methods such as:

- M-Pesa STK
- PayBill
- Till
- other existing supported methods

Do NOT invent new Safaricom integration patterns if the application already has working payment services.

Respect existing:

- callback handling
- transaction status
- reconciliation
- idempotency
- audit logging
- error handling
- credentials
- environment variables

A campaign contribution must not be marked successful until the payment system confirms success.

==================================================
11. SUPPORTER EXPERIENCE
==================================================

Allow supporters to contribute without unnecessary account creation.

Support:

- name
- phone
- email where supplied
- anonymous contribution
- optional message

Do not expose phone numbers or email addresses publicly.

Create appropriate supporter deduplication rules without incorrectly merging different people.

==================================================
12. NOTIFICATIONS
==================================================

Reuse the existing Kitabu Yetu notification architecture.

Support:

SMS
Email
In-app notifications

Events should include:

- contribution initiated
- contribution successful
- contribution failed
- campaign published
- campaign milestone
- campaign update
- campaign completed
- organizer notification

Avoid notification loops and duplicate sending.

Respect existing email/SMS opt-out and notification preferences.

Do not create uncontrolled email/SMS loops.

==================================================
13. CAMPAIGN UPDATES
==================================================

Allow authorized campaign teams to publish updates.

An update should support:

- title
- content
- media
- publish date
- author
- visibility

Public campaign pages should display campaign updates chronologically.

==================================================
14. ACCOUNTABILITY / IMPACT
==================================================

Changisha should eventually connect:

Fundraising
→ Contributions
→ Payments
→ Reconciliation
→ Use of funds
→ Financial records
→ Impact reporting

For Kitabu Yetu groups, design the architecture so Changisha can integrate with Bookkeeper.

Do not fake accounting entries.

If money is transferred into a group's financial records, create the appropriate accounting/ledger transaction through the existing Bookkeeper architecture.

Do not directly manipulate balances.

==================================================
15. BOOKKEEPER INTEGRATION
==================================================

Design a clean integration boundary.

Example:

Changisha campaign
      ↓
Successful contribution
      ↓
Payment reconciliation
      ↓
Campaign financial record
      ↓
Group/Organization account
      ↓
Bookkeeper transaction

The exact implementation must follow the existing Kitabu Yetu accounting model discovered during the audit.

Never create a second balance engine.

==================================================
16. ORGANIZATIONS / NGOS
==================================================

Changisha should be usable by:

- VSLAs
- chamas
- welfare groups
- community projects
- clubs
- NGOs
- CBOs
- organizations
- approved initiatives

Organizations should eventually be able to manage multiple campaigns.

Use the existing Organization model.

Organization users must only access campaigns permitted by their RBAC role.

==================================================
17. RBAC
==================================================

Respect existing roles.

Do not create arbitrary duplicate roles.

Determine from the existing code which roles should be allowed to:

Create campaigns
Edit campaigns
Submit campaigns
Publish campaigns
Pause campaigns
View contributions
Export reports
Manage campaign team
Configure payments
Publish updates

Sensitive actions must be authorized server-side.

Never rely exclusively on UI restrictions.

==================================================
18. ADMIN / MODERATION
==================================================

Add Changisha administration to the existing admin system.

Platform administrators should be able to:

- review campaigns
- approve/reject campaigns
- pause campaigns
- archive campaigns
- view campaign metrics
- review payment issues
- review suspicious activity
- manage campaign categories
- view audit logs

Do not bypass existing platform RBAC.

==================================================
19. REPORTING
==================================================

Create campaign reports:

- total raised
- target
- achievement percentage
- contribution count
- average contribution
- payment method breakdown
- successful/failed/pending transactions
- daily/weekly/monthly fundraising
- campaign performance
- supporter statistics

Provide CSV export if the existing reporting architecture supports it.

Respect authorization and privacy.

==================================================
20. SECURITY
==================================================

Apply:

- Supabase RLS
- server-side authorization
- input validation
- rate limiting
- idempotency
- audit logging
- secure payment callbacks
- webhook verification
- CSRF protection where applicable
- abuse prevention
- upload validation
- file size/type restrictions
- slug validation
- XSS-safe content rendering

Never trust client-provided:

campaign ownership
payment status
raised amount
transaction status
organization ID
group ID
role

==================================================
21. UI / DESIGN
==================================================

Use the existing Kitabu Yetu Tailwind design system.

If Flowbite is already installed, use it consistently.

If Flowbite is not installed, first determine whether the existing component system already provides the required functionality before adding another UI dependency.

Do not introduce Bootstrap.

Maintain the existing Nextly marketing experience for the public Kitabu Yetu website.

Changisha should have its own recognizable product identity while clearly remaining part of Kitabu Yetu.

Visual direction:

clean
modern
trustworthy
community-focused
financially credible
mobile-first

Primary CTA:

"Create a Campaign"

Public CTA:

"Support This Campaign"

==================================================
22. KITABU YETU MARKETING
==================================================

Update the existing Products navigation to include:

Bookkeeper
Chama Reminder
Changisha

Add a Changisha product page.

Suggested route:

/products/changisha

Suggested copy:

CHANGISHA

Fund what matters.

Create a campaign, mobilize your community, collect contributions and keep everyone informed from the first contribution to the final impact.

CTA:

Create a Campaign

Secondary:

Explore Campaigns

Do not unnecessarily rewrite unrelated homepage sections.

Preserve the current Kitabu Yetu positioning.

==================================================
23. PRODUCT NAVIGATION
==================================================

Where the existing application uses:

Products
 ├── Bookkeeper
 ├── Chama Reminder
 └── Changisha

implement Changisha consistently.

Authenticated users should see Changisha according to their entitlements and permissions.

Unauthenticated visitors should be able to access public campaign pages.

==================================================
24. API
==================================================

Follow the existing Kitabu Yetu API conventions.

Potential endpoints:

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

Use the repository's actual API naming conventions if different.

==================================================
25. DATABASE MIGRATIONS
==================================================

Create proper Supabase migrations.

Before migration:

- inspect existing tables
- inspect relationships
- inspect RLS
- inspect existing financial tables
- inspect existing organization/group relationships

Do not overwrite existing migrations.

Do not modify production data destructively.

Use additive migrations wherever possible.

==================================================
26. TESTING
==================================================

Add tests for:

campaign creation
campaign authorization
campaign publishing
campaign lifecycle
public campaign visibility
contribution creation
payment idempotency
payment callback handling
failed payments
duplicate callbacks
campaign totals
RBAC
RLS
supporter privacy
Bookkeeper integration
notification deduplication

Run existing tests as well.

==================================================
27. BUILD VALIDATION
==================================================

Before declaring success run:

npm install
npm run lint
npm run typecheck
npm run test
npm run build

If scripts differ, inspect package.json and use the correct project commands.

Do not suppress TypeScript errors.

Do not use `any` simply to make the build pass.

Fix the underlying type problem.

==================================================
28. REGRESSION PROTECTION
==================================================

Specifically verify that Changisha does not break:

- /login
- /admin-login
- /enterprise/login
- authenticated routing
- proxy/middleware
- Bookkeeper
- Chama Reminder
- M-Pesa
- SMS
- email
- organization access
- group access
- existing dashboards
- existing marketing pages

==================================================
29. ENVIRONMENT VARIABLES
==================================================

Before adding environment variables:

inspect existing .env.example and configuration.

Only introduce variables that are genuinely required.

Never hard-code:

API credentials
M-Pesa credentials
Supabase service keys
JWT secrets
email credentials
SMS credentials

Document all new variables.

==================================================
30. IMPLEMENTATION DISCIPLINE
==================================================

Work in phases.

PHASE 1
Audit existing architecture.

PHASE 2
Design database and authorization model.

PHASE 3
Implement database migrations/RLS.

PHASE 4
Implement server/services/API.

PHASE 5
Implement dashboard.

PHASE 6
Implement public campaign pages.

PHASE 7
Implement payment/contribution workflow.

PHASE 8
Implement notifications.

PHASE 9
Implement Bookkeeper integration boundary.

PHASE 10
Implement admin/moderation.

PHASE 11
Update marketing/product navigation.

PHASE 12
Testing and production build.

After each major phase:

- run relevant tests
- inspect git diff
- verify no unrelated files were modified
- fix errors before continuing

==================================================
31. GIT DISCIPLINE
==================================================

Before implementation:

git status
git branch --show-current

Do not discard existing user changes.

At completion:

git status
git diff --stat
git diff --check

Then provide:

- files created
- files modified
- migrations created
- APIs created
- routes created
- tests created
- remaining TODOs
- build result
- known limitations

DO NOT automatically commit or push unless explicitly instructed.

==================================================
32. FINAL ACCEPTANCE CRITERIA
==================================================

Changisha is considered implemented only when:

[ ] Existing application still builds
[ ] Existing authentication still works
[ ] Existing tenant/RBAC model remains intact
[ ] Changisha has a database model
[ ] RLS is implemented
[ ] Campaign creation works
[ ] Campaign editing works
[ ] Campaign publishing works
[ ] Public campaign page works
[ ] Contributions are recorded correctly
[ ] Payment status is authoritative
[ ] Duplicate callbacks cannot duplicate contributions
[ ] Campaign totals are financially accurate
[ ] Supporter privacy is protected
[ ] Campaign updates work
[ ] Notifications are controlled and deduplicated
[ ] Reporting works
[ ] Admin moderation works
[ ] Bookkeeper integration architecture is established
[ ] Product navigation includes Changisha
[ ] Changisha marketing page exists
[ ] Mobile experience is usable
[ ] npm run build succeeds
[ ] Existing tests pass
[ ] No TypeScript errors have been suppressed
[ ] No unrelated functionality has been rewritten

==================================================
START NOW
==================================================

Begin with a repository audit.

DO NOT immediately start coding.

First report:

1. Existing architecture
2. Existing fundraising/payment functionality
3. Existing database structures that Changisha can reuse
4. Existing UI components that should be reused
5. Existing auth/RBAC capabilities
6. Potential conflicts
7. Recommended Changisha architecture
8. Files you expect to create/change
9. Implementation phases

Then proceed with implementation after establishing the architecture from the actual codebase.
