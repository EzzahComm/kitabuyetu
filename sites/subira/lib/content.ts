import hero from '../public/images/hero-one.jpg';
import focus from '../public/images/benefit-one.jpg';
import programs from '../public/images/benefit-two.jpg';

export type NavLink = { label: string; href: string; description?: string };
export type NavGroup = { label: string; items: NavLink[] };
type NavItem = NavLink | NavGroup;

export const ROUTES = {
  home: '/',
  donate: '/#donate',
  signIn: 'https://kitabuyetu.co.ke/enterprise/login',
};

export const isNavGroup = (item: NavItem): item is NavGroup => 'items' in item;

export const ABOUT_ITEMS: NavLink[] = [
  { label: 'Who We Are', href: '/#about' },
  { label: 'Mission, Vision & Values', href: '/#mission-vision' },
  { label: 'Our Team', href: '/#team' },
  { label: 'Our Approach', href: '/#approach' },
  { label: 'Impact', href: '/#impact' },
  { label: 'Careers', href: '/#careers' },
];

export const NAV_ITEMS: NavItem[] = [
  { label: 'About', items: ABOUT_ITEMS },
  { label: 'Focus Areas', items: [{ label: 'Focus Areas Overview', href: '/#focus-areas' }] },
  { label: 'Programs', items: [{ label: 'Programs Overview', href: '/#programs' }] },
  { label: 'Media/Gallery', href: '/#media-gallery' },
  { label: 'Contact', href: '/#contact' },
];

export const FOOTER_COLUMNS: NavGroup[] = [
  { label: 'About', items: ABOUT_ITEMS },
  {
    label: 'Explore',
    items: [
      { label: 'Focus Areas', href: '/#focus-areas' },
      { label: 'Programs', href: '/#programs' },
      { label: 'Media/Gallery', href: '/#media-gallery' },
    ],
  },
  {
    label: 'Get involved',
    items: [
      { label: 'Contact', href: '/#contact' },
      { label: 'Donate', href: ROUTES.donate },
      { label: 'Staff sign in', href: ROUTES.signIn },
    ],
  },
];

export const SLIDES = [
  {
    id: 'welcome',
    product: 'Subira International',
    title: 'Welcome to Subira International',
    photo: { src: hero, alt: '', position: 'center' },
    cta: { label: 'About Subira', href: '/#about' },
  },
  {
    id: 'focus',
    product: 'Focus Areas',
    title: 'Explore our focus areas',
    photo: { src: focus, alt: '', position: 'center' },
    cta: { label: 'Focus Areas', href: '/#focus-areas' },
  },
  {
    id: 'programs',
    product: 'Programs',
    title: 'Explore our programs',
    photo: { src: programs, alt: '', position: 'center' },
    cta: { label: 'Programs', href: '/#programs' },
  },
];

export const HOME_SECTIONS = [
  { id: 'focus-areas', title: 'Focus Areas', description: 'Details will be available at launch.' },
  { id: 'programs', title: 'Programs', description: 'Program information will be available at launch.' },
  { id: 'media-gallery', title: 'Media/Gallery', description: 'Photos and updates will be available at launch.' },
  { id: 'contact', title: 'Contact', description: 'Contact details will be available at launch.' },
  { id: 'donate', title: 'Donate', description: 'Online donations are coming soon.' },
];
