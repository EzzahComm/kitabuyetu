import { ShieldCheck, Smartphone, Zap } from 'lucide-react';
import { PLAN_MONTHLY_FEES } from '@/types/enums';
import { Container } from './primitives';
import { AmbientGlow, PillLink } from './astrolus';
import { PaymentMockup } from './product-mockups';
import { ROUTES } from './routes';

/**
 * The cheapest real entry price for the product this hero is selling, read
 * from the fee table the M-Pesa callback validates a payment against — never
 * typed as a literal on a marketing surface.
 *
 * Deliberately Kitabu Yetu's Starter and NOT the platform-wide minimum: Chama
 * Reminder starts lower, and quoting its price under a headline about keeping
 * the books would advertise a cheaper plan than the one being described.
 */
const FROM_PRICE = PLAN_MONTHLY_FEES.kitabu_yetu.starter;

const TRUST = [
  { icon: Zap,         label: 'Simple to start' },
  { icon: Smartphone,  label: 'Real-time visibility' },
  { icon: ShieldCheck, label: 'Secure role-based access' },
];

/**
 * Hero, recomposed on Astrolus's centred arrangement: ambient glow, one large
 * sans headline with a single coloured phrase, two pill actions, a trust row,
 * and the product visual sitting under the fold-line rather than beside it.
 *
 * The move from our earlier left-aligned serif hero is deliberate — Astrolus
 * centres everything above the product shot, which is what makes the visual
 * read as the subject rather than as decoration next to the copy.
 *
 * "Vibrant Communities" is set in M-Pesa green, which is also the brand green
 * (`#3CB043` ≈ Safaricom's), so the highlight and the payment states share one
 * colour rather than introducing a second.
 */
export function Hero() {
  return (
    <section className="relative isolate overflow-hidden bg-paper pb-20 pt-32 md:pb-24 md:pt-40">
      <AmbientGlow />

      <Container>
        <div className="mx-auto max-w-3xl text-center">
          <p className="inline-flex items-center gap-2.5 rounded-full border border-brand-500/20 bg-brand-500/10 px-4 py-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.2em] text-brand-800">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
            Digital tools for vibrant groups and organizations
          </p>

          <h1 className="mt-8 text-balance text-4xl font-bold leading-[1.05] tracking-tight text-brand-blue-900 sm:text-6xl lg:text-[4.25rem]">
            Simple tools. Stronger groups.
            <br />
            <span className="text-brand-600">Vibrant communities.</span>
          </h1>

          <p className="mx-auto mt-8 max-w-2xl text-lg leading-relaxed text-brand-blue-900/70">
            Kitabu Yetu gives chamas, welfare groups, SACCOs, investment clubs, faith-based
            groups and community organizations one simple place to manage members, savings,
            loans, payments and records.
          </p>

          <p className="mx-auto mt-4 max-w-2xl text-[1.0625rem] leading-relaxed text-brand-blue-900/60">
            And for organizations managing multiple groups, Enterprise provides one
            connected view across the groups you support.
          </p>

          <div className="mt-12 flex flex-wrap justify-center gap-4">
            <PillLink href={ROUTES.startGroup} variant="solid" withArrow>
              Get started
            </PillLink>
            <PillLink href={ROUTES.enterprise} variant="soft">
              Explore Enterprise
            </PillLink>
          </div>

          <ul className="mt-10 flex flex-wrap items-center justify-center gap-x-7 gap-y-3">
            {TRUST.map((item) => (
              <li key={item.label} className="flex items-center gap-2 text-brand-blue-900/60">
                <item.icon aria-hidden="true" className="h-4 w-4 text-brand-600" />
                <span className="text-sm font-medium">{item.label}</span>
              </li>
            ))}
          </ul>

          <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.16em] text-brand-blue-900/45">
            Pay by M-Pesa · plans from KES {FROM_PRICE.toLocaleString()}/month
          </p>
        </div>

        {/* The product shot, centred under the copy. This is the outcome a
            payer actually sees — the technical path it took is explained much
            further down, in the payments section. */}
        <div className="mx-auto mt-16 max-w-2xl motion-safe:animate-fade-up lg:mt-20">
          <PaymentMockup />
        </div>
      </Container>
    </section>
  );
}

export default Hero;
