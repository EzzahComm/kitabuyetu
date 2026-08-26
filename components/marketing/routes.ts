/* ────────────────────────────────────────────────────────────────────────────
 * Public routes, navigation and footer structure.
 *
 * Split out of content.ts on purpose: the header is a client component, and
 * content.ts holds ~20 lucide icon references at module scope. Importing the
 * nav from there would drag every one of those icons into the client bundle
 * for a menu that renders none of them. This module is icon-free and free to
 * cross the server/client boundary.
 *
 * THE INVARIANT: every href below resolves to a real page in `app/`. A
 * previous version of the footer shipped 10 dead links out of 16 (see its own
 * note in git history) — "the link works" is checked here, once.
 * ──────────────────────────────────────────────────────────────────────────── */

export const ROUTES = {
  home:          '/',
  signIn:        '/login',
  startGroup:    '/register',
  pricing:       '/pricing',
  about:         '/about',
  contact:       '/contact',
  support:       '/support',
  docs:          '/docs',
  status:        '/status',
  ecosystem:     '/ecosystem',
  bookkeeper:    '/bookkeeper',
  chamaReminder: '/chama-reminder',
  fundraise:     '/fundraise',
  memberApp:     '/me',
  orgPortal:     '/enterprise',
  backoffice:    '/admin-login',
} as const;

/** In-page anchors on the home page, referenced from the header and footer —
 *  so the ids are declared once instead of as loose strings in three files. */
export const SECTION_IDS = {
  solution:   'what-it-does',
  showcase:   'product',
  howItWorks: 'how-it-works',
  payments:   'payments',
  pricing:    'pricing',
} as const;

export interface NavLink { label: string; href: string }

export const NAV_LINKS: NavLink[] = [
  { label: 'Bookkeeper',     href: ROUTES.bookkeeper },
  { label: 'Chama Reminder', href: ROUTES.chamaReminder },
  { label: 'Ecosystem',      href: ROUTES.ecosystem },
  { label: 'How it works',   href: `/#${SECTION_IDS.howItWorks}` },
  { label: 'Pricing',        href: ROUTES.pricing },
];

export interface FooterColumn { heading: string; links: NavLink[] }

/**
 * Legal pages (Privacy / Terms) remain deliberately ABSENT, as they were
 * before this redesign: fabricated legal text for a product that handles real
 * money and personal data is worse than no link at all. They go in the moment
 * real, approved wording exists.
 */
export const FOOTER_COLUMNS: FooterColumn[] = [
  {
    heading: 'Product',
    links: [
      { label: 'Bookkeeper',     href: ROUTES.bookkeeper },
      { label: 'Chama Reminder', href: ROUTES.chamaReminder },
      { label: 'Fundraise',      href: ROUTES.fundraise },
      { label: 'Pricing',        href: ROUTES.pricing },
      { label: 'How it works',   href: `/#${SECTION_IDS.howItWorks}` },
    ],
  },
  {
    heading: 'Ecosystem',
    links: [
      { label: 'The ecosystem',   href: ROUTES.ecosystem },
      { label: 'Member portal',   href: ROUTES.memberApp },
      { label: 'Group dashboard', href: ROUTES.startGroup },
      { label: 'Organizations',   href: ROUTES.orgPortal },
      { label: 'Backoffice',      href: ROUTES.backoffice },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'About',   href: ROUTES.about },
      { label: 'Contact', href: ROUTES.contact },
    ],
  },
  {
    heading: 'Support',
    links: [
      { label: 'Help and support', href: ROUTES.support },
      { label: 'Documentation',    href: ROUTES.docs },
      { label: 'System status',    href: ROUTES.status },
    ],
  },
];

/** Contact details, matching what the shipped footer already publishes. */
export const CONTACT = {
  email:  'info@kitabuyetu.co.ke',
  phones: ['+254 717 548 646', '+254 738 692 698'],
  city:   'Nairobi, Kenya',
} as const;
