import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { PRODUCT_PILLARS } from '@/components/marketing/content';
import { PageShell } from '@/components/marketing/page-shell';

export const metadata: Metadata = {
  title: 'Products',
  description: 'Bookkeeper, Chama Reminder, Fundraise / Changi$ha and Enterprise — the Kitabu Yetu product family.',
};

export default function ProductsPage() {
  return (
    <PageShell
      title="Products"
      description="Four products, one platform — from the core ledger to the wider ecosystem it connects to."
    >
      <div className="not-prose grid gap-5 sm:grid-cols-2">
        {PRODUCT_PILLARS.map((product) => (
          <Link
            key={product.title}
            href={product.href}
            className="group flex flex-col rounded-lg border border-brand-blue-900/10 bg-white p-6 transition-colors hover:border-brand-orange-500/40"
          >
            <div className="flex items-center justify-between">
              <product.icon aria-hidden="true" className="h-6 w-6 text-brand-orange-600" />
              {product.status === 'vision' && (
                <span className="rounded-full bg-brand-orange-50 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-brand-orange-700">
                  Coming soon
                </span>
              )}
            </div>
            <h2 className="mt-4 font-display text-xl font-normal text-brand-blue-900">{product.title}</h2>
            <p className="mt-2 text-[0.9375rem] leading-relaxed text-brand-blue-900/65">{product.body}</p>
            <ul className="mt-4 space-y-1.5 text-sm text-brand-blue-900/60">
              {product.points.map((point) => (
                <li key={point} className="flex items-start gap-2">
                  <span aria-hidden="true" className="mt-2 h-1 w-1 shrink-0 rounded-full bg-brand-orange-500" />
                  {point}
                </li>
              ))}
            </ul>
            <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-orange-700">
              {product.linkText}
              <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
            </span>
          </Link>
        ))}
      </div>
    </PageShell>
  );
}
