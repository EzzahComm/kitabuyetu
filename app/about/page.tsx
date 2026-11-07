import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import {
  Handshake,
  ShieldCheck,
  Lightbulb,
  UsersRound,
  Scale,
  HeartHandshake,
  Wallet,
  BarChart3,
  Network,
} from 'lucide-react';
import { PageShell } from '@/components/marketing/page-shell';
import { marketingMetadata } from '@/components/marketing/page-metadata';
import { ROUTES } from '@/components/marketing/routes';
import { Reveal } from '@/components/marketing/reveal';
import { FinanzaHeading, FinanzaSection, IconBadge, Pill, btnOutline } from '@/components/marketing/finanza';
import { CtaBand } from '@/components/marketing/sections/cta';
import { PHOTOS } from '@/components/marketing/photos';

export const metadata: Metadata = marketingMetadata({
  path: '/about',
  title: 'About Kitabu Yetu | Technology for Stronger Community Organisations',
  description:
    'Meet Kitabu Yetu: an impact-driven technology company equipping community organisations and the institutions that support them with accessible digital infrastructure.',
});

const VALUES = [
  {
    icon: Scale,
    title: 'Accountability',
    body: 'We make responsible management, clear records and transparent decisions easier to practise.',
  },
  {
    icon: UsersRound,
    title: 'Inclusion',
    body: 'We build accessible tools for organisations of different sizes, structures and levels of digital readiness.',
  },
  {
    icon: Lightbulb,
    title: 'Innovation',
    body: 'We solve practical organisational problems with useful, dependable technology.',
  },
  {
    icon: ShieldCheck,
    title: 'Integrity',
    body: 'We handle information responsibly and communicate honestly about what our products can do.',
  },
  {
    icon: Handshake,
    title: 'Collaboration',
    body: 'We work alongside organisations, institutions and partners to strengthen the communities they serve.',
  },
  {
    icon: HeartHandshake,
    title: 'Impact',
    body: 'We focus on measurable improvements in organisational capability, accountability and programme delivery.',
  },
];

const PILLARS = [
  {
    icon: Wallet,
    title: 'Manage',
    body: 'Membership, contributions, savings, loans, welfare and organisational records.',
  },
  {
    icon: BarChart3,
    title: 'Account',
    body: 'Reliable financial records, reporting and clearer oversight for authorised people.',
  },
  {
    icon: Network,
    title: 'Connect',
    body: 'Communication, institutional coordination and a growing network of opportunities and services.',
  },
];

export default function AboutPage() {
  return (
    <PageShell
      title="About Kitabu Yetu"
      description="The Digital Operating System for Community Organisations."
      layout="sections"
    >
      <FinanzaSection id="our-story" labelledBy="story-heading" className="pt-8 lg:pt-12">
        <div className="grid items-center gap-10 lg:grid-cols-2">
          <Reveal>
            <Image
              src={PHOTOS.vslaReading.src}
              alt={PHOTOS.vslaReading.alt}
              className="aspect-4/3 w-full rounded-lg object-cover"
              sizes="(max-width: 1023px) 100vw, 50vw"
              placeholder="blur"
            />
          </Reveal>
          <Reveal delay={120}>
            <Pill>Who We Are</Pill>
            <h2
              id="story-heading"
              className="mb-5 font-display text-[2rem] font-bold leading-[1.15] text-finanza-dark sm:text-[2.5rem] xl:text-5xl"
            >
              Digital infrastructure for the organisations that move communities forward.
            </h2>
            <p className="mb-4 leading-relaxed text-finanza-text">
              Kitabu Yetu is an impact-driven technology company building digital infrastructure for community
              organisations and the institutions that support them.
            </p>
            <p className="mb-4 leading-relaxed text-finanza-text">
              Community groups, cooperatives, churches, associations, CBOs and development programmes are essential to
              local progress. Yet many still depend on fragmented systems, manual records and disconnected communication
              to manage people, money and activities.
            </p>
            <p className="leading-relaxed text-finanza-text">
              We bring these essential processes together through practical, accessible technology—helping organisations
              operate more efficiently, strengthen accountability and build the reliable records needed to grow.
            </p>
          </Reveal>
        </div>
      </FinanzaSection>

      <FinanzaSection id="mission-vision" labelledBy="mission-heading" className="bg-brand-50/60">
        <FinanzaHeading
          id="mission-heading"
          align="center"
          pill="Our Purpose"
          title="A stronger foundation for every organisation."
          className="mb-10"
        />
        <div className="grid gap-6 md:grid-cols-2">
          <Reveal className="rounded-lg border border-brand-100 bg-white p-8">
            <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-brand-500">Our Mission</p>
            <h3 className="font-display text-2xl font-semibold leading-snug text-finanza-dark">
              To equip community organisations and the institutions that support them with accessible digital technology
              that strengthens organisational management, financial accountability, communication and programme impact.
            </h3>
          </Reveal>
          <Reveal delay={120} className="rounded-lg border border-brand-100 bg-white p-8">
            <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-brand-500">Our Vision</p>
            <h3 className="font-display text-2xl font-semibold leading-snug text-finanza-dark">
              A future where every community organisation is digitally empowered, financially accountable and connected
              to opportunities for sustainable growth.
            </h3>
          </Reveal>
        </div>
      </FinanzaSection>

      <FinanzaSection id="what-we-do" labelledBy="approach-heading">
        <FinanzaHeading
          id="approach-heading"
          align="center"
          pill="What We Do"
          title="Technology first. Connection that creates opportunity."
          lede="We are building two complementary layers: a dependable operating platform and a development ecosystem that can grow around it."
          className="mb-12"
        />
        <div className="grid gap-6 md:grid-cols-3">
          {PILLARS.map((item, i) => (
            <Reveal key={item.title} delay={i * 100} className="rounded-lg border border-brand-100 bg-white p-7">
              <IconBadge icon={item.icon} />
              <h3 className="mt-5 font-display text-xl font-semibold text-finanza-dark">{item.title}</h3>
              <p className="mt-2 leading-relaxed text-finanza-text">{item.body}</p>
            </Reveal>
          ))}
        </div>
        <div className="mt-10 rounded-lg bg-brand-50 p-7">
          <h3 className="mb-2 font-display text-xl font-semibold text-finanza-dark">The Technology Platform</h3>
          <p className="leading-relaxed text-finanza-text">
            Our products support financial and membership management, group communication, fundraising workflows and
            institutional programme oversight. Each organisation retains its own records, roles and operating rules.
          </p>
          <h3 className="mb-2 mt-6 font-display text-xl font-semibold text-finanza-dark">The Development Ecosystem</h3>
          <p className="leading-relaxed text-finanza-text">
            Alongside the platform, we are progressively developing pathways to relevant partners, training, services,
            programmes and opportunities. This ecosystem will be introduced responsibly as capabilities and partnerships
            are established.
          </p>
        </div>
      </FinanzaSection>

      <FinanzaSection id="who-we-serve" labelledBy="audience-heading" className="bg-brand-50/60">
        <FinanzaHeading
          id="audience-heading"
          align="center"
          pill="Who We Serve"
          title="Built for organisations of every scale."
          lede="From a community group maintaining its first digital ledger to an institution coordinating a portfolio of programmes."
          className="mb-10"
        />
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            'Chamas and VSLAs',
            'Self-help and welfare groups',
            'Community-based organisations',
            'NGOs and development programmes',
            'Churches and faith-based organisations',
            'Cooperatives and associations',
            'Networks and federations',
            'Community projects and initiatives',
            'Institutional and programme teams',
          ].map((item) => (
            <li
              key={item}
              className="rounded-lg border border-brand-100 bg-white px-5 py-4 font-medium text-finanza-dark"
            >
              {item}
            </li>
          ))}
        </ul>
      </FinanzaSection>

      <FinanzaSection id="values" labelledBy="values-heading">
        <FinanzaHeading
          id="values-heading"
          align="center"
          pill="Our Values"
          title="The principles behind the platform."
          className="mb-12"
        />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {VALUES.map((value, i) => (
            <Reveal key={value.title} delay={(i % 3) * 80} className="rounded-lg border border-brand-100 p-6">
              <IconBadge icon={value.icon} />
              <h3 className="mt-4 font-display text-xl font-semibold text-finanza-dark">{value.title}</h3>
              <p className="mt-2 leading-relaxed text-finanza-text">{value.body}</p>
            </Reveal>
          ))}
        </div>
      </FinanzaSection>

      <FinanzaSection id="our-approach" labelledBy="approach-values-heading" className="bg-brand-50/60">
        <FinanzaHeading
          id="approach-values-heading"
          align="center"
          pill="Our Approach"
          title="Practical technology. Responsible growth."
          lede="We listen to the organisations using our tools, build around real workflows and prioritise trust, usability and sustainable adoption."
          className="mb-10"
        />
        <div className="mx-auto max-w-3xl space-y-4 text-finanza-text">
          <p>
            We extend the platform in stages, protecting existing users and keeping core operations dependable as new
            capabilities are introduced.
          </p>
          <p>
            We respect organisational autonomy: each organisation should retain appropriate control over its
            information, financial arrangements, users and approval processes.
          </p>
          <p>
            We distinguish what is available today from what is being developed. We will not present planned
            marketplace, partnership or integration capabilities as live services until they are ready.
          </p>
        </div>
        <div className="mt-8 text-center">
          <Link href={ROUTES.enterprise} className={btnOutline}>
            Explore Kitabu Yetu Enterprise
          </Link>
        </div>
      </FinanzaSection>

      <CtaBand />
    </PageShell>
  );
}
