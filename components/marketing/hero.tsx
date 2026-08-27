import Link from 'next/link';
import { ArrowRight, BookOpenCheck, Check, Smartphone, UserRound } from 'lucide-react';
import { PLAN_MONTHLY_FEES } from '@/types/enums';
import { Container, LedgerRules } from './primitives';
import { PaymentMockup, SharesMockup } from './product-mockups';
import { AUDIENCES, type AudiencePanel } from './content';
import { ROUTES } from './routes';

/**
 * The cheapest real entry price for the product this hero is selling, read
 * from the fee table the M-Pesa callback validates a payment against — never
 * typed as a literal on a marketing surface.
 *
 * Deliberately Kitabu Yetu's Starter and NOT the platform-wide minimum: Chama
 * Reminder starts lower, and quoting its price under a headline about keeping
 * the books would advertise a cheaper plan than the one being described.
 * Chama Reminder is priced in its own right further down the page.
 */
const FROM_PRICE = PLAN_MONTHLY_FEES.kitabu_yetu.starter;

const PROOF = [
  { icon: Smartphone,    label: 'M-Pesa STK & PayBill' },
  { icon: BookOpenCheck, label: 'Double-entry ledger' },
  { icon: UserRound,     label: 'A passbook per member' },
];

/**
 * The two-audience panels replace the earlier plan to build these around
 * licensed photography (see docs/audits/HERO_BRIEF_CLAIM_AUDIT_2026-08.md
 * §1.5) — no photograph has ever been committed to this repo, and sourcing
 * one is a procurement step, not an engineering one. These reuse the same
 * component-drawn mockups the rest of the page already relies on so the
 * hero ships honest today; swap in a photo per panel once one is licensed.
 */
function Visual({ kind }: { kind: AudiencePanel['visual'] }) {
  switch (kind) {
    case 'payment': return <PaymentMockup />;
    case 'shares':  return <SharesMockup />;
  }
}

function Panel({ audience, delay }: { audience: AudiencePanel; delay: number }) {
  return (
    <div>
      <p className="font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-brand-400">
        {audience.eyebrow}
      </p>

      <h2 className="mt-4 font-display text-2xl font-light leading-[1.1] tracking-tight text-white sm:text-[1.75rem]">
        {audience.title}{' '}
        <em className="italic font-normal text-brand-400">{audience.emphasis}</em>
      </h2>

      <p className="mt-4 text-[0.9375rem] leading-relaxed text-brand-blue-100/70">
        {audience.body}
      </p>

      <ul className="mt-6 space-y-2.5">
        {audience.points.map((point) => (
          <li key={point} className="flex items-start gap-2.5">
            <Check aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-400" />
            <span className="text-[0.8125rem] leading-relaxed text-brand-blue-100/65">
              {point}
            </span>
          </li>
        ))}
      </ul>

      <Link
        href={audience.href}
        className="group mt-6 inline-flex items-center gap-2 rounded-sm text-[0.875rem] font-semibold text-brand-400 transition-colors hover:text-brand-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2 focus-visible:ring-offset-brand-blue-900"
      >
        {audience.linkText}
        <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
      </Link>

      <div
        className="relative mt-8 motion-safe:animate-fade-up"
        style={{ animationDelay: `${delay}ms` }}
      >
        <Visual kind={audience.visual} />
      </div>
    </div>
  );
}

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden bg-brand-blue-900 pb-16 pt-24 text-white md:pb-24 md:pt-32">
      <LedgerRules className="text-white/80" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-px bg-brand-400/80" />
      <div aria-hidden="true" className="pointer-events-none absolute right-[8%] top-28 -z-10 hidden select-none font-display text-[15rem] leading-none text-white/[0.035] lg:block">K</div>
      {/* One warm light source, low and left — not a four-way gradient mesh. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-40 top-0 -z-10 h-[620px] w-[620px] rounded-full bg-brand-500/12 blur-[130px]"
      />
      {/* The ledger's margin rule. */}
      <div
        aria-hidden="true"
        className="absolute inset-y-0 left-[6.5%] -z-10 hidden w-px bg-brand-500/20 lg:block"
      />

      <div aria-label="Kitabu Yetu capabilities" className="mb-12 flex overflow-hidden border-y border-white/10 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-white/45">
        <div className="flex min-w-max animate-[ticker_24s_linear_infinite] gap-8">
          <span>Savings</span><span aria-hidden="true" className="text-brand-400">/</span><span>Loans</span><span aria-hidden="true" className="text-brand-400">/</span><span>Welfare</span><span aria-hidden="true" className="text-brand-400">/</span><span>M-Pesa ready</span><span aria-hidden="true" className="text-brand-400">/</span><span>Member passbooks</span><span aria-hidden="true" className="text-brand-400">/</span><span>Double-entry books</span><span aria-hidden="true" className="text-brand-400">/</span>
        </div>
      </div>

      <Container>
        <div className="max-w-5xl">
          <div className="flex items-center gap-3 font-mono text-[10.5px] font-medium uppercase tracking-[0.2em] text-brand-300">
            <span className="h-2 w-2 rounded-full bg-brand-400 shadow-[0_0_14px_hsl(var(--brand-green))]" />
            Digital tools for vibrant communities
            <span aria-hidden="true" className="hidden h-px w-20 bg-brand-400/40 sm:block" />
            Kenya · East Africa
          </div>

          <h1 className="mt-8 max-w-4xl font-display text-[3.5rem] font-light leading-[0.92] tracking-[-0.04em] sm:text-7xl lg:text-[7.2rem]">
            Your group&apos;s money.
            <br />
            <em className="italic font-normal text-brand-400">Finally clear.</em>
          </h1>

          <p className="mt-7 max-w-xl text-lg leading-relaxed text-brand-blue-100/75 sm:text-xl">
            Simple digital tools for community groups — from organizations taking their
            first step into digitization to modern chamas already using technology to
            work smarter. One simple, secure way to manage savings, loans, members and
            money, so the book keeps itself and everybody can see where things stand.
          </p>

          <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Link
              href={ROUTES.startGroup}
              className="group inline-flex items-center justify-center gap-2 rounded-md bg-brand-500 px-7 py-3.5 text-base font-semibold text-white shadow-lg shadow-brand-900/30 transition-colors hover:bg-brand-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2 focus-visible:ring-offset-brand-blue-900"
            >
              Get started
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
            <Link
              href={ROUTES.enterprise}
              className="inline-flex items-center justify-center rounded-md border border-white/20 px-7 py-3.5 text-base font-medium text-white/90 transition-colors hover:border-white/35 hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2 focus-visible:ring-offset-brand-blue-900"
            >
              Explore Enterprise
            </Link>
          </div>

          <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.16em] text-white/60">
            Pay by M-Pesa · plans from KES {FROM_PRICE.toLocaleString()}/month
          </p>

          <ul className="mt-10 flex flex-wrap gap-x-7 gap-y-3 border-t border-white/10 pt-7">
            {PROOF.map((item) => (
              <li key={item.label} className="flex items-center gap-2 text-brand-blue-100/65">
                <item.icon aria-hidden="true" className="h-4 w-4 text-brand-400" />
                <span className="font-mono text-[11px] uppercase tracking-[0.12em]">
                  {item.label}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Two audiences, each led by a capability that actually ships — see
            AUDIENCES in content.ts for what replaced the brief's original
            "project tracking" / "investment tracking" anchors and why. */}
        <div className="mt-16 grid gap-14 border-t border-white/10 pt-14 sm:grid-cols-2 sm:gap-10 lg:gap-16">
          {AUDIENCES.map((audience, i) => (
            <Panel key={audience.eyebrow} audience={audience} delay={i * 90} />
          ))}
        </div>
      </Container>
    </section>
  );
}

export default Hero;
