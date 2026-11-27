import hero from '../public/images/hero-community.webp';
import focus from '../public/images/hero-education.webp';
import programs from '../public/images/hero-programs.webp';

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

export const ABOUT = {
  introduction:
    'Subira International is a non-governmental organisation registered in Kenya and headquartered in Bungoma Town, Bungoma County.',
  mission:
    'To expand access to education, clean water and affordable healthcare, nurture youth talent, and strengthen food security through practical training and community projects.',
  vision:
    'Communities where children and young people can learn and develop their talents, and families can access essential services and build a more food-secure future.',
  values: ['Inclusion', 'Community partnership', 'Practical learning'],
  approach:
    'We combine direct support, community projects, partnerships and training. Our priorities include scholarships and learning materials, water projects in underserved areas, healthcare partnerships, youth mentorship and practical farming skills.',
  impact:
    'Between 2020 and 2022, Subira enrolled 50 girls at Bethesda Girls High School and supported their tuition, accommodation, meals, books and uniforms.',
};

export const TEAM: { role: string; name?: string }[] = [
  { role: 'Executive Director', name: 'Bsp Christine Macheusi Mbani' },
  { role: 'Head of Programs', name: 'Abel Simiyu' },
  { role: 'Director of Training & Learning', name: 'Monica Nelima' },
  { role: 'Head of SELI Program' },
  { role: 'Head of IT & Digital', name: 'Polycap Wanyonyi' },
  { role: 'Trainer, SELI Program', name: 'Christel Kamonya' },
];

export const CONTACT = {
  location: 'Bungoma Town, Bungoma County, Kenya',
  phones: ['+254 720 053 210', '+254 733 923 010'],
  emails: ['subirainternational0@gmail.com', 'krisskibali@gmail.com'],
};

type FocusArea = {
  id: string;
  title: string;
  heading: string;
  paragraphs: string[];
  link?: NavLink;
};

export const FOCUS_AREAS: FocusArea[] = [
  {
    id: 'education',
    title: 'Education',
    heading: 'Scholarships and education',
    paragraphs: [
      'Between 2020 and 2022, Subira enrolled 50 girls at Bethesda Girls High School. Its support covered tuition, accommodation, meals, books and uniforms.',
      'Subira also aims to provide learning facilities and materials for children who need them.',
    ],
  },
  {
    id: 'water-and-sanitation',
    title: 'Water & Sanitation',
    heading: 'Clean drinking water',
    paragraphs: [
      'Subira established water projects in Township and Bukembe West wards. Its project flyer reported that the Township project was operational and served more than 100,000 people per month.',
      'The flyer identified pump replacement as the priority in Bukembe West and named Sirisia and Nambale as locations for planned projects.',
    ],
  },
  {
    id: 'talent-development',
    title: 'Talent Development',
    heading: 'Music, film and mentorship',
    paragraphs: [
      'Subira identified music and film as starting points for youth talent development. The proposed youth programme would combine creative activities with wellness education, career awareness and sustained mentorship.',
    ],
    link: {
      label: 'Read the youth programme overview',
      href: 'https://bethesda.co.ke/youth-mentorship.html',
    },
  },
  {
    id: 'healthcare',
    title: 'Healthcare',
    heading: 'Access to healthcare',
    paragraphs: [
      'Subira aims to help establish health facilities and improve access to affordable care, including for people living with disabilities and other underserved groups.',
      'Its project flyer reported partnerships with eight health facilities in Kenya and medicine distribution valued at more than US$1.5 million. It cited cancer and fistula among the conditions addressed.',
    ],
  },
  {
    id: 'climate-change-and-agriculture',
    title: 'Climate Change & Agriculture',
    heading: 'Farming and food security',
    paragraphs: [
      'Subira aims to train community members in modern farming techniques and help them strengthen the management skills needed to improve food security.',
    ],
  },
];

export const NAV_ITEMS: NavItem[] = [
  { label: 'About', items: ABOUT_ITEMS },
  {
    label: 'Focus Areas',
    items: [
      { label: 'Focus Areas Overview', href: '/#focus-areas' },
      ...FOCUS_AREAS.map(({ id, title }) => ({ label: title, href: `/#${id}` })),
    ],
  },
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
  { id: 'programs', title: 'Programs', description: 'Program information will be available at launch.' },
  { id: 'media-gallery', title: 'Media/Gallery', description: 'Photos and updates will be available at launch.' },
  {
    id: 'donate',
    title: 'Donate',
    description: 'To support our programmes or make a donation, contact our Executive Director.',
  },
];
