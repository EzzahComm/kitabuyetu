import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Container, RevealedHeading, Section } from './primitives';
import { Reveal } from './reveal';
import { PRODUCT_PILLARS } from './content';
import { ROUTES } from './routes';

/**
 * Section — product overview. Four cards naming the product family, each
 * carrying the status PRODUCT_PILLARS declares, which is the same status the
 * /products page and the header dropdown read.
 *
 * BOTH states are labelled, not just `vision`. Leaving `live` unmarked meant
 * availability was communicated by the ABSENCE of a badge, which is not
 * something a visitor can read — three shipped products looked like they had
 * no status at all next to one marked "Coming soon". Bookkeeper, Chama
 * Reminder and Enterprise are available today; only Fundraise/Changi$ha is not.
 *
 * "Coming soon" keeps the orange it has always had — orange is this palette's
 * not-yet/attention accent, not its brand colour — while "Available now" is
 * green, so the eye lands on what a visitor can actually buy.
 */
export function ProductPillarsSection() {
  return (
    <Section tone="paper" labelledBy="products-heading">
      <Container>
        <RevealedHeading
          id="products-heading"
          eyebrow="The product family"
          title="Four products,"
          emphasis="one platform."
          lede={
            <>
              From the core ledger to the wider ecosystem it connects to. See the full{' '}
              <Link href={ROUTES.products} className="font-medium text-brand-700 hover:underline">
                product overview
              </Link>.
            </>
          }
        />

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PRODUCT_PILLARS.map((product, i) => (
            <Reveal key={product.title} delay={i * 80}>
              <Link
                href={product.href}
                className="group flex h-full flex-col rounded-xl border border-brand-blue-900/10 bg-paper-deep p-6 transition-colors hover:border-brand-500/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <product.icon aria-hidden="true" className="h-6 w-6 text-brand-600" />
                  {product.status === 'vision' ? (
                    <span className="shrink-0 rounded-full bg-brand-orange-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-orange-700">
                      Coming soon
                    </span>
                  ) : (
                    <span className="shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-700">
                      Available now
                    </span>
                  )}
                </div>
                <h3 className="mt-4 font-display text-lg font-normal text-brand-blue-900">{product.title}</h3>
                <p className="mt-2 flex-1 text-[0.875rem] leading-relaxed text-brand-blue-900/60">{product.body}</p>
                <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-700">
                  {product.linkText}
                  <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
      </Container>
    </Section>
  );
}

export default ProductPillarsSection;
