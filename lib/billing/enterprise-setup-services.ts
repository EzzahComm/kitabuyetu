const formatKes = (amount: number) => `KES ${amount.toLocaleString('en-KE')}`;

export const ENTERPRISE_SETUP_SERVICES = [
  {
    name: 'Website development',
    price: `${formatKes(25_000)} one-time`,
    description:
      'Up to five pages using your supplied content and branding, with a mobile layout, contact form and a link to Kitabu Yetu registration. The site is hosted separately.',
  },
  {
    name: 'SMS sender ID registration',
    price: `${formatKes(13_000)} per sender ID`,
    description:
      'Application preparation, submission and coordination with the SMS provider. Activation requires provider approval. SMS credits are billed separately.',
  },
  {
    name: 'Assisted onboarding',
    price: `${formatKes(10_000)} one-time`,
    description: 'Help setting up your workspace, preparing branded invitation copy and testing the signup links.',
  },
  {
    name: 'Managed website hosting and maintenance',
    price: `From ${formatKes(3_000)} / month`,
    description: 'Hosting, backups, updates and minor edits within the agreed scope.',
  },
  {
    name: 'Domain purchase or renewal',
    price: 'Registrar cost',
    description: 'For new domains and renewals. An existing domain can normally be used for a subdomain.',
  },
  {
    name: 'Custom API integration',
    price: `From ${formatKes(25_000)} one-time`,
    description:
      'Scope a connection between Kitabu Yetu and one external system, such as a CRM or programme management platform.',
  },
  {
    name: 'Custom M-Pesa PayBill integration and automation',
    price: `${formatKes(25_000)} one-time per integration`,
    description:
      'Configure your approved PayBill and agree how payment notifications, matching and reconciliation will work. Safaricom charges are separate.',
  },
  {
    name: 'Bank integration and automation',
    price: `${formatKes(100_000)} one-time per integration`,
    description:
      'Implement and test an agreed workflow for one bank connection. Supported actions depend on the bank’s APIs, approvals and credentials. Bank charges are separate.',
  },
] as const;
