import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Container, RevealedHeading, Section } from './primitives';
import { Reveal } from './reveal';
import { ROLES } from './content';

/**
 * Section 8 — one platform, every role.
 *
 * Five cards, not six: the roles here are exactly the ones the permission
 * model has (see the note in content.ts). Rather than pad the grid to a tidy
 * six, the fifth card — organizations — takes the double-width dark slot,
 * which is also true to how it works: it is the only entry here that is a
 * separate portal rather than a seat inside a group.
 */
export function RoleCards() {
  const seats = ROLES.slice(0, 4);
  const organization = ROLES[ROLES.length - 1];

  return (
    <Section tone="paper-deep" labelledBy="roles-heading">
      <Container>
        <RevealedHeading
          id="roles-heading"
          eyebrow="Built for everyone"
          title="One platform."
          emphasis="Every role"
          trailing="."
          lede="A member and a chairperson need very different things from the same book. Each signs in and sees their own."
        />

        <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:mt-20 lg:grid-cols-4">
          {seats.map((role, i) => (
            <Reveal
              key={role.title}
              delay={i * 70}
              className="flex h-full flex-col rounded-2xl bg-paper p-7 ring-1 ring-brand-blue-900/[0.08]"
            >
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-paper-deep ring-1 ring-brand-blue-900/[0.08]">
                <role.icon aria-hidden="true" className="h-5 w-5 text-brand-600" />
              </span>
              <h3 className="mt-6 text-lg font-semibold text-brand-blue-900">{role.title}</h3>
              <p className="mt-3 flex-1 text-[0.9375rem] leading-relaxed text-brand-blue-900/60">
                {role.body}
              </p>
              {role.href && role.linkText && (
                <Link
                  href={role.href}
                  className="group mt-5 inline-flex items-center gap-1.5 rounded-sm text-sm font-semibold text-brand-700 transition-colors hover:text-brand-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-4 focus-visible:ring-offset-paper"
                >
                  {role.linkText}
                  <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
                </Link>
              )}
            </Reveal>
          ))}
        </div>

        <Reveal
          delay={80}
          className={cn(
            'relative isolate mt-5 overflow-hidden rounded-2xl bg-brand-blue-900 p-8 text-white sm:p-10',
            'lg:flex lg:items-center lg:justify-between lg:gap-12',
          )}
        >
          <div className="max-w-2xl">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
              <organization.icon aria-hidden="true" className="h-5 w-5 text-brand-400" />
            </span>
            <h3 className="mt-6 font-display text-2xl font-normal text-white">
              {organization.title}
            </h3>
            <p className="mt-3 text-base leading-relaxed text-brand-blue-100/70">
              {organization.body}
            </p>
          </div>
          {organization.href && organization.linkText && (
            <Link
              href={organization.href}
              className="group mt-7 inline-flex shrink-0 items-center gap-2 rounded-md border border-white/20 px-5 py-3 text-[0.9375rem] font-semibold text-white transition-colors hover:border-white/40 hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 focus-visible:ring-offset-2 focus-visible:ring-offset-brand-blue-900 lg:mt-0"
            >
              {organization.linkText}
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
          )}
        </Reveal>
      </Container>
    </Section>
  );
}

export default RoleCards;
