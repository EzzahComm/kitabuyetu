import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/marketing/page-shell';
import { marketingMetadata } from '@/components/marketing/page-metadata';
import { ROUTES } from '@/components/marketing/routes';
import { CallbackSection } from '@/components/marketing/sections/cta';
import { ProductTabsSection } from '@/components/marketing/sections/products';

export const metadata: Metadata = marketingMetadata({
  path: '/products',
  title: 'Chama, SMS & Fundraising Tools for Groups',
  description:
    'Bookkeeper for chama records, Chama Reminder for bulk SMS, Changi$ha for community fundraising and Enterprise for institutions: the Kitabu Yetu family.',
});

/** The Finanza service.html layout: product tabs, then the call-back form. */
export default function ProductsPage() {
  return (
    <PageShell
      title="Products"
      description="Four products, one platform — from the core ledger to the wider ecosystem it connects to."
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
