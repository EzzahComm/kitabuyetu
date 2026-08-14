import Link from 'next/link';
import { Check } from 'lucide-react';
import { PLAN_MONTHLY_FEES, PLAN_COPY, SELF_SERVE_PLANS } from '@/types/enums';

/**
 * No local price/feature data — everything below is read from the same
 * source of truth the billing page and the M-Pesa callback use
 * (`types/enums.ts`). This used to be a static, hand-maintained array that
 * advertised a free tier and prices (2,500 / 8,000) that disagreed with what
 * the server actually charges — see
 * docs/audits/PRODUCT_CONCORDANCE_AUDIT_2026-08.md §1.1. A server component
 * importing the real constants directly, rather than a client-side fetch, is
 * what keeps this page correct with zero new public API surface: it re-reads
 * the same module the app itself prices against on every render.
 */
const PRODUCT = 'kitabu_yetu' as const;

export default function PricingPage() {
  const plans = PLAN_COPY[PRODUCT];

  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b px-6 py-4 flex items-center justify-between max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span className="font-bold">Kitabu Yetu</span>
        </div>
        <div className="flex gap-3">
          <Link href="/login" className="inline-flex items-center justify-center rounded-md text-sm font-medium h-9 px-4 hover:bg-accent hover:text-accent-foreground transition-colors">
            Sign in
          </Link>
          <Link href="/register" className="inline-flex items-center justify-center rounded-md text-sm font-medium h-9 px-4 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
            Get started
          </Link>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4">Simple, transparent pricing</h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Pay only for what your group needs. Every plan includes full double-entry accounting
            and M-Pesa integration — the price you see is the price you pay.
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-4">
          {plans.map((plan) => {
            const isSelfServe = SELF_SERVE_PLANS.includes(plan.type);
            const fee = PLAN_MONTHLY_FEES[PRODUCT][plan.type];
            return (
              <div
                key={plan.type}
                className={`relative flex flex-col rounded-lg border bg-card text-card-foreground shadow-sm ${plan.type === 'growth' ? 'ring-2 ring-brand-500 shadow-lg' : ''}`}
              >
                {plan.type === 'growth' && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-brand-500 text-white text-sm font-semibold px-4 py-1 rounded-full">
                    Most popular
                  </div>
                )}
                <div className="flex flex-col space-y-1.5 p-6 pb-2">
                  <h3 className="text-xl font-semibold leading-none tracking-tight">{plan.label}</h3>
                  <div className="mt-3">
                    {isSelfServe ? (
                      <>
                        <span className="text-4xl font-bold">KES {fee.toLocaleString()}</span>
                        <span className="text-muted-foreground">/month</span>
                      </>
                    ) : (
                      <span className="text-4xl font-bold">Custom pricing</span>
                    )}
                  </div>
                </div>
                <div className="flex-1 p-6 pt-0">
                  <ul className="space-y-3">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm">
                        <Check size={16} className="text-brand-500 mt-0.5 shrink-0"/>
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="p-6 pt-0">
                  <Link
                    href={isSelfServe ? '/register' : '/contact'}
                    className={`w-full inline-flex items-center justify-center rounded-md text-sm font-medium h-10 px-4 transition-colors ${
                      plan.type === 'growth'
                        ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                        : 'border border-input bg-background hover:bg-accent hover:text-accent-foreground'
                    }`}
                  >
                    {isSelfServe ? 'Get started' : 'Talk to sales'}
                  </Link>
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Looking for Chama Reminder — SMS reminders and greetings without full accounting?{' '}
          <Link href="/register?product=chama_reminder" className="font-medium text-brand-600 hover:underline">
            See Chama Reminder pricing
          </Link>.
        </p>

        <div className="mt-16 text-center">
          <h2 className="text-2xl font-bold mb-4">Frequently asked questions</h2>
          <div className="grid gap-6 md:grid-cols-2 max-w-4xl mx-auto text-left">
            {[
              ['Is M-Pesa integration included?', 'Yes, all plans include full Safaricom Daraja M-Pesa integration for STK push, C2B collections, and B2C disbursements.'],
              ['Can I import existing member data?', 'Yes — every plan supports bulk CSV import for members and historical contributions.'],
              ['How is data secured?', 'Data is stored on encrypted servers with row-level multi-tenant isolation. Each group can only see its own data.'],
              ['Can I change plans later?', "Yes — pay for a different plan any time via M-Pesa and it activates immediately. There's no lock-in period."],
            ].map(([q, a]) => (
              <div key={q} className="space-y-1">
                <p className="font-semibold text-sm">{q}</p>
                <p className="text-sm text-muted-foreground">{a}</p>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
