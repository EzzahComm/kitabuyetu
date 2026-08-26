import { AlertCircle, Banknote, Send } from 'lucide-react';
import { Container, LedgerRules, RevealedHeading, Section } from './primitives';
import { Reveal } from './reveal';
import { PAYMENT_FLOW } from './content';
import { SECTION_IDS } from './routes';

/**
 * Section 9 — payments, the differentiator.
 *
 * The two panels at the bottom are the point of this section as much as the
 * flow is. "Automatic reconciliation" is a claim a marketing page can make
 * cheaply and a payments system can only half keep, so the limits are stated
 * here rather than discovered later:
 *
 *   • A PayBill payment with no usable reference is NOT guessed at. It goes to
 *     the unrouted queue (mpesa-unrouted.service.ts) and waits for a human —
 *     the group dashboard surfaces the count as a task.
 *   • Cash is still cash. It is recorded by hand and posts to the same ledger;
 *     nothing here pretends every group is cashless.
 */
export function MpesaSection() {
  return (
    <Section id={SECTION_IDS.payments} tone="ink" labelledBy="payments-heading">
      <LedgerRules className="text-white" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-32 top-1/4 -z-10 h-[480px] w-[480px] rounded-full bg-brand-orange-500/10 blur-[120px]"
      />

      <Container>
        <RevealedHeading
          id="payments-heading"
          tone="dark"
          eyebrow="Payments"
          title="From M-Pesa to your books,"
          emphasis="in one motion"
          trailing="."
          lede="The payment and the record of the payment are the same event. Nobody retypes anything, and nobody reconciles a statement the night before the meeting."
        />

        <ol className="mt-14 grid gap-px overflow-hidden rounded-2xl bg-white/10 ring-1 ring-white/10 sm:grid-cols-2 lg:mt-20 lg:grid-cols-3">
          {PAYMENT_FLOW.map((step, i) => (
            <Reveal
              as="li"
              key={step.label}
              delay={i * 60}
              className="bg-brand-blue-900 p-7 lg:p-8"
            >
              <span className="font-mono text-[11px] font-medium tabular-nums tracking-[0.2em] text-brand-orange-400/70">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className="mt-4 text-lg font-semibold text-white">{step.label}</h3>
              <p className="mt-2.5 text-[0.9375rem] leading-relaxed text-brand-blue-100/75">
                {step.body}
              </p>
            </Reveal>
          ))}
        </ol>

        <div className="mt-5 grid gap-5 lg:grid-cols-3">
          <Reveal className="rounded-2xl border border-brand-orange-500/25 bg-brand-orange-500/[0.07] p-7 lg:col-span-2">
            <span className="inline-flex items-center gap-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-brand-orange-300">
              <AlertCircle aria-hidden="true" className="h-4 w-4" />
              What it will not do
            </span>
            <p className="mt-4 text-base leading-relaxed text-white/85">
              <strong className="font-semibold text-white">It never guesses.</strong>{' '}
              A PayBill payment that arrives without a usable reference is not attached
              to whoever seems likely — it waits in an unrouted queue, and your dashboard
              shows it as a task until someone assigns it. A payment in the wrong
              member&apos;s account is a far worse problem than a payment in a queue.
            </p>
          </Reveal>

          <Reveal delay={70} className="rounded-2xl border border-white/10 bg-white/[0.04] p-7">
            <span className="inline-flex items-center gap-2.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.18em] text-brand-orange-400">
              <Banknote aria-hidden="true" className="h-4 w-4" />
              Cash still counts
            </span>
            <p className="mt-4 text-[0.9375rem] leading-relaxed text-brand-blue-100/70">
              Not every group is cashless. Contributions taken in cash at the meeting are
              recorded by hand and post to exactly the same ledger.
            </p>
          </Reveal>
        </div>

        <Reveal
          delay={60}
          className="mt-5 flex flex-col gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-7 sm:flex-row sm:items-center"
        >
          <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-orange-500/15 ring-1 ring-brand-orange-500/25">
            <Send aria-hidden="true" className="h-5 w-5 text-brand-orange-400" />
          </span>
          <p className="text-[0.9375rem] leading-relaxed text-brand-blue-100/75">
            <strong className="font-semibold text-white">Money goes out the same way.</strong>{' '}
            Loan disbursements, welfare payouts and dividends are sent to a member&apos;s
            phone by B2C — approved first, posted to the ledger with Safaricom&apos;s
            transaction fee, and confirmed to the member.
          </p>
        </Reveal>
      </Container>
    </Section>
  );
}

export default MpesaSection;
