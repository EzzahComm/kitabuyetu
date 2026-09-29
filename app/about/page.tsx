import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { BarChart3, HandHeart, Lightbulb, LineChart, ShieldCheck, Wallet } from 'lucide-react';
import { PageShell } from '@/components/marketing/page-shell';
import { marketingMetadata } from '@/components/marketing/page-metadata';
import { ROUTES } from '@/components/marketing/routes';
import { Reveal } from '@/components/marketing/reveal';
import { StoryTabs } from '@/components/marketing/finanza-tabs';
import {
  FeatureBox,
  FinanzaHeading,
  FinanzaSection,
  IconBadge,
  Pill,
  btnOutline,
} from '@/components/marketing/finanza';
import {
  CtaBand,
  FounderCard,
  JoinTeamCard,
  KitabuFacts,
  TestimonialsSection,
} from '@/components/marketing/kitabu-sections';
import { PHOTOS } from '@/components/marketing/photos';

export const metadata: Metadata = marketingMetadata({
  path: '/about',
  title: 'About Us — Digital Records for Kenyan Groups',
  description:
    'Why Kitabu Yetu exists: to give chamas, welfare groups and SACCOs across Kenya simple, trustworthy digital records, and what that has changed for them.',
});

const VALUES = [
  {
    icon: HandHeart,
    title: 'Community',
    body: 'Listen to treasurers, officials and members before we decide what to build.',
  },
  {
    icon: Lightbulb,
    title: 'Product',
    body: 'Turn complicated group workflows into steps people can understand and repeat.',
  },
  {
    icon: ShieldCheck,
    title: 'Trust',
    body: 'Treat financial records, permissions and communication as responsibilities, not details.',
  },
];

const IMPACT = [
  { icon: Wallet, title: 'Manage', body: 'Members, contributions, loans, welfare and group activity.' },
  { icon: BarChart3, title: 'Understand', body: 'Reports and insights that explain where the money went.' },
  { icon: LineChart, title: 'Grow', body: 'A clearer track record for funding, products and opportunity.' },
];

/**
 * About Kitabu Yetu — the Finanza about.html layout (image + Story/Mission/
 * Vision tabs, value badges, facts, team) carrying the company's own story,
 * team positioning and impact commitment. The tabs are Story / Team / Impact
 * rather than an invented mission statement.
 */
export default function AboutPage() {
  return (
    <PageShell
      title="About Us"
      description="Simple, trustworthy digital records for the groups Kenyans already organize."
      layout="sections"
    >
      <FinanzaSection id="our-story" labelledBy="story-heading" className="pt-8 lg:pt-12">
        <div className="mb-8 grid items-end gap-8 lg:grid-cols-2">
          <Reveal>
            <Image
              src={PHOTOS.vslaReading.src}
              alt={PHOTOS.vslaReading.alt}
              className="w-full rounded-lg"
              sizes="(max-width: 1023px) 100vw, 50vw"
              placeholder="blur"
            />
          </Reveal>
          <Reveal delay={150}>
            <Pill>Our Story</Pill>
            <h2
              id="story-heading"
              className="mb-5 font-display text-[2rem] font-bold leading-[1.15] text-finanza-dark sm:text-[2.5rem] xl:text-5xl"
            >
              Most groups already keep good records
            </h2>
            <p className="mb-6 leading-relaxed text-finanza-text">
              The trouble was never discipline. It was where the records lived — one cash book in one person&apos;s
              handwriting, a spreadsheet three officers all need at once, and an M-Pesa statement somebody matches to a
              list of names the evening before every meeting.
            </p>
            <StoryTabs
              label="About Kitabu Yetu"
              tabs={[
                {
                  value: 'story',
                  label: 'Our Story',
                  content: (
                    <p>
                      Kitabu Yetu was built to put those three things in one place: the members, the money and the
                      payments, on a ledger that has to balance before it saves. The group keeps doing what it already
                      does. The book just stops being something one person carries.
                    </p>
                  ),
                },
                {
                  value: 'team',
                  label: 'Our Team',
                  content: (
                    <p>
                      Kitabu Yetu brings together product, engineering, operations and community knowledge. The people
                      who use the platform are part of the feedback loop, not an audience we design around from a
                      distance.
                    </p>
                  ),
                },
                {
                  value: 'impact',
                  label: 'Impact',
                  content: (
                    <p>
                      We will publish verified numbers as the platform grows. Until then, our standard is practical:
                      records close on time, members can see their own activity, and organizations can act on figures
                      they can trace back to a group.
                    </p>
                  ),
                },
              ]}
            />
          </Reveal>
        </div>
        <Reveal className="rounded-lg border border-brand-100 p-6">
          <ul className="grid gap-6 lg:grid-cols-3">
            {VALUES.map((value, i) => (
              <li
                key={value.title}
                className={
                  i < VALUES.length - 1
                    ? 'flex gap-4 border-b border-brand-100 pb-6 lg:border-b-0 lg:border-r lg:pb-0'
                    : 'flex gap-4'
                }
              >
                <IconBadge icon={value.icon} />
                <div>
                  <h3 className="font-display text-xl font-semibold text-finanza-dark">{value.title}</h3>
                  <p className="text-finanza-text">{value.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </Reveal>
      </FinanzaSection>

      <KitabuFacts />

      <FinanzaSection id="team" labelledBy="team-heading">
        <FinanzaHeading
          id="team-heading"
          align="center"
          pill="Our Team"
          title="A product built across the community"
          className="mb-6"
        />
        <div className="mx-auto grid max-w-3xl gap-6 md:grid-cols-2">
          <FounderCard />
          <JoinTeamCard />
        </div>
        <div className="mt-4 text-center">
          <Link href={ROUTES.aboutTeam} className={btnOutline}>
            Meet the team
          </Link>
        </div>
      </FinanzaSection>

      <FinanzaSection id="impact" labelledBy="impact-heading" className="bg-brand-50/60">
        <FinanzaHeading
          id="impact-heading"
          align="center"
          pill="Impact"
          title="Measure what becomes easier"
          lede="Verified numbers will follow as the platform grows. What we already hold ourselves to:"
          className="mb-12"
        />
        <div className="grid gap-6 md:grid-cols-3">
          {IMPACT.map((item, i) => (
            <Reveal key={item.title} delay={i * 120}>
              <FeatureBox icon={item.icon} title={item.title} className="h-full">
                {item.body}
              </FeatureBox>
            </Reveal>
          ))}
        </div>
        <p className="mt-10 text-center">
          <Link href={ROUTES.aboutImpact} className="font-medium text-brand-500 hover:text-brand-700">
            Read more about our impact →
          </Link>
        </p>
      </FinanzaSection>

      <TestimonialsSection />

      <CtaBand />
    </PageShell>
  );
}
