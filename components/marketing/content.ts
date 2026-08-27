import {
  ArrowLeftRight, BarChart3, BookOpen, BookMarked, Briefcase, Building2,
  ClipboardList, Coins, EyeOff, Gift, GitBranch, Heart, KeyRound,
  Landmark, Layers, Lock, Megaphone, MessageSquareText, Network,
  PiggyBank, ScrollText, Send, ShieldCheck, Smartphone, Sprout,
  Store, Table2, UserRound, Users, Wallet, Zap, type LucideIcon,
} from 'lucide-react';
import { ROUTES } from './routes';

/* ────────────────────────────────────────────────────────────────────────────
 * Every word on the public site that is not a price.
 *
 * ONE RULE GOVERNS THIS FILE: EVERY CLAIM IS BACKED BY CODE. Each block below
 * carries the service, route or constant that makes it true. If the
 * implementation changes, the copy here is wrong, and this is the one place to
 * fix it.
 *
 * No prices, plan names or SMS allowances are typed here at all — those are
 * read live from `types/enums.ts`, which is what the M-Pesa callback itself
 * prices against. A hand-maintained copy of the price list is precisely what
 * once had the public pages advertising numbers the server did not charge.
 *
 * Routes live in ./routes.ts, which is icon-free so the client-side header can
 * import the nav without dragging twenty lucide glyphs into the bundle.
 * ──────────────────────────────────────────────────────────────────────────── */

/* ── Section 3 — the problem ──────────────────────────────────────────────── */

export interface PainPoint { icon: LucideIcon; title: string; body: string }

export const PAIN_POINTS: PainPoint[] = [
  {
    icon: BookMarked,
    title: 'The paper book',
    body: 'One cash book, one bag, one person’s handwriting. Lose the book — or just a page — and the group loses its own history.',
  },
  {
    icon: Table2,
    title: 'The spreadsheet',
    body: 'Fine until the group grows. Then three officers need the same file at once, and nobody is certain which copy is the real one.',
  },
  {
    icon: ArrowLeftRight,
    title: 'Reconciliation night',
    body: 'The treasurer sits with an M-Pesa statement and a list of names the evening before every meeting, matching payments line by line.',
  },
  {
    icon: EyeOff,
    title: 'Nobody can see the balance',
    body: 'Members learn where their savings stand once a month, if the meeting happens, from someone reading figures out loud.',
  },
];

/* ── Section 4 — what Kitabu Yetu does ────────────────────────────────────── */

export interface Capability { icon: LucideIcon; title: string; body: string }

/** Each entry names the module that implements it:
 *  contributions + contribution-splits · loans + approval-policy · members +
 *  import · mpesa-stk/c2b/b2c over daraja · reports + accounting ·
 *  member-passbook (the app/(member)/me portal). */
export const CAPABILITIES: Capability[] = [
  {
    icon: PiggyBank,
    title: 'Savings and contributions',
    body: 'Contributions recorded as they arrive and split across savings, welfare and loan repayment by rules your group sets once.',
  },
  {
    icon: Landmark,
    title: 'Loans',
    body: 'Applications, approvals, disbursement, repayment schedules and running balances — with a second approver required above your threshold.',
  },
  {
    icon: Users,
    title: 'Members',
    body: 'One register of who is in, what role they hold, what they have paid and what they owe. Bring your existing list in from a spreadsheet.',
  },
  {
    icon: Smartphone,
    title: 'M-Pesa',
    body: 'Collect by STK push or PayBill and pay out by B2C, on Safaricom’s official Daraja API — not a workaround.',
  },
  {
    icon: Sprout,
    title: 'Income-generating activities and investments',
    body: 'Record what the group puts into a business, a piece of land, rental property or a fixed deposit — then track the income it brings in, the costs of running it, and whether it is actually ahead once both are counted.',
  },
  {
    icon: BarChart3,
    title: 'Reports',
    body: 'Trial balance, member statements, contribution and loan reports — generated from the ledger rather than retyped into one.',
  },
  {
    icon: BookOpen,
    title: 'Member passbook',
    body: 'Every member signs in to see their own contributions, loan balance and savings goals, without waiting for the next meeting.',
  },
];

/**
 * The four-up value proposition directly under the hero — the whole product
 * compressed into the four things a group actually recognises.
 *
 * Deliberately NOT the same list as CAPABILITIES above: that one enumerates
 * every module and belongs further down, where a reader has already decided
 * they are interested. This is the answer to "what is it", and four is the
 * most a visitor absorbs before scrolling. "Money" folds savings, loans,
 * welfare, shares and investments into one idea on purpose.
 */
export const VALUE_PILLARS: Capability[] = [
  {
    icon: Users,
    title: 'Members',
    body: 'Keep one up-to-date register of your members, their roles and their financial activity.',
  },
  {
    icon: PiggyBank,
    title: 'Money',
    body: 'Track savings, contributions, loans, welfare, shares, dividends, income-generating activities and investments in one place.',
  },
  {
    icon: Smartphone,
    title: 'Payments',
    body: 'Connect M-Pesa collections and repayments directly to your group’s records.',
  },
  {
    icon: BarChart3,
    title: 'Reports',
    body: 'Get statements and reports without rebuilding the numbers every month.',
  },
];

/* ── Section 6 — product showcase ─────────────────────────────────────────── */

export type ShowcaseVisual = 'ledger' | 'payment' | 'reports' | 'messages' | 'shares';

export interface ShowcaseItem {
  eyebrow:  string;
  title:    string;
  emphasis: string;
  body:     string;
  points:   string[];
  visual:   ShowcaseVisual;
  /** Optional deep link to a real page that explains this further. */
  href?:    string;
  linkText?: string;
}

export const SHOWCASE: ShowcaseItem[] = [
  {
    eyebrow:  'Keep the books',
    title:    'A real ledger under a screen your treasurer',
    emphasis: 'can actually use',
    body:     'Kitabu Yetu is double-entry accounting underneath — the same discipline an auditor expects — with none of the accounting vocabulary on the surface.',
    points: [
      'Members, savings, contributions, loans, welfare, shares and dividends',
      'Income-generating activities and investments — income, running costs and net performance',
      'Journals posted automatically as money moves',
      'Fiscal periods you can close so the past stops changing',
    ],
    visual:   'ledger',
    href:     ROUTES.bookkeeper,
    linkText: 'More on Bookkeeper',
  },
  {
    eyebrow:  'Move the money',
    title:    'Collection and payout on',
    emphasis: 'Safaricom’s own API',
    body:     'Money in and money out both run through Daraja, so the payment and the record of the payment are the same event rather than two things you hope agree.',
    points: [
      'STK push prompts sent straight to a member’s phone',
      'PayBill payments matched by the member’s membership number',
      'B2C payouts for loans, welfare and dividends',
      'The M-Pesa transaction fee captured on every transaction',
    ],
    visual: 'payment',
  },
  {
    eyebrow:  'Know your numbers',
    title:    'The answer to “where do we stand?”',
    emphasis: 'in one screen',
    body:     'Balances, contributions, outstanding loans and welfare all read from the same ledger, so the report and the meeting agree.',
    points: [
      'Member statements and full transaction history',
      'Contribution, loan and welfare reports',
      'Credit scores built from a member’s own repayment record',
      'A portfolio view across many groups for organizations',
    ],
    visual: 'reports',
  },
  {
    eyebrow:  'Keep everyone in the loop',
    title:    'Members hear from the group,',
    emphasis: 'not from rumour',
    body:     'Contribution confirmations, reminders and announcements go out from the same system that holds the money, so the message and the balance never disagree.',
    points: [
      'SMS confirmations, reminders and announcements',
      'WhatsApp and email for groups that prefer them',
      'PDF receipts and member statements',
      'Meeting notices and birthday greetings',
    ],
    visual:   'messages',
    href:     ROUTES.chamaReminder,
    linkText: 'More on Chama Reminder',
  },
  {
    eyebrow:  'Grow the group’s money',
    title:    'Shares, dividends and the activities',
    emphasis: 'that earn for the group',
    body:     'A group is more than its savings pot. Track share capital and dividends, and record the businesses, land, rentals and projects the group puts money into — what they earn, what they cost to run, and whether they are actually ahead.',
    points: [
      'A share ledger with holdings, transactions and PDF certificates',
      'Dividends allocated across real holdings, not estimated',
      'Income-generating activities and investments: farming, poultry, rentals, water projects, shops',
      'Returns and running costs recorded against each one',
    ],
    visual:   'shares',
    href:     ROUTES.bookkeeper,
    linkText: 'More on Bookkeeper',
  },
];

/* ── Section 7 — how it works ─────────────────────────────────────────────── */

export interface Step { title: string; body: string }

/**
 * The six-step journey — Create, Organize, Set your rules, Start recording,
 * Digital ledger, Grow. Steps 4 and 5 each have a real, shipped feature behind
 * every sentence (contribution-splits; Daraja + the posting templates). Grow
 * reaches toward the ecosystem (organizations, donors, programs) — several of
 * those destinations are the vision this platform is building toward rather
 * than a shipped feature today; see each /ecosystem/* page for what is live
 * versus what is coming.
 */
export const STEPS: Step[] = [
  {
    title: 'Create',
    body:  'Register your group in a few minutes. It gets its own chart of accounts and its own M-Pesa account reference, set up for you.',
  },
  {
    title: 'Organize',
    body:  'Add members one at a time or import the register you already keep. Set roles — chairperson, treasurer, secretary — and the rules your group runs by.',
  },
  {
    title: 'Set your rules',
    body:  'Configure contributions, loans, welfare and the rest — contribution splits, loan schedules, dividend allocations and reminders then run themselves instead of being redone by hand every cycle.',
  },
  {
    title: 'Start recording',
    body:  'Record contributions, payments, loans, welfare and everything else the group does — by hand where you need to, automatically where M-Pesa can do it for you.',
  },
  {
    title: 'Digital ledger',
    body:  'Collect contributions and repayments digitally, and watch them post themselves to a ledger that always balances.',
  },
  {
    title: 'Grow',
    body:  'Connect to the wider Kitabu Yetu ecosystem — organizations overseeing many groups, donors backing real projects, and programs built for qualifying groups.',
  },
];

/* ── Section 8 — roles ────────────────────────────────────────────────────── */

export interface RoleCard {
  icon:  LucideIcon;
  title: string;
  body:  string;
  /** Where this role actually works, when it is a public entry point. */
  href?: string;
  linkText?: string;
}

/**
 * These are the REAL roles — `MemberRole` in types/enums.ts is exactly
 * chairperson / treasurer / secretary / member, and organizations come in
 * through `PlatformRole.organization_coordinator` and the (enterprise) portal.
 * There is deliberately no separate "group administrator" card: the
 * chairperson IS the group's administrator (`ROLE_HIERARCHY` puts them top of
 * the group at 80), and inventing a sixth role for symmetry would be a
 * marketing claim the permission model does not honour.
 */
export const ROLES: RoleCard[] = [
  {
    icon:  UserRound,
    title: 'Members',
    body:  'See your own contributions, loan balance and savings goals, and pay from your phone.',
    href:  ROUTES.memberApp,
    linkText: 'Member portal',
  },
  {
    icon:  Wallet,
    title: 'Treasurers',
    body:  'Record and reconcile money in and out — and answer “has she paid?” without opening a statement.',
  },
  {
    icon:  ClipboardList,
    title: 'Secretaries',
    body:  'Keep the register, the meetings and the records that go with them in the same place as the money.',
  },
  {
    icon:  ShieldCheck,
    title: 'Chairpersons',
    body:  'The group’s administrator. Approve loans and payouts, set the rules, and watch the group’s financial health.',
  },
  {
    icon:  Building2,
    title: 'Organizations and networks',
    body:  'NGOs, funders and umbrella bodies get their own portal, with a portfolio view across every group they support and the programs they fund.',
    href:  ROUTES.orgPortal,
    linkText: 'Enterprise portal',
  },
];

/* ── Section 9 — payments ─────────────────────────────────────────────────── */

export interface FlowStep { label: string; body: string }

/**
 * Traces the real path: mpesa-stk / mpesa-c2b → daraja callback →
 * mpesa-allocation → contribution-splits → accounting.postContributionJournal
 * → sms + receipt.
 *
 * Three steps, not the six this used to list. The six were each accurate, but
 * they described the SYSTEM's work rather than the group's experience — a
 * treasurer does not do six things, they do one, and the other five happen to
 * them. Every fact from the longer version survives inside these bodies
 * (Daraja verification, matching by membership number, the split rules, both
 * sides of the journal, the fee, the receipt); none of it was dropped to make
 * the section shorter.
 */
export const PAYMENT_FLOW: FlowStep[] = [
  {
    label: 'Member pays',
    body:  'An STK prompt straight to their phone, or your PayBill quoting their membership number. Anyone can pay for a member — a spouse, a child, a well-wisher — and it still lands in the right place.',
  },
  {
    label: 'Payment is matched',
    body:  'Safaricom’s Daraja callback is verified before anything is written down, then matched to the member by their membership number or the STK request that started it.',
  },
  {
    label: 'The records update',
    body:  'Split into savings, welfare and loan repayment by the rules your group set once, posted to the ledger with Safaricom’s fee, and confirmed to the member — balances and reports current the same moment.',
  },
];

/* ── Section 10 — trust ───────────────────────────────────────────────────── */

export interface Control { icon: LucideIcon; title: string; body: string }

/** Every control below is shipped and live — role checks, staff TOTP,
 *  maker-checker approvals (approval-policy.service), the audit log, Postgres
 *  row-level tenant isolation, and the official Daraja integration. Nothing
 *  aspirational, and no unfalsifiable "bank-grade security" line. */
export const CONTROLS: Control[] = [
  {
    icon: KeyRound,
    title: 'Role-based access',
    body:  'Chairperson, treasurer, secretary and member each see and do only what their role allows.',
  },
  {
    icon: GitBranch,
    title: 'Two people, not one',
    body:  'Payouts, loan write-offs and manual journal entries need a second, different approver above your threshold.',
  },
  {
    icon: ScrollText,
    title: 'A full audit trail',
    body:  'Who changed what, and when — logged and reviewable, not just the money movements.',
  },
  {
    icon: Building2,
    title: 'Isolated per group',
    body:  'Your members, contributions and books are enforced private to your group by the database itself, not only by the app.',
  },
  {
    icon: Lock,
    title: 'Two-factor for staff',
    body:  'Backoffice and organization staff sign in with a one-time code, never a password alone.',
  },
  {
    icon: Coins,
    title: 'Official M-Pesa integration',
    body:  'Payments run on Safaricom’s Daraja API — not a screen-scraped or unofficial workaround.',
  },
];

/* ── Section 11 — resources ───────────────────────────────────────────────── */

export interface ResourceCard {
  kind:  string;
  title: string;
  body:  string;
  href:  string;
}

/**
 * Real destinations only. There is no blog and no CMS in this repository, so
 * this section is an honest index of the pages that exist rather than five
 * invented article cards linking nowhere — which is the single most common way
 * a marketing redesign ships dead links.
 */
export const RESOURCES: ResourceCard[] = [
  {
    kind:  'Product',
    title: 'Kitabu Yetu Bookkeeper',
    body:  'What the full book covers: contributions, loans, welfare, shares and an audit-ready ledger.',
    href:  ROUTES.bookkeeper,
  },
  {
    kind:  'Product',
    title: 'Chama Reminder',
    body:  'Just the messaging — reminders, announcements and birthday greetings, with no ledger to set up.',
    href:  ROUTES.chamaReminder,
  },
  {
    kind:  'Overview',
    title: 'The ecosystem',
    body:  'The tools a group can use, and the organizations and partners that work alongside them.',
    href:  ROUTES.ecosystem,
  },
  {
    kind:  'Live',
    title: 'System status',
    body:  'What is running right now, including payments and messaging.',
    href:  ROUTES.status,
  },
  {
    kind:  'Help',
    title: 'Support',
    body:  'Written guides are still being built. Until they land, ask us directly and we answer.',
    href:  ROUTES.support,
  },
  {
    kind:  'Reference',
    title: 'Documentation',
    body:  'API and integration reference for developers building against Kitabu Yetu.',
    href:  ROUTES.docs,
  },
  {
    kind:  'Talk to us',
    title: 'Contact',
    body:  'A demo, a question about your group, or a partnership — reach a person in Nairobi.',
    href:  ROUTES.contact,
  },
];

/* ── Section 12 — product pillars (Products overview + homepage) ─────────── */

export interface ProductPillar {
  icon:    LucideIcon;
  title:   string;
  body:    string;
  points:  string[];
  href:    string;
  linkText: string;
  /** `live` has a real, shipped feature behind every point below. `vision`
   *  describes where the product is going — labelled as such on every page
   *  that renders it, never presented as available today. */
  status:  'live' | 'vision';
}

export const PRODUCT_PILLARS: ProductPillar[] = [
  {
    icon: BookOpen,
    title: 'Bookkeeper',
    body: 'The core platform: digital group administration and financial management, built on a real double-entry ledger.',
    points: ['Contributions, loans, welfare and shares', 'M-Pesa collection and payout on Daraja', 'Statements, reports and an audit trail'],
    href: ROUTES.bookkeeper,
    linkText: 'Explore Bookkeeper',
    status: 'live',
  },
  {
    icon: MessageSquareText,
    title: 'Chama Reminder',
    body: 'Communication and engagement for groups that want the messaging without setting up the full ledger.',
    points: ['Contribution and meeting reminders', 'Group announcements by SMS', 'Runs standalone, or alongside Bookkeeper'],
    href: ROUTES.chamaReminder,
    linkText: 'Explore Chama Reminder',
    status: 'live',
  },
  {
    icon: Gift,
    title: 'Fundraise / Changi$ha',
    body: 'A fundraising platform for organizations, groups, projects and individuals to raise money from members and the public.',
    points: ['Shareable campaign pages with a running total', 'M-Pesa collection, reconciled automatically', 'A transparent record every contributor can see'],
    href: ROUTES.fundraise,
    linkText: 'See what’s coming',
    status: 'vision',
  },
  {
    icon: Briefcase,
    title: 'Enterprise',
    body: 'For institutions managing multiple groups or programs — centralized oversight without losing any group’s own book.',
    points: ['Multi-group and multi-organization dashboards', 'Programs, funding and disbursements to the groups you back', 'Organization-level reports, audit log and API keys'],
    href: ROUTES.enterprise,
    linkText: 'Explore Enterprise',
    // Corrected from 'vision' 2026-08-26. This was stale, and it was
    // understating the product: the (enterprise) portal ships ten real
    // screens — dashboard, members, branches, funding, disbursements,
    // reports, billing, branding, audit and api-keys — behind 35 live
    // /api/admin/organization* routes, with organization plans in
    // migration 152. Every point above names one of those screens.
    // Per-group member-level stake is still NOT built; nothing here claims it.
    status: 'live',
  },
];

/* ── Section 13 — why Kitabu Yetu ─────────────────────────────────────────── */

export interface ValueProp { icon: LucideIcon; title: string; body: string }

/**
 * The eight-point case for the platform. Digital Administration, Financial
 * Transparency, Cashless Collections and Better Reporting each name a
 * shipped mechanism (the ledger, the passbook, Daraja, the reports module).
 * Automated Communication, Seamless Disbursements, Greater Accountability
 * and Connected Communities lean forward toward the ecosystem this platform
 * is building into.
 */
export const WHY_KITABU_YETU: ValueProp[] = [
  { icon: Layers,   title: 'Digital Administration', body: 'One shared, audit-ready book replaces the paper ledger and the treasurer’s personal M-Pesa statement.' },
  { icon: ShieldCheck, title: 'Financial Transparency', body: 'Every member sees their own contributions and loan balance, from a ledger everyone reads the same way.' },
  { icon: Zap,      title: 'Automated Communication', body: 'Reminders, confirmations and announcements go out on their own, from the system that holds the money.' },
  { icon: Smartphone, title: 'Cashless Collections', body: 'Contributions and repayments move by M-Pesa — STK push or your own PayBill — on Safaricom’s own API.' },
  { icon: Send,     title: 'Seamless Disbursements', body: 'Loans, welfare and dividend payouts move the same way collections do, with the same controls.' },
  { icon: BarChart3, title: 'Better Reporting', body: 'Statements and reports are generated from the ledger itself, never retyped into a second document.' },
  { icon: GitBranch, title: 'Greater Accountability', body: 'Role-based access and a second approver above your threshold, on every payout and write-off.' },
  { icon: Network,  title: 'Connected Communities', body: 'A group’s book connects outward — to the organizations, donors and programs in the wider ecosystem.' },
];

/* ── Section 14 — the ecosystem (homepage section + /ecosystem hub) ──────── */

export interface EcosystemPillar {
  icon:   LucideIcon;
  title:  string;
  body:   string;
  href:   string;
  status: 'live' | 'vision';
}

/**
 * Multigroup Organizations is real — multi-group registration and the
 * (enterprise) portal both shipped. Donors, Marketplace and Programs are the
 * vision for where those same rails lead; each is labelled `vision` and its
 * own page says so plainly rather than describing a feature that does not
 * exist yet as if it does.
 */
export const ECOSYSTEM_PILLARS: EcosystemPillar[] = [
  {
    icon: Building2,
    title: 'Multigroup Organizations',
    body: 'NGOs, federations and umbrella bodies get one login and a portfolio view across every group and branch they run.',
    href: ROUTES.ecosystemOrganizations,
    status: 'live',
  },
  {
    icon: Heart,
    title: 'Donors',
    body: 'Development partners and funders discover, support and monitor the groups and projects they back.',
    href: ROUTES.ecosystemDonors,
    status: 'vision',
  },
  {
    icon: Store,
    title: 'Marketplace',
    body: 'Groups and organizations connect with relevant products, services, suppliers and financial partners.',
    href: ROUTES.ecosystemMarketplace,
    status: 'vision',
  },
  {
    icon: Megaphone,
    title: 'Programs',
    body: 'Enterprises, NGOs and donors announce and manage grants, opportunities and interventions for qualifying groups.',
    href: ROUTES.ecosystemPrograms,
    status: 'vision',
  },
];

/* ── Section 16 — Enterprise (homepage section + /enterprise-solutions) ───── */

export interface EnterpriseFeature { icon: LucideIcon; title: string; body: string }

/**
 * Every card names a screen that exists in `app/(enterprise)/enterprise/`,
 * backed by one of the 35 live `/api/admin/organization*` routes. Verified
 * 2026-08-26 before this section was written, because the product pillar had
 * been sitting on `status: 'vision'` while the portal was already shipping —
 * the copy was behind the code, not ahead of it.
 *
 * DELIBERATELY ABSENT — do not add these back without checking the code:
 *  • API keys / webhooks. The `api-keys` screen is a MOCK: it imports seed
 *    rows from `_data` and its own comment says "no API key issuance /
 *    webhook delivery backend exists yet". This card claimed them on
 *    2026-08-27 and was live and false for about an hour. Screen size is not
 *    evidence a feature exists — that page is 214 lines of working UI over
 *    nothing.
 *  • Any claim that an organization sees inside a group's member-level
 *    records. It does not, and the tenant isolation in migration 097 stops it.
 */
export const ENTERPRISE_FEATURES: EnterpriseFeature[] = [
  {
    icon: Building2,
    title: 'Every group in one account',
    body: 'Bring the groups you support under a single organization login, each keeping its own officers, its own ledger and its own members.',
  },
  {
    icon: BarChart3,
    title: 'Organization dashboard',
    body: 'Group activity and contribution volume across the portfolio, read from the same ledgers the groups themselves use.',
  },
  {
    icon: Megaphone,
    title: 'Programs',
    body: 'Set up programs with their own budget and criteria, and track which of your groups are enrolled in each.',
  },
  {
    icon: Send,
    title: 'Funding and disbursements',
    body: 'Move money out to the groups you back — with a budget, a tranche it draws from, and a second approver before it leaves.',
  },
  {
    icon: ScrollText,
    title: 'Audit log and access control',
    body: 'Organization staff sign in with a one-time code, hold defined roles, and every action they take is recorded.',
  },
  {
    icon: Layers,
    title: 'Reports and your own branding',
    body: 'Budget variance across your programs, spend broken down by donor, and your organization’s own logo and colours on what it sends out.',
  },
];

/* ── Section 17 — the two customer paths ──────────────────────────────────── */

export interface CustomerPath {
  icon:     LucideIcon;
  eyebrow:  string;
  title:    string;
  body:     string;
  audience: string[];
  href:     string;
  linkText: string;
}

/** The self-selection fork. Both destinations are real pages; the group path
 *  goes to registration because a group can genuinely self-serve, and the
 *  organization path goes to the public Enterprise pitch rather than
 *  ROUTES.orgPortal, which is the authenticated portal behind a sign-in. */
export const CUSTOMER_PATHS: CustomerPath[] = [
  {
    icon:     Users,
    eyebrow:  'I run a group',
    title:    'One place for your members, your money and your records.',
    body:     'Manage members, savings, contributions, loans, welfare, shares and investments — and collect by M-Pesa without reconciling it by hand.',
    audience: ['Chamas', 'Welfare groups', 'Investment clubs', 'SACCOs', 'VSLAs', 'Community groups'],
    href:     ROUTES.startGroup,
    linkText: 'Start your group',
  },
  {
    icon:     Network,
    eyebrow:  'I manage many groups',
    title:    'One connected view across every group you support.',
    body:     'Bring your groups under one organization account, run programs and funding, and report across the portfolio — without flattening any group’s own book.',
    audience: ['NGOs', 'CBOs', 'Federations', 'SACCO networks', 'Development programs', 'Institutions'],
    href:     ROUTES.enterprise,
    linkText: 'Explore Enterprise',
  },
];

/* ── Section 18 — what a member actually gets ─────────────────────────────── */

export interface MemberBenefit { icon: LucideIcon; title: string; body: string }

/** All six are screens in the `app/(member)/me` portal — passbook,
 *  contributions, loan balances, transaction history, statements and goals.
 *  Nothing here describes a member-facing feature that isn't in that portal. */
export const MEMBER_BENEFITS: MemberBenefit[] = [
  { icon: PiggyBank, title: 'What they have saved',   body: 'Running contribution and savings totals, updated the moment a payment is confirmed.' },
  { icon: Landmark,  title: 'What they still owe',    body: 'Loan balance, the repayment schedule, and what falls due next.' },
  { icon: BookOpen,  title: 'Their own passbook',     body: 'The full history of their transactions, in one place they can scroll back through.' },
  { icon: ScrollText, title: 'Statements they can keep', body: 'A member statement they can pull themselves, rather than requesting it at a meeting.' },
  { icon: Coins,     title: 'Savings goals',          body: 'A target they set, and how close their own contributions have brought them to it.' },
  { icon: Smartphone, title: 'Paying from their phone', body: 'An STK prompt to contribute or repay, without leaving the app or asking for the PayBill.' },
];

/* ── Section 15 — impact ──────────────────────────────────────────────────── */

export interface ImpactStat { label: string; value: string }

/**
 * Placeholders, deliberately. Real figures belong here the moment they exist
 * — pulled from the same tables the admin portal already reads, the same
 * discipline PLAN_MONTHLY_FEES enforces on pricing. Until then this renders
 * an honest em-dash rather than an invented number.
 */
export const IMPACT_STATS: ImpactStat[] = [
  { label: 'Groups digitized',      value: '—' },
  { label: 'Members served',        value: '—' },
  { label: 'Transactions processed', value: '—' },
  { label: 'Funds managed',         value: '—' },
  { label: 'Communities reached',   value: '—' },
];

