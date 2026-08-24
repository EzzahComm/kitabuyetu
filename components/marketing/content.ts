import {
  ArrowLeftRight, BarChart3, BookOpen, BookMarked, Building2, ClipboardList,
  Coins, EyeOff, GitBranch, KeyRound, Landmark, Lock, PiggyBank,
  ScrollText, ShieldCheck, Smartphone, Table2, UserRound, Users, Wallet,
  type LucideIcon,
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

/* ── Section 6 — product showcase ─────────────────────────────────────────── */

export type ShowcaseVisual = 'ledger' | 'payment' | 'reports' | 'messages';

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
      'A chart of accounts created for your group at registration',
      'Journals posted automatically as money moves',
      'A trial balance that balances, on demand',
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
];

/* ── Section 7 — how it works ─────────────────────────────────────────────── */

export interface Step { title: string; body: string }

export const STEPS: Step[] = [
  {
    title: 'Create your group',
    body:  'Register in a few minutes. Your group gets its own chart of accounts and its own M-Pesa account reference, set up for you.',
  },
  {
    title: 'Invite your members',
    body:  'Add members one at a time or import the register you already keep. Each member gets a membership number that doubles as their payment reference.',
  },
  {
    title: 'Record savings and loans',
    body:  'Take contributions by M-Pesa or record cash at the meeting. Issue loans, set the schedule, collect the repayments.',
  },
  {
    title: 'Run the group from one book',
    body:  'Reports, statements, reminders and the audit trail all read from the same ledger. Nothing is kept twice.',
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
    linkText: 'Organization portal',
  },
];

/* ── Section 9 — payments ─────────────────────────────────────────────────── */

export interface FlowStep { label: string; body: string }

/** Traces the real path: mpesa-stk / mpesa-c2b → daraja callback →
 *  mpesa-allocation → contribution-splits → accounting.postContributionJournal
 *  → sms + receipt. */
export const PAYMENT_FLOW: FlowStep[] = [
  { label: 'Member pays',      body: 'An STK prompt on their phone, or your PayBill quoting their membership number.' },
  { label: 'Safaricom confirms', body: 'The Daraja callback arrives and is verified before anything is written down.' },
  { label: 'Matched to a member', body: 'By membership number, or by the STK request that started it.' },
  { label: 'Split by your rules', body: 'Savings, welfare and loan repayment, in the proportions your group set.' },
  { label: 'Journal posted',   body: 'Both sides of the entry, including Safaricom’s transaction fee.' },
  { label: 'Everyone told',    body: 'Receipt to the member, balances updated, reports current.' },
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
    kind:  'Talk to us',
    title: 'Contact',
    body:  'A demo, a question about your group, or a partnership — reach a person in Nairobi.',
    href:  ROUTES.contact,
  },
];

