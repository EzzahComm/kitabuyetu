'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';

export default function Home() {
  const t = useTranslations('app');

  return (
    <main className="min-h-screen p-4">
      <header className="text-center py-12">
        <h1 className="text-4xl font-bold">{t('title')}</h1>
        <p className="text-gray-600 mt-2">{t('description')}</p>
      </header>

      <nav className="flex gap-6 justify-center mt-8">
        <Link href="/tree" className="px-4 py-2 bg-blue-500 text-white rounded">
          {useTranslations('nav')('tree')}
        </Link>
        <Link href="/me" className="px-4 py-2 bg-blue-500 text-white rounded">
          {useTranslations('nav')('me')}
        </Link>
      </nav>
    </main>
  );
}
