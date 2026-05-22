import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Kitabu Yetu',
    short_name: 'Kitabu Yetu',
    description: 'Financial management platform for African community groups',
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#2563eb',
    orientation: 'portrait',
    categories: ['finance', 'business'],
    icons: [
      {
        src: '/icons/icon-72.png',
        sizes: '72x72',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-96.png',
        sizes: '96x96',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-128.png',
        sizes: '128x128',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-144.png',
        sizes: '144x144',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-152.png',
        sizes: '152x152',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-384.png',
        sizes: '384x384',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    screenshots: [
      {
        src: '/screenshots/dashboard.png',
        sizes: '1280x720',
        type: 'image/png',
      },
    ],
    shortcuts: [
      {
        name: 'Dashboard',
        short_name: 'Dashboard',
        description: 'View financial overview',
        url: '/dashboard',
        icons: [{ src: '/icons/icon-96.png', sizes: '96x96' }],
      },
      {
        name: 'Contributions',
        short_name: 'Contribute',
        description: 'Record a contribution',
        url: '/contributions',
        icons: [{ src: '/icons/icon-96.png', sizes: '96x96' }],
      },
      {
        name: 'Members',
        short_name: 'Members',
        description: 'Manage group members',
        url: '/members',
        icons: [{ src: '/icons/icon-96.png', sizes: '96x96' }],
      },
    ],
  };
}
