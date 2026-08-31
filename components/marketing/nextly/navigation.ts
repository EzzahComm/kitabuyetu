export interface NavItem {
  name: string;
  href: string;
}

export const navigation: NavItem[] = [
  { name: "Home", href: "/" },
  { name: "About", href: "/about" },
  { name: "Products", href: "/products" },
  { name: "Enterprise", href: "/enterprise" },
  { name: "How it works", href: "/how-it-works" },
  { name: "Pricing", href: "/pricing" },
  { name: "Contact", href: "/contact" },
];

export const products: NavItem[] = [
  { name: "Bookkeeper", href: "/products/bookkeeper" },
  { name: "Chama Reminder", href: "/products/chama-reminder" },
  { name: "Fundraise / Changi$ha", href: "/products/fundraise" },
  { name: "Enterprise", href: "/enterprise" },
];

export const ecosystem: NavItem[] = [
  { name: "Donors", href: "/ecosystem/donors" },
  { name: "Multigroup Organizations", href: "/ecosystem/multigroup" },
  { name: "Marketplace", href: "/ecosystem/marketplace" },
  { name: "Programs", href: "/ecosystem/programs" },
];

export const company: NavItem[] = [
  { name: "Our Story", href: "/about" },
  { name: "Team", href: "/team" },
  { name: "Impact", href: "/impact" },
  { name: "How it works", href: "/how-it-works" },
  { name: "Pricing", href: "/pricing" },
  { name: "Contact", href: "/contact" },
];

export const legal: NavItem[] = [
  { name: "Terms & Conditions", href: "/terms" },
  { name: "Privacy Policy", href: "/privacy" },
  { name: "Data Protection", href: "/data-protection" },
];
