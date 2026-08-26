import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Container, RevealedHeading, Section } from './primitives';
import { Reveal } from './reveal';
import { MEMBER_BENEFITS } from './content';
import { ROUTES } from './routes';

/**
 * Section 12 — what an ordinary member gets, as distinct from what the
 * officers running the group get.
 *
 * Every card maps to a screen in the `app/(member)/me` portal, which is what
 * ROUTES.memberApp points at. The section exists because the rest of the page
 * sells to whoever signs up — a chairperson or treasurer — while the people
 * who most often ask "how much have I saved?" never see that pitch.
 */
export function MemberExperience() {
  return (
    <Section tone="paper" labelledBy="members-heading">
      <Container>
        <div className="grid gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-20">
          <div className="lg:sticky lg:top-28 lg:self-start">
            <RevealedHeading
              id="members-heading"
              eyebrow="For members"
              title="Nobody should have to ask"
              emphasis="“how much have I saved?”"
              lede="Every member signs in to their own passbook and sees their own record — without waiting for the next meeting, and without anyone reading figures out loud."
              className="max-w-none"
            />

            <Reveal>
              <Link
                href={ROUTES.memberApp}
                className="group mt-8 inline-flex items-center gap-2 rounded-sm text-[0.9375rem] font-semibold text-brand-orange-700 transition-colors hover:text-brand-orange-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-orange-500 focus-visible:ring-offset-2"
              >
                See the member portal
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
            </Reveal>
          </div>

          <ul className="grid gap-x-10 sm:grid-cols-2">
            {MEMBER_BENEFITS.map((benefit, i) => (
              <Reveal
                as="li"
                key={benefit.title}
                delay={i * 55}
                className="border-t border-brand-blue-900/12 py-7 first:border-t-0 first:pt-0 sm:[&:nth-child(2)]:border-t-0 sm:[&:nth-child(2)]:pt-0"
              >
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-brand-orange-500/10">
                  <benefit.icon aria-hidden="true" className="h-4 w-4 text-brand-orange-700" />
                </span>
                <h3 className="mt-4 text-base font-semibold text-brand-blue-900">
                  {benefit.title}
                </h3>
                <p className="mt-2 text-[0.9375rem] leading-relaxed text-brand-blue-900/60">
                  {benefit.body}
                </p>
              </Reveal>
            ))}
          </ul>
        </div>
      </Container>
    </Section>
  );
}

export default MemberExperience;
