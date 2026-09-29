import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  BookOpenCheck,
  Check,
  Ear,
  FileUp,
  HeartHandshake,
  Mail,
  MessagesSquare,
  Search,
  ShieldCheck,
  Sprout,
  UsersRound,
} from 'lucide-react';
import { PageShell } from '@/components/marketing/page-shell';
import { CareersOpenings } from '@/components/marketing/careers-openings';
import { marketingMetadata } from '@/components/marketing/page-metadata';
import { CONTACT, ROUTES } from '@/components/marketing/routes';
import { Container } from '@/components/marketing/primitives';
import { Reveal } from '@/components/marketing/reveal';
import {
  FeatureBox,
  FinanzaHeading,
  FinanzaSection,
  IconBadge,
  btnOnPrimary,
  btnOutline,
  btnPrimary,
  patternBandStyle,
} from '@/components/marketing/finanza';
import { getOpenJobs } from '@/lib/cms/sanity';

export const metadata: Metadata = marketingMetadata({
  path: '/careers',
  title: 'Careers',
  description:
    'Join Kitabu Yetu and help build practical financial tools for chamas, SACCOs, welfare groups and community organizations across East Africa.',
});

const OPENINGS_ID = 'open-roles';

const WHY = [
  {
    icon: HeartHandshake,
    title: 'Work that is used',
    body: 'Your work will be used by real groups making real decisions about their families, businesses and futures.',
  },
  {
    icon: ShieldCheck,
    title: 'Accountable by design',
    body: 'We listen closely, ship thoughtfully and stay accountable to the people whose records we help protect.',
  },
  {
    icon: UsersRound,
    title: 'A small team, a wide reach',
    body: 'Product thinkers, engineers, community listeners and operators who care about useful technology over noisy technology.',
  },
];

const VALUES = [
  {
    icon: Ear,
    title: 'Start with listening',
    body: 'The best product decisions begin with the group, not the feature list.',
  },
  {
    icon: BookOpenCheck,
    title: 'Make trust visible',
    body: 'Clear records, careful defaults and honest communication are part of the product.',
  },
  {
    icon: Sprout,
    title: 'Leave things better',
    body: 'We improve the system, the process and the community around us as we go.',
  },
  {
    icon: MessagesSquare,
    title: 'Keep learning',
    body: 'Curiosity is practical here. Ask the next question and bring others along.',
  },
];

const TEAMS = [
  'Product and engineering',
  'Community and operations',
  'Partnerships',
  'Customer experience',
  'Marketing',
];

const BENEFITS = [
  'Flexible, trust-based work',
  'Learning and development',
  'Meaningful community impact',
  'A voice in how we build',
];

/** Describes only what the application flow actually does: the form on each role page, then a reply if there is a fit. */
const HOW_TO_APPLY = [
  {
    icon: Search,
    title: 'Find a role',
    body: 'Every open position is listed on this page, with the work, the expectations and where it is based.',
  },
  {
    icon: FileUp,
    title: 'Apply online',
    body: 'Send your details, your CV (PDF or Word) and a short note on why the role interests you — straight from the role page.',
  },
  {
    icon: MessagesSquare,
    title: 'Hear from us',
    body: 'Our team reviews applications and will be in touch if there is a fit for the role.',
  },
];

/**
 * Open positions are Sanity-backed (kitabuyetu-studio's "job" type) — see
 * CareersOpenings for the filtering UI and app/careers/[slug] for the detail
 * page. Falls back to an honest "no open roles" state when the CMS has
 * nothing published.
 */
export default async function CareersPage() {
  const jobs = await getOpenJobs();
  const roleCount = jobs.length === 1 ? '1 open role' : `${jobs.length} open roles`;

  return (
    <PageShell
      title="Careers"
      description="Build the tools that help communities move forward. Kitabu Yetu gives the people running chamas, VSLAs and community organizations a clearer way to manage their members, money and next chapter."
      crumbs={[{ label: 'About', href: ROUTES.about }]}
      layout="sections"
    >
      {/* Why work with us */}
      <FinanzaSection labelledBy="why-join-heading" className="pt-4 lg:pt-8">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <FinanzaHeading
              id="why-join-heading"
              pill="Why Join Us"
              title="Serious about the work. Human about the people."
              lede="Every group that switches from a notebook to Kitabu Yetu trusts us with its members, its money and its history. That trust is the job — and the reason the job matters."
            />
            <div className="mt-8 flex flex-wrap gap-4">
              <a href={`#${OPENINGS_ID}`} className={btnPrimary}>
                {jobs.length > 0 ? `See ${roleCount}` : 'See open roles'}
              </a>
              <a href={`mailto:${CONTACT.careersEmail}`} className={btnOutline}>
                Introduce yourself
              </a>
            </div>
          </div>
          <div className="grid gap-6">
            {WHY.map((item, i) => (
              <Reveal key={item.title} delay={i * 120}>
                <FeatureBox icon={item.icon} title={item.title}>
                  {item.body}
                </FeatureBox>
              </Reveal>
            ))}
          </div>
        </div>
      </FinanzaSection>

      {/* Culture */}
      <FinanzaSection labelledBy="culture-heading" className="bg-brand-50/60">
        <FinanzaHeading
          id="culture-heading"
          align="center"
          pill="Our Culture"
          title="How we work together"
          className="mb-12"
        />
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {VALUES.map((value, i) => (
            <Reveal
              as="li"
              key={value.title}
              delay={i * 120}
              className="rounded-lg border border-brand-100 bg-white p-6"
            >
              <IconBadge icon={value.icon} className="mb-5" />
              <h3 className="font-display text-xl font-semibold text-finanza-dark">{value.title}</h3>
              <p className="mt-2 leading-relaxed text-finanza-text">{value.body}</p>
            </Reveal>
          ))}
        </ul>
      </FinanzaSection>

      {/* Teams and benefits */}
      <FinanzaSection labelledBy="teams-heading">
        <div className="grid gap-12 lg:grid-cols-2">
          <div>
            <FinanzaHeading
              id="teams-heading"
              pill="Teams"
              title="Different skills, one useful product"
              lede="Our work sits where community insight, product craft, technology and operations meet."
            />
            <ul className="mt-8 grid gap-3 sm:grid-cols-2">
              {TEAMS.map((team) => (
                <li
                  key={team}
                  className="flex items-center gap-3 rounded-lg border border-brand-100 px-4 py-3 font-medium text-finanza-dark"
                >
                  <Check aria-hidden="true" className="h-5 w-5 shrink-0 text-brand-500" />
                  {team}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <FinanzaHeading
              pill="Benefits"
              title="Room to do your best work"
              lede="As the team grows, we are building practical support around the people doing the work."
            />
            <ul className="mt-8 grid gap-3 sm:grid-cols-2">
              {BENEFITS.map((benefit) => (
                <li
                  key={benefit}
                  className="flex items-center gap-3 rounded-lg border border-brand-100 px-4 py-3 font-medium text-finanza-dark"
                >
                  <Check aria-hidden="true" className="h-5 w-5 shrink-0 text-brand-500" />
                  {benefit}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </FinanzaSection>

      {/* Open positions */}
      <FinanzaSection id={OPENINGS_ID} labelledBy="openings-heading" className="bg-brand-50/60">
        <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <FinanzaHeading
              id="openings-heading"
              pill="Open Positions"
              title="Find your place here"
              lede="We are keeping the team small while we get the fundamentals right. When a role opens, this is where you will find the work, the expectations and the application process."
            />
            {jobs.length > 0 && <p className="mt-6 font-medium text-finanza-dark">{roleCount} currently published.</p>}
          </div>
          <CareersOpenings jobs={jobs} />
        </div>
      </FinanzaSection>

      {/* How to apply */}
      <FinanzaSection labelledBy="apply-heading">
        <FinanzaHeading
          id="apply-heading"
          align="center"
          pill="How To Apply"
          title="Three steps, no runaround"
          className="mb-12"
        />
        <ol className="grid gap-6 md:grid-cols-3">
          {HOW_TO_APPLY.map((step, i) => (
            <Reveal
              as="li"
              key={step.title}
              delay={i * 120}
              className="relative rounded-lg border border-brand-100 p-8"
            >
              <span
                className="absolute right-6 top-6 font-display text-5xl font-bold text-brand-100"
                aria-hidden="true"
              >
                {i + 1}
              </span>
              <IconBadge icon={step.icon} className="mb-5" />
              <h3 className="font-display text-xl font-semibold text-finanza-dark">
                <span className="sr-only">Step {i + 1}: </span>
                {step.title}
              </h3>
              <p className="mt-2 leading-relaxed text-finanza-text">{step.body}</p>
            </Reveal>
          ))}
        </ol>
      </FinanzaSection>

      {/* Closing call to action */}
      <section aria-labelledby="careers-cta-heading" className="py-12">
        <Container>
          <div
            className="flex flex-col items-center gap-8 rounded-lg px-6 py-12 text-center text-white sm:px-12 lg:flex-row lg:justify-between lg:text-left"
            style={patternBandStyle}
          >
            <div className="max-w-2xl">
              <h2
                id="careers-cta-heading"
                className="font-display text-[2rem] font-bold leading-tight text-white sm:text-[2.5rem]"
              >
                Bring your perspective
              </h2>
              <p className="mt-3 text-lg text-white/90">
                Thoughtful introductions are welcome, even between openings. Tell us what you would build.
              </p>
            </div>
            <div className="flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row">
              <a href={`mailto:${CONTACT.careersEmail}`} className={btnOnPrimary}>
                <Mail aria-hidden="true" className="h-4 w-4" />
                Email our team
              </a>
              <Link
                href={ROUTES.aboutTeam}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-white px-8 py-3 font-medium text-white transition-colors duration-500 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                Meet the team <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </Container>
      </section>
    </PageShell>
  );
}
