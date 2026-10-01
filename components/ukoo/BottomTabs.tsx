'use client';

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

export default function BottomTabs() {
  const pathname = usePathname();
  const t = useTranslations('nav');

  const tabs = [
    { href: '/tree', label: t('tree'), key: 'tree' },
    { href: '/feed', label: t('feed'), key: 'feed' },
    { href: '/stories', label: t('stories'), key: 'stories' },
    { href: '/gatherings', label: t('gatherings'), key: 'gatherings' },
    { href: '/me', label: t('me'), key: 'me' },
  ];

  const isActive = (href: string) => {
    return pathname.includes(href);
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 lg:hidden">
      <div className="flex justify-around">
        {tabs.map(tab => (
          <Link
            key={tab.key}
            href={tab.href}
            className={`flex-1 px-4 py-3 text-center text-sm font-medium ${
              isActive(tab.href)
                ? 'border-b-2 border-blue-500 text-blue-600'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
