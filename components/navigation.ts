export interface NavItem {
  name: string;
  href: string;
  /** Sub-items. Each one is a section on the parent's page, linked by anchor. */
  children?: NavItem[];
}

export const navigation: NavItem[] = [
  { name: "Home", href: "/" },
  {
    name: "About",
    href: "/about",
    children: [
      { name: "Our Story", href: "/about#our-story" },
      { name: "Team", href: "/about#team" },
      { name: "Impact", href: "/about#impact" },
    ],
  },
  {
    name: "Products",
    href: "/products",
    children: [
      { name: "Bookkeeper", href: "/bookkeeper" },
      { name: "Chama Reminder", href: "/chama-reminder" },
      { name: "Fundraise", href: "/fundraise" },
      { name: "Enterprise", href: "/enterprise" },
    ],
  },
  {
    name: "Ecosystem",
    href: "/ecosystem",
    children: [
      { name: "Donors", href: "/ecosystem#donors" },
      { name: "Multigroup Organizations", href: "/ecosystem#multigroup" },
      { name: "Marketplace", href: "/ecosystem#marketplace" },
      { name: "Programs", href: "/ecosystem#programs" },
    ],
  },
  { name: "How it works", href: "/how-it-works" },
  {
    name: "Pricing",
    href: "/pricing",
    children: [
      { name: "Kitabu Yetu", href: "/pricing#kitabu-yetu" },
      { name: "Chama Reminder", href: "/pricing#chama-reminder" },
    ],
  },
  { name: "Contact", href: "/contact" },
];

export const products: NavItem[] = [
  { name: "Bookkeeper", href: "/products#bookkeeper" },
  { name: "Chama Reminder", href: "/products#chama-reminder" },
  { name: "Fundraise / Changi$ha", href: "/products#fundraise" },
  { name: "Enterprise", href: "/products#enterprise" },
];

export const ecosystem: NavItem[] = [
  { name: "Donors", href: "/ecosystem#donors" },
  { name: "Multigroup Organizations", href: "/ecosystem#multigroup" },
  { name: "Marketplace", href: "/ecosystem#marketplace" },
  { name: "Programs", href: "/ecosystem#programs" },
];

export const company: NavItem[] = [
  { name: "Our Story", href: "/about#our-story" },
  { name: "Team", href: "/about#team" },
  { name: "Impact", href: "/about#impact" },
  { name: "Careers", href: "/careers" },
  { name: "How it works", href: "/how-it-works" },
  { name: "Pricing", href: "/pricing" },
  { name: "Contact", href: "/contact" },
];

export const legal: NavItem[] = [
  { name: "Terms & Conditions", href: "/legal#terms" },
  { name: "Privacy Policy", href: "/legal#privacy" },
  { name: "Data Protection", href: "/legal#data-protection" },
];
