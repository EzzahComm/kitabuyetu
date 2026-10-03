import {
  ArrowLeftRight,
  BarChart3,
  BookOpen,
  BookMarked,
  Briefcase,
  Building2,
  ClipboardList,
  Coins,
  EyeOff,
  Gift,
  GitBranch,
  Heart,
  KeyRound,
  Landmark,
  Layers,
  Lock,
  Megaphone,
  MessageSquareText,
  Network,
  PiggyBank,
  ScrollText,
  Send,
  ShieldCheck,
  Smartphone,
  Sprout,
  Store,
  Table2,
  UserRound,
  Users,
  Wallet,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { CHANGISHA_PRICING } from '@/types/enums';
import { ROUTES } from './routes';

/* ────────────────────────────────────────────────────────────────────────────
 * Every word on the public site that is not a price.
 *
 * ONE RULE GOVERNS THIS FILE: EVERY CLAIM IS BACKED BY CODE. Each block below
 * carries the service, route or constant that makes it true. If the
 * implementation changes, the copy here is wrong, and this is the one place to
 * fix it.
 *
 * No prices, plan names or SMS allowances are typed here at all - those are
 * read live from `types/enums.ts`, which is what the M-Pesa callback itself
 * prices against. A hand-maintained copy of the price list is precisely what
 * once had the public pages advertising numbers the server did not charge.
 *
 * Routes live in ./routes.ts, which is icon-free so the client-side header can
 * import the nav without dragging twenty lucide glyphs into the bundle.
 * ──────────────────────────────────────────────────────────────────────────── */

/* ── Section 3 - the problem ──────────────────────────────────────────────── */

export interface PainPoint {
  icon: LucideIcon;
  title: string;
  body: string;
}

export const PAIN_POINTS: PainPoint[] = [
  {
    icon: BookMarked,
    title: 'The paper book',
    body: 'One book, one person's handwriting. Lose a page and the group loses its history.',
  },
  {
    icon: Table2,
    title: 'The spreadsheet',
    body: 'Three officers, three copies - and nobody sure which one is right.',
  },
  {
    icon: ArrowLeftRight,
    title: 'Reconciliation night',
    body: 'The night before every meeting, the treasurer matches M-Pesa messages to names, line by line.',
  },
  {
    icon: EyeOff,
    title: 'Nobody can see the balance',
    body: 'Members only hear their balance when someone reads it out at the meeting.',
  },
];

/* ── Section 4 - what Kitabu Yetu does ────────────────────────────────────── */

export interface Capability {
  icon: LucideIcon;
  title: string;
  body: string;
}

/** Each entry names the module that implements it:
 *  contributions + contribution-splits - loans + approval-policy - members +
 *  import - mpesa-stk/c2b/b2c over daraja - reports + accounting -
 *  member-passbook (the app/(member)/me portal). */
export const CAPABILITIES: Capability[] = [
  {
    icon: PiggyBank,
    title: 'Savings and contributions',
    body: 'Recorded as they arrive and split into savings, welfare and loan repayment - by rules you set once.',
  },
  {
    icon: Landmark,
    title: 'Loans',
    body: 'Apply, approve, pay out and track repayments. Big loans need a second approver.',
  },
  {
    icon: Users,
    title: 'Members',
    body: 'Who's in, their role, what they've paid and what they owe. Bring your list from a spreadsheet.',
  },
  {
    icon: Smartphone,
    title: 'M-Pesa',
    body: 'Collect through a payment prompt or your PayBill, and pay out straight to members' M-Pesa.',
  },
  {
    icon: Sprout,
    title: 'Income-generating activities and investments',
    body: 'Land, rentals, a shop or a fixed deposit - see what each earns, what it costs and whether it's paying off.',
  },
  {
    icon: BarChart3,
    title: 'Reports',
    body: 'Member statements, contribution and loan reports - ready in minutes, never retyped.',
  },
  {
    icon: BookOpen,
    title: 'Member passbook',
    body: 'Every member checks their own savings, loan and goals - any time, not just at meetings.',
  },
];

/**
 * The four-up value proposition directly under the hero - the whole product
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
    body: 'One up-to-date list of members, roles and what each has paid.',
  },
  {
    icon: PiggyBank,
    title: 'Money',
    body: 'Savings, loans, welfare, shares and investments in one place.',
  },
  {
    icon: Smartphone,
    title: 'Payments',
    body: 'M-Pesa payments go straight into your records.',
  },
  {
    icon: BarChart3,
    title: 'Reports',
    body: 'Statements and reports without redoing the maths.',
  },
];

/* ── Section 6 - product showcase ─────────────────────────────────────────── */

export type ShowcaseVisual = 'ledger' | 'payment' | 'reports' | 'messages' | 'shares';

export interface ShowcaseItem {
  eyebrow: string;
  title: string;
  emphasis: string;
  body: string;
  points: string[];
  visual: ShowcaseVisual;
  /** Optional deep link to a real page that explains this further. */
  href?: string;
  linkText?: string;
}

export const SHOWCASE: ShowcaseItem[] = [
  {
    eyebrow: 'Keep the books',
    title: 'Books an auditor trusts,',
    emphasis: 'screens a treasurer enjoys',
    body: 'Proper accounting underneath. Plain language on top.',
    points: [
      'Members, savings, contributions, loans, welfare, shares and dividends',
      'Income-generating activities and investments - income, running costs and net performance',
      'Every payment recorded automatically',
      'Close the month so past records can't change',
    ],
    visual: 'ledger',
    href: ROUTES.bookkeeper,
    linkText: 'More on Bookkeeper',
  },
  {
    eyebrow: 'Move the money',
    title: 'Money in and out,',
    emphasis: 'straight through M-Pesa',
    body: 'The payment and the record happen together - so they always agree.',
    points: [
      'A payment prompt straight to the member's phone',
      'PayBill payments matched by the member's membership number',
      'Loans, welfare and dividends paid out to M-Pesa',
      'M-Pesa charges recorded on every transaction',
    ],
    visual: 'payment',
  },
  {
    eyebrow: 'Know your numbers',
    title: 'The answer to "where do we stand?"',
    emphasis: 'in one screen',
    body: 'Balances, loans and welfare from one source - so the report and the meeting agree.',
    points: [
      'Member statements and full transaction history',
      'Contribution, loan and welfare reports',
      'Credit scores built from a member's own repayment record',
      'A portfolio view across many groups for organizations',
    ],
    visual: 'reports',
  },
  {
    eyebrow: 'Keep everyone in the loop',
    title: 'Members hear from the group,',
    emphasis: 'not from rumour',
    body: 'Confirmations, reminders and announcements sent from the same place the money is kept.',
    points: [
      'SMS confirmations, reminders and announcements',
      'WhatsApp and email for groups that prefer them',
      'PDF receipts and member statements',
      'Meeting notices and birthday greetings',
    ],
    visual: 'messages',
    href: ROUTES.chamaReminder,
    linkText: 'More on Chama Reminder',
  },
  {
    eyebrow: 'Grow the group's money',
    title: 'Shares, dividends and the activities',
    emphasis: 'that earn for the group',
    body: 'Track shares and dividends, plus every project the group invests in - and whether it's paying off.',
    points: [
      'Share records with printable certificates',
      'Dividends allocated across real holdings, not estimated',
      'Income-generating activities and investments: farming, poultry, rentals, water projects, shops',
      'Returns and running costs recorded against each one',
    ],
    visual: 'shares',
    href: ROUTES.bookkeeper,
    linkText: 'More on Bookkeeper',
  },
];

/* ── Section 7 - how it works ─────────────────────────────────────────────── */

export interface Step {
  title: string;
  body: string;
}

/**
 * The six-step journey - Create, Organize, Set your rules, Start recording,
 * Digital ledger, Grow. Steps 4 and 5 each have a real, shipped feature behind
 * every sentence (contribution-splits; Daraja + the posting templates). Grow
 * reaches toward the ecosystem (organizations, donors, programs) - several of
 * those destinations are the vision this platform is building toward rather
 * than a shipped feature today; see each /ecosystem/* page for what is live
 * versus what is coming.
 */
export const STEPS: Step[] = [
  {
    title: 'Create',
    body: 'Register in minutes. Your books and M-Pesa reference are set up for you.',
  },
  {
    title: 'Organize',
    body: 'Add members or import your list. Assign chair, treasurer and secretary.',
  },
  {
    title: 'Set your rules',
    body: 'Set contributions, loans and welfare once. Splits, schedules and reminders then run themselves.',
  },
  {
    title: 'Start recording',
    body: 'Record cash by hand. M-Pesa payments record themselves.',
  },
  {
    title: 'Always balanced',
    body: 'Every shilling lands in books that always add up.',
  },
  {
    title: 'Grow',
    body: 'Use your track record to reach partners, donors and programmes.',
  },
];

/* ── Section 8 - roles ────────────────────────────────────────────────────── */

export interface RoleCard {
  icon: LucideIcon;
  title: string;
  body: string;
  /** Where this role actually works, when it is a public entry point. */
  href?: string;
  linkText?: string;
}

/**
 * These are the REAL roles - `MemberRole` in types/enums.ts is exactly
 * chairperson / treasurer / secretary / member, and organizations come in
 * through `PlatformRole.organization_coordinator` and the (enterprise) portal.
 * There is deliberately no separate "group administrator" card: the
 * chairperson IS the group's administrator (`ROLE_HIERARCHY` puts them top of
 * the group at 80), and inventing a sixth role for symmetry would be a
 * marketing claim the permission model does not honour.
 */
export const ROLES: RoleCard[] = [
  {
    icon: UserRound,
    title: 'Members',
    body: 'Check your savings and loan, and pay from your phone.',
    href: ROUTES.memberApp,
    linkText: 'Member portal',
  },
  {
    icon: Wallet,
    title: 'Treasurers',
    body: 'Answer "has she paid?" in seconds - no statement needed.',
  },
  {
    icon: ClipboardList,
    title: 'Secretaries',
    body: 'Register, meetings and minutes - next to the money.',
  },
  {
    icon: ShieldCheck,
    title: 'Chairpersons',
    body: 'Approve loans and payouts, set the rules, see the group's health.',
  },
  {
    icon: Building2,
    title: 'Organizations and networks',
    body: 'One portal for every group and programme you support.',
    href: ROUTES.orgPortal,
    linkText: 'Enterprise portal',
  },
];

/* ── Section 9 - payments ─────────────────────────────────────────────────── */

export interface FlowStep {
  label: string;
  body: string;
}

/**
 * Traces the real path: mpesa-stk / mpesa-c2b → daraja callback →
 * mpesa-allocation → contribution-splits → accounting.postContributionJournal
 * → sms + receipt.
 *
 * Three steps, not the six this used to list. The six were each accurate, but
 * they described the SYSTEM's work rather than the group's experience - a
 * treasurer does not do six things, they do one, and the other five happen to
 * them. Every fact from the longer version survives inside these bodies
 * (Daraja verification, matching by membership number, the split rules, both
 * sides of the journal, the fee, the receipt); none of it was dropped to make
 * the section shorter.
 */
export const PAYMENT_FLOW: FlowStep[] = [
  {
    label: 'Member pays',
    body: 'A payment prompt on their phone, or your PayBill with their member number. Anyone can pay on their behalf.',
  },
  {
    label: 'Payment is matched',
    body: 'Each payment is checked with M-Pesa, then matched to the right member automatically.',
  },
  {
    label: 'The records update',
    body: 'Split by your rules, recorded, and confirmed to the member by SMS - instantly.',
  },
];

/* ── Section 10 - trust ───────────────────────────────────────────────────── */

export interface Control {
  icon: LucideIcon;
  title: string;
  body: string;
}

/** Every control below is shipped and live - role checks, staff TOTP,
 *  maker-checker approvals (approval-policy.service), the audit log, Postgres
 *  row-level tenant isolation, and the official Daraja integration. Nothing
 *  aspirational, and no unfalsifiable "bank-grade security" line. */
export const CONTROLS: Control[] = [
  {
    icon: KeyRound,
    title: 'Role-based access',
    body: 'Everyone sees and does only what their role allows.',
  },
  {
    icon: GitBranch,
    title: 'Two approvers',
    body: 'Large payouts and write-offs need a second official's sign-off.',
  },
  {
    icon: ScrollText,
    title: 'Every change recorded',
    body: 'Who changed what, and when - always on record.',
  },
  {
    icon: Building2,
    title: 'Private to your group',
    body: 'No other group can ever see your members or money.',
  },
  {
    icon: Lock,
    title: 'Two-factor for staff',
    body: 'Staff sign in with a one-time code, not just a password.',
  },
  {
    icon: Coins,
    title: 'Real M-Pesa',
    body: 'Payments go straight through M-Pesa - no middlemen, no workarounds.',
  },
];

/* ── Section 11 - resources ───────────────────────────────────────────────── */

export interface ResourceCard {
  kind: string;
  title: string;
  body: string;
  href: string;
}

/**
 * Real destinations only. There is no blog and no CMS in this repository, so
 * this section is an honest index of the pages that exist rather than five
 * invented article cards linking nowhere - which is the single most common way
 * a marketing redesign ships dead links.
 */
export const RESOURCES: ResourceCard[] = [
  {
    kind: 'Product',
    title: 'Kitabu Yetu Bookkeeper',
    body: 'Contributions, loans, welfare and shares - books that always balance.',
    href: ROUTES.bookkeeper,
  },
  {
    kind: 'Product',
    title: 'Chama Reminder',
    body: 'SMS reminders and announcements. Nothing to set up.',
    href: ROUTES.chamaReminder,
  },
  {
    kind: 'Overview',
    title: 'The ecosystem',
    body: 'The tools a group can use, and the organizations and partners that work alongside them.',
    href: ROUTES.ecosystem,
  },
  {
    kind: 'Live',
    title: 'System status',
    body: 'What is running right now, including payments and messaging.',
    href: ROUTES.status,
  },
  {
    kind: 'Help',
    title: 'Support',
    body: 'Written guides are still being built. Until they land, ask us directly and we answer.',
    href: ROUTES.support,
  },
  {
    kind: 'Reference',
    title: 'Documentation',
    body: 'Technical reference for developers.',
    href: ROUTES.docs,
  },
  {
    kind: 'Talk to us',
    title: 'Contact',
    body: 'A demo, a question about your group, or a partnership - reach a person in Nairobi.',
    href: ROUTES.contact,
  },
];

/* ── Section 12 - product pillars (Products overview + homepage) ─────────── */

export interface ProductPillar {
  icon: LucideIcon;
  title: string;
  body: string;
  points: string[];
  href: string;
  linkText: string;
  /** `live` has a real, shipped feature behind every point below. `vision`
   *  describes where the product is going - labelled as such on every page
   *  that renders it, never presented as available today. */
  status: 'live' | 'vision';
}

export const PRODUCT_PILLARS: ProductPillar[] = [
  {
    icon: BookOpen,
    title: 'Bookkeeper',
    body: 'Run your whole group - members, money and reports - in books that always balance.',
    points: [
      'Contributions, loans, welfare and shares',
      'Collect and pay out by M-Pesa',
      'Statements, reports and a record of every change',
    ],
    href: ROUTES.bookkeeper,
    linkText: 'Explore Bookkeeper',
    status: 'live',
  },
  {
    icon: MessageSquareText,
    title: 'Chama Reminder / Kumbusha',
    body: 'Keep members informed and contributions on time - no bookkeeping needed.',
    points: [
      'Contribution and meeting reminders',
      'Group announcements by SMS',
      'Runs standalone, or alongside Bookkeeper',
    ],
    href: ROUTES.chamaReminder,
    linkText: 'Explore Chama Reminder',
    status: 'live',
  },
  {
    icon: Gift,
    title: 'Fundraise / Changi$ha',
    body: 'Public M-Pesa campaigns for causes and projects, checked by us before they go live.',
    points: [
      'Shareable campaign pages with a running total',
      'Donations by M-Pesa, recorded automatically',
      `No monthly fee - ${CHANGISHA_PRICING.platformFeePct}% when you withdraw`,
    ],
    href: ROUTES.fundraise,
    linkText: 'See live campaigns',
    // Live since migrations 182-201: public campaign pages, M-Pesa donations,
    // admin review and B2C withdrawals. Pricing from CHANGISHA_PRICING.
    status: 'live',
  },
  {
    icon: Briefcase,
    title: 'Enterprise',
    body: 'Oversee many groups and programmes from one place - each keeps its own book.',
    points: [
      'Multi-group and multi-organization dashboards',
      'Programs, funding and disbursements to the groups you back',
      'Organization reports and a full audit log',
    ],
    href: ROUTES.enterprise,
    linkText: 'Explore Enterprise',
    // Corrected from 'vision' 2026-08-26. This was stale, and it was
    // understating the product: the (enterprise) portal ships ten real
    // screens - dashboard, members, branches, funding, disbursements,
    // reports, billing, branding, audit and api-keys - behind 35 live
    // /api/admin/organization* routes, with organization plans in
    // migration 152. Every point above names one of those screens.
    // Per-group member-level stake is still NOT built; nothing here claims it.
    status: 'live',
  },
];

/* ── Section 13 - why Kitabu Yetu ─────────────────────────────────────────── */

export interface ValueProp {
  icon: LucideIcon;
  title: string;
  body: string;
}

/**
 * The eight-point case for the platform. Digital Administration, Financial
 * Transparency, Cashless Collections and Better Reporting each name a
 * shipped mechanism (the ledger, the passbook, Daraja, the reports module).
 * Automated Communication, Seamless Disbursements, Greater Accountability
 * and Connected Communities lean forward toward the ecosystem this platform
 * is building into.
 */
export const WHY_KITABU_YETU: ValueProp[] = [
  {
    icon: Layers,
    title: 'Digital Administration',
    body: 'One shared book replaces the notebook and the treasurer's phone.',
  },
  {
    icon: ShieldCheck,
    title: 'Financial Transparency',
    body: 'Every member sees their own numbers.',
  },
  {
    icon: Zap,
    title: 'Automated Communication',
    body: 'Reminders and confirmations go out on their own.',
  },
  {
    icon: Smartphone,
    title: 'Cashless Collections',
    body: 'Contributions and repayments by M-Pesa - prompt or PayBill.',
  },
  {
    icon: Send,
    title: 'Seamless Disbursements',
    body: 'Loans, welfare and dividends paid straight to M-Pesa.',
  },
  {
    icon: BarChart3,
    title: 'Better Reporting',
    body: 'Reports in minutes, never retyped.',
  },
  {
    icon: GitBranch,
    title: 'Greater Accountability',
    body: 'Roles for every official and two approvers for big payouts.',
  },
  {
    icon: Network,
    title: 'Connected Communities',
    body: 'Your records open doors to partners, donors and programmes.',
  },
];

/* ── Section 14 - the ecosystem (homepage section + /ecosystem hub) ──────── */

export interface EcosystemPillar {
  icon: LucideIcon;
  title: string;
  body: string;
  href: string;
  status: 'live' | 'vision';
}

/**
 * Multigroup Organizations is real - multi-group registration and the
 * (enterprise) portal both shipped. Donors, Marketplace and Programs are the
 * vision for where those same rails lead; each is labelled `vision` and its
 * own page says so plainly rather than describing a feature that does not
 * exist yet as if it does.
 */
export const ECOSYSTEM_PILLARS: EcosystemPillar[] = [
  {
    icon: Building2,
    title: 'Multigroup Organizations',
    body: 'One login for every group and branch you run.',
    href: ROUTES.ecosystemOrganizations,
    status: 'live',
  },
  {
    icon: Heart,
    title: 'Donors',
    body: 'Funders find, back and follow group projects.',
    href: ROUTES.ecosystemDonors,
    status: 'vision',
  },
  {
    icon: Store,
    title: 'Marketplace',
    body: 'Products, suppliers and financial partners for groups.',
    href: ROUTES.ecosystemMarketplace,
    status: 'vision',
  },
  {
    icon: Megaphone,
    title: 'Programs',
    body: 'Grants and opportunities for qualifying groups.',
    href: ROUTES.ecosystemPrograms,
    status: 'vision',
  },
];

/* ── Section 16 - Enterprise (homepage section + /enterprise-solutions) ───── */

export interface EnterpriseFeature {
  icon: LucideIcon;
  title: string;
  body: string;
}

/**
 * Every card names a screen that exists in `app/(enterprise)/enterprise/`,
 * backed by one of the 35 live `/api/admin/organization*` routes. Verified
 * 2026-08-26 before this section was written, because the product pillar had
 * been sitting on `status: 'vision'` while the portal was already shipping -
 * the copy was behind the code, not ahead of it.
 *
 * DELIBERATELY ABSENT - do not add these back without checking the code:
 *  • API keys / webhooks. The `api-keys` screen is a MOCK: it imports seed
 *    rows from `_data` and its own comment says "no API key issuance /
 *    webhook delivery backend exists yet". This card claimed them on
 *    2026-08-27 and was live and false for about an hour. Screen size is not
 *    evidence a feature exists - that page is 214 lines of working UI over
 *    nothing.
 *  • Any claim that an organization sees inside a group's member-level
 *    records. It does not, and the tenant isolation in migration 097 stops it.
 */
export const ENTERPRISE_FEATURES: EnterpriseFeature[] = [
  {
    icon: Building2,
    title: 'Every group in one account',
    body: 'One login for all your groups - each keeps its own officers, books and members.',
  },
  {
    icon: BarChart3,
    title: 'Organization dashboard',
    body: 'Activity and contributions across your portfolio, from the groups' own books.',
  },
  {
    icon: Megaphone,
    title: 'Programs',
    body: 'Set budgets and criteria, and track which groups are enrolled.',
  },
  {
    icon: Send,
    title: 'Funding and disbursements',
    body: 'Send funds to your groups against a budget, with a second approver.',
  },
  {
    icon: ScrollText,
    title: 'Audit log and access control',
    body: 'Staff roles, one-time-code sign-in, and every action recorded.',
  },
  {
    icon: Layers,
    title: 'Reports and your own branding',
    body: 'Budget vs actual, spend by donor, and your own logo on what you send.',
  },
];

/* ── Section 17 - the two customer paths ──────────────────────────────────── */

export interface CustomerPath {
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  body: string;
  audience: string[];
  href: string;
  linkText: string;
}

/** The self-selection fork. Both destinations are real pages; the group path
 *  goes to registration because a group can genuinely self-serve, and the
 *  organization path goes to the public Enterprise pitch rather than
 *  ROUTES.orgPortal, which is the authenticated portal behind a sign-in. */
export const CUSTOMER_PATHS: CustomerPath[] = [
  {
    icon: Users,
    eyebrow: 'I run a group',
    title: 'Your members, money and meetings - sorted.',
    body: 'Savings, loans, welfare and M-Pesa in one book. No more reconciling by hand.',
    audience: ['Chamas', 'Welfare groups', 'Investment clubs', 'SACCOs', 'VSLAs', 'Community groups'],
    href: ROUTES.startGroup,
    linkText: 'Start your group',
  },
  {
    icon: Network,
    eyebrow: 'I manage many groups',
    title: 'See every group. Report in minutes.',
    body: 'One account for all your groups, programmes and funding - each group keeps its own book.',
    audience: ['NGOs', 'CBOs', 'Federations', 'SACCO networks', 'Development programs', 'Institutions'],
    href: ROUTES.enterprise,
    linkText: 'Explore Enterprise',
  },
];

/* ── Section 18 - what a member actually gets ─────────────────────────────── */

export interface MemberBenefit {
  icon: LucideIcon;
  title: string;
  body: string;
}

/** All six are screens in the `app/(member)/me` portal - passbook,
 *  contributions, loan balances, transaction history, statements and goals.
 *  Nothing here describes a member-facing feature that isn't in that portal. */
export const MEMBER_BENEFITS: MemberBenefit[] = [
  {
    icon: PiggyBank,
    title: 'What they have saved',
    body: 'Savings totals, updated the moment they pay.',
  },
  {
    icon: Landmark,
    title: 'What they still owe',
    body: 'Loan balance and the next payment due.',
  },
  {
    icon: BookOpen,
    title: 'Their own passbook',
    body: 'Every transaction, any time.',
  },
  {
    icon: ScrollText,
    title: 'Statements they can keep',
    body: 'Download it themselves - no need to ask.',
  },
  {
    icon: Coins,
    title: 'Savings goals',
    body: 'Set a target and watch progress.',
  },
  {
    icon: Smartphone,
    title: 'Paying from their phone',
    body: 'A payment prompt on their phone to contribute or repay.',
  },
];

/* ── Section 15 - impact ──────────────────────────────────────────────────── */

export interface ImpactStat {
  label: string;
  value: string;
}

/**
 * Placeholders, deliberately. Real figures belong here the moment they exist
 * - pulled from the same tables the admin portal already reads, the same
 * discipline PLAN_MONTHLY_FEES enforces on pricing. Until then this renders
 * an honest em-dash rather than an invented number.
 */
export const IMPACT_STATS: ImpactStat[] = [
  { label: 'Groups digitized', value: '-' },
  { label: 'Members served', value: '-' },
  { label: 'Transactions processed', value: '-' },
  { label: 'Funds managed', value: '-' },
  { label: 'Communities reached', value: '-' },
];

/* ── Section 19 - homepage FAQ ────────────────────────────────────────────── */

/**
 * Every answer repeats wording already verified for /pricing and /support
 * (their own FAQ arrays), so the homepage cannot promise more than those
 * pages do. Rendered as FAQPage JSON-LD from this same array.
 */
export const HOME_FAQS: [question: string, answer: string][] = [
  [
    'Which product should we start with?',
    'Chama Reminder if you only need to reach members. Bookkeeper if you also need to keep the money records.',
  ],
  [
    'Is M-Pesa included?',
    'Yes, on every plan. Members pay through a prompt on their phone or your PayBill, and payouts go straight to their M-Pesa.',
  ],
  [
    'Can members pay by something other than M-Pesa?',
    'Yes. Record cash, bank or cheque by hand. M-Pesa payments record themselves.',
  ],
  [
    'Can we bring in our existing records?',
    'Yes. Bring your members and past contributions in from a spreadsheet on any plan.',
  ],
  [
    "Can another group see our group's records?",
    'No. Your records are locked to your group - no one else can see them.',
  ],
  ['Is there a free plan or a lock-in?', 'Neither. Pay monthly by M-Pesa and change or stop any time.'],
];
