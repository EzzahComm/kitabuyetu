import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/marketing/page-shell';
import { marketingMetadata } from '@/components/marketing/page-metadata';
import { ROUTES } from '@/components/marketing/routes';
import { CallbackSection } from '@/components/marketing/sections/cta';
import { ProductTabsSection } from '@/components/marketing/sections/products';

export const metadata: Metadata = marketingMetadata({
  path: '/products',
  title: 'Digital Tools for Community Organisations and Institutions',
  description:
    'An integrated family of digital tools for organisational finance, membership, communication, fundraising workflows and institutional programme management.',
});

/** The Finanza service.html layout: product tabs, then the call-back form. */
export default function ProductsPage() {
  return (
    <PageShell
      title="Products"
      description="A connected platform for managing organisations, strengthening accountability and supporting programme delivery."
      layout="sections"
    >
      <ProductTabsSection />
      <p className="-mt-8 mb-4 text-center text-finanza-text">
        Bookkeeper and Chama Reminder are one monthly price for the whole group, paid by M-Pesa.{' '}
        <Link href={ROUTES.pricing} className="font-medium text-brand-500 hover:text-brand-700">
          Compare plans →
        </Link>
      </p>
      <CallbackSection />
    </PageShell>
  );
}
