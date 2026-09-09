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
  contact:       '/contact',
  support:       '/support',
  docs:          '/docs',
  status:        '/status',

  // About
  about:         '/about',
  aboutTeam:     '/about/team',
  aboutImpact:   '/about/impact',

  // Products
  products:      '/products',
  bookkeeper:    '/bookkeeper',
  chamaReminder: '/chama-reminder',
  fundraise:     '/fundraise',
  // Deliberately NOT `/enterprise` — that path is the authenticated
  // organization portal (`app/(enterprise)/enterprise`), a real logged-in
  // dashboard, not a marketing page. Reusing it for a public pitch would put
  // a sign-in gate where a prospect expects a description of the product.
  enterprise:    '/enterprise-solutions',

  // Ecosystem
  ecosystem:               '/ecosystem',
  ecosystemDonors:         '/ecosystem/donors',
  ecosystemOrganizations:  '/ecosystem/organizations',
  ecosystemMarketplace:    '/ecosystem/marketplace',
  ecosystemPrograms:       '/ecosystem/programs',

  // Legal — stub pages only. See the note on LEGAL_LINKS below for why.
  legalTerms:            '/legal/terms',
  legalPrivacy:          '/legal/privacy',
  legalDataProtection:   '/legal/data-protection',

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
  ecosystem:  'ecosystem',
  payments:   'payments',
  pricing:    'pricing',
} as const;

export interface NavLink { label: string; href: string; description?: string }

/** A top-nav item that opens a dropdown of related pages, rather than
 *  navigating directly. */
export interface NavGroup { label: string; items: NavLink[] }

export type NavEntry = NavLink | NavGroup;

export function isNavGroup(entry: NavEntry): entry is NavGroup {
  return 'items' in entry;
}

export const ABOUT_ITEMS: NavLink[] = [
  { label: 'Our Story', href: ROUTES.about, description: 'Why Kitabu Yetu exists, and the problem it set out to solve.' },
  { label: 'Our Team',  href: ROUTES.aboutTeam, description: 'The people and expertise behind the platform.' },
  { label: 'Impact',    href: ROUTES.aboutImpact, description: 'What digitizing group administration is changing.' },
];

export const PRODUCT_ITEMS: NavLink[] = [
  { label: 'Bookkeeper',     href: ROUTES.bookkeeper, description: 'Contributions, loans, welfare, shares and a real ledger.' },
  { label: 'Chama Reminder', href: ROUTES.chamaReminder, description: 'SMS reminders and announcements, no ledger required.' },
  { label: 'Fundraise / Changi$ha', href: ROUTES.fundraise, description: 'Public campaigns and M-Pesa collections for a cause.' },
  { label: 'Enterprise',     href: ROUTES.enterprise, description: 'Multi-group and multi-organization management.' },
];

export const ECOSYSTEM_ITEMS: NavLink[] = [
  { label: 'Donors',                  href: ROUTES.ecosystemDonors, description: 'Discover, support and monitor groups and projects.' },
  { label: 'Multigroup Organizations', href: ROUTES.ecosystemOrganizations, description: 'One login, every group and branch you run.' },
  { label: 'Marketplace',             href: ROUTES.ecosystemMarketplace, description: 'Products, services and financial partners for groups.' },
  { label: 'Programs',                href: ROUTES.ecosystemPrograms, description: 'Grants, opportunities and interventions for qualifying groups.' },
];

/**
 * Primary navigation. About / Products / Ecosystem are dropdowns
 * (`NavGroup`); everything else is a direct link. `isNavGroup` narrows which
 * is which in the header, so it stays a single typed array rather than two
 * parallel lists that can drift apart.
 */
/**
 * Primary navigation. About and Products are dropdowns (`NavGroup`);
 * everything else is a direct link. `isNavGroup` narrows which is which in the
 * header, so it stays a single typed array rather than two parallel lists that
 * can drift apart.
 *
 * ENTERPRISE IS TOP-LEVEL, not buried in the Products dropdown: it is a
 * shipped product with its own buyer, and an institution evaluating it should
 * not have to open a menu to find out it exists.
 *
 * ECOSYSTEM IS DELIBERATELY ABSENT HERE. It is the vision layer, not a product
 * anyone can buy today, and putting it beside Pricing implied otherwise. Its
 * four pages stay reachable — from the footer's Ecosystem column and from the
 * homepage section — so nothing is orphaned by the demotion.
 */
export const NAV_ITEMS: NavEntry[] = [
  { label: 'Home',          href: ROUTES.home },
  { label: 'About',         items: ABOUT_ITEMS },
  { label: 'Products',      items: PRODUCT_ITEMS },
  { label: 'Enterprise',    href: ROUTES.enterprise },
  { label: 'How it works',  href: `/#${SECTION_IDS.howItWorks}` },
  { label: 'Pricing',       href: ROUTES.pricing },
  { label: 'Contact',       href: ROUTES.contact },
];

/** Flattened for anywhere that still just needs "every real nav destination"
 *  (e.g. a sitemap or a flat search index), without the dropdown grouping. */
export const NAV_LINKS: NavLink[] = NAV_ITEMS.flatMap((entry) =>
  isNavGroup(entry) ? entry.items : [entry],
);

export interface FooterColumn { heading: string; links: NavLink[] }

/**
 * Legal pages exist as routes now, but deliberately hold placeholder content,
 * not real policy text — a wrong Privacy Policy or Terms document for a
 * product handling real money and personal data is a liability, not a
 * marketing choice, so nobody should draft it except counsel. See each page
 * under app/legal/ for the "pending legal review" notice. Do not fill these
 * in with generated policy language.
 */
export const FOOTER_COLUMNS: FooterColumn[] = [
  {
    heading: 'Products',
    links: PRODUCT_ITEMS,
  },
  {
    heading: 'Ecosystem',
    links: ECOSYSTEM_ITEMS,
  },
  {
    heading: 'Company',
    links: [
      { label: 'Our Story',    href: ROUTES.about },
      { label: 'Team',         href: ROUTES.aboutTeam },
      { label: 'Impact',       href: ROUTES.aboutImpact },
      { label: 'How it works', href: `/#${SECTION_IDS.howItWorks}` },
      { label: 'Pricing',      href: ROUTES.pricing },
      { label: 'Contact',      href: ROUTES.contact },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { label: 'Terms & Conditions', href: ROUTES.legalTerms },
      { label: 'Privacy Policy',     href: ROUTES.legalPrivacy },
      { label: 'Data Protection',    href: ROUTES.legalDataProtection },
    ],
  },
];

/** Contact details, matching what the shipped footer already publishes. */
export const CONTACT = {
  email:  'info@kitabuyetu.co.ke',
  phones: ['+254 717 548 646', '+254 738 692 698'],
  city:   'Nairobi, Kenya',
} as const;
