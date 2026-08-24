import Link from 'next/link';
import { ArrowRight, BookOpenCheck, Smartphone, UserRound } from 'lucide-react';
import { PLAN_MONTHLY_FEES } from '@/types/enums';
import { Container, LedgerRules } from './primitives';
import { DashboardMockup, MemberPhoneMockup } from './product-mockups';
import { ROUTES, SECTION_IDS } from './routes';

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

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden bg-brand-blue-900 pb-20 pt-28 text-white md:pb-28 md:pt-36 lg:pb-32">
      <LedgerRules className="text-white" />
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

      <Container>
        <div className="grid items-center gap-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.02fr)] lg:gap-12 xl:gap-20">
          <div>
            <p className="inline-flex items-center gap-2.5 rounded-full border border-brand-500/25 bg-brand-500/10 px-4 py-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.2em] text-brand-300">
              <span className="h-1.5 w-1.5 rounded-full bg-brand-400" />
              For chamas, SACCOs and welfare groups
            </p>

            <h1 className="mt-7 font-display text-[2.875rem] font-light leading-[1.02] tracking-tight sm:text-6xl lg:text-[4.5rem]">
              Simple books.
              <br />
              <em className="italic font-normal text-brand-400">Stronger groups.</em>
            </h1>

            <p className="mt-7 max-w-xl text-lg leading-relaxed text-brand-blue-100/75 sm:text-xl">
              Kitabu Yetu gives your group one simple, secure way to manage savings,
              loans, members and money — so the book keeps itself and everybody can
              see where things stand.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                href={ROUTES.startGroup}
                className="group inline-flex items-center justify-center gap-2 rounded-md bg-brand-500 px-7 py-3.5 text-base font-semibold text-white shadow-lg shadow-brand-900/30 transition-colors hover:bg-brand-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2 focus-visible:ring-offset-brand-blue-900"
              >
                Start your group
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
              <Link
                href={`#${SECTION_IDS.howItWorks}`}
                className="inline-flex items-center justify-center rounded-md border border-white/20 px-7 py-3.5 text-base font-medium text-white/90 transition-colors hover:border-white/35 hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2 focus-visible:ring-offset-brand-blue-900"
              >
                See how it works
              </Link>
            </div>

            <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.16em] text-white/40">
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

          {/* Product. Stacked composition on large screens; a single clean
              window on small ones, where an overlapping phone would only
              crowd an already-narrow column. */}
          <div className="relative motion-safe:animate-fade-up" style={{ animationDelay: '120ms' }}>
            <DashboardMockup className="lg:ml-8" />
            <MemberPhoneMockup className="absolute -bottom-14 -left-6 hidden xl:block" />
          </div>
        </div>
      </Container>
    </section>
  );
}

export default Hero;
