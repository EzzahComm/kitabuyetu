import { createLucideIcon } from 'lucide-react';

// Paths from Tabler Icons (MIT): the installed lucide-react ships neither logo.
export const XLogo = createLucideIcon('XLogo', [
  ['path', { d: 'M4 4l11.733 16h4.267l-11.733 -16l-4.267 0', key: 'x-body' }],
  ['path', { d: 'M4 20l6.768 -6.768m2.46 -2.46l6.772 -6.772', key: 'x-stroke' }],
]);

export const WhatsAppLogo = createLucideIcon('WhatsAppLogo', [
  ['path', { d: 'M3 21l1.65 -3.8a9 9 0 1 1 3.4 2.9l-5.05 .9', key: 'wa-bubble' }],
  [
    'path',
    {
      d: 'M9 10a.5 .5 0 0 0 1 0v-1a.5 .5 0 0 0 -1 0v1a5 5 0 0 0 5 5h1a.5 .5 0 0 0 0 -1h-1a.5 .5 0 0 0 0 1',
      key: 'wa-handset',
    },
  ],
]);
