import Link from 'next/link';
import { ArrowRight, Mail, MapPin, Phone, UserRound } from 'lucide-react';
import { HeroCarousel } from '@/components/hero-carousel';
import { FinanzaHeading, FinanzaSection } from '@/components/finanza';
import { Reveal } from '@/components/reveal';
import { ABOUT, CONTACT, FOCUS_AREAS, HOME_SECTIONS, TEAM } from '@/lib/content';

export default function Home() {
  return (
    <main id="main">
      <HeroCarousel />
      <p className="mx-auto max-w-[82rem] px-5 pt-3 text-right text-xs text-finanza-text sm:px-8 lg:px-10">
        Hero images are AI-generated illustrations.
      </p>
      <FinanzaSection id="about" labelledBy="about-heading">
        <FinanzaHeading
          id="about-heading"
          pill="Who We Are"
          title="About Subira International"
          lede={ABOUT.introduction}
        />
        <div id="mission-vision" className="mt-10 grid scroll-mt-28 gap-5 md:grid-cols-3">
          <Reveal className="rounded-lg border border-brand-100 bg-brand-50 p-6">
            <h3 className="font-display text-2xl font-semibold">Mission</h3>
            <p className="mt-3 leading-relaxed text-finanza-text">{ABOUT.mission}</p>
          </Reveal>
          <Reveal className="rounded-lg border border-brand-100 bg-brand-50 p-6">
            <h3 className="font-display text-2xl font-semibold">Vision</h3>
            <p className="mt-3 leading-relaxed text-finanza-text">{ABOUT.vision}</p>
          </Reveal>
          <Reveal className="rounded-lg border border-brand-100 bg-brand-50 p-6">
            <h3 className="font-display text-2xl font-semibold">Values</h3>
            <ul className="mt-3 space-y-2 text-finanza-text">
              {ABOUT.values.map((value) => (
                <li key={value}>{value}</li>
              ))}
            </ul>
          </Reveal>
        </div>
        <div className="mt-10 grid gap-8 md:grid-cols-3">
          <div id="approach" className="scroll-mt-28">
            <h3 className="font-display text-2xl font-semibold">Our Approach</h3>
            <p className="mt-3 leading-relaxed text-finanza-text">{ABOUT.approach}</p>
          </div>
          <div id="impact" className="scroll-mt-28">
            <h3 className="font-display text-2xl font-semibold">Impact</h3>
            <p className="mt-3 leading-relaxed text-finanza-text">{ABOUT.impact}</p>
            <Link
              href="/#focus-areas"
              className="mt-3 inline-block font-medium text-brand-600 underline underline-offset-4"
            >
              Explore our focus areas
            </Link>
          </div>
          <div id="careers" className="scroll-mt-28">
            <h3 className="font-display text-2xl font-semibold">Careers</h3>
            <Link
              href="/#contact"
              className="mt-3 inline-block font-medium text-brand-600 underline underline-offset-4"
            >
              Enquire about opportunities
            </Link>
          </div>
        </div>
      </FinanzaSection>
      <FinanzaSection id="team" labelledBy="team-heading">
        <FinanzaHeading id="team-heading" title="Our Team" align="center" />
        <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {TEAM.map(({ role, name }) => (
            <Reveal key={role} as="li" className="overflow-hidden rounded-lg border border-brand-100 bg-white">
              <div className="grid aspect-[2/1] place-items-center bg-brand-50">
                <UserRound aria-hidden="true" className="size-14 text-brand-300" />
              </div>
              <div className="p-5">
                <h3 className="font-display text-xl font-semibold">{name ?? role}</h3>
                <p className="mt-1 text-finanza-text">{name ? role : 'Profile forthcoming'}</p>
              </div>
            </Reveal>
          ))}
        </ul>
      </FinanzaSection>
      <FinanzaSection id="focus-areas" className="bg-brand-50" labelledBy="focus-areas-heading">
        <FinanzaHeading id="focus-areas-heading" title="Focus Areas" align="center" />
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          {FOCUS_AREAS.map(({ id, title, heading, paragraphs, link }) => (
            <article key={id} id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-28">
              <Reveal className="h-full rounded-lg border border-brand-100 bg-white p-6 sm:p-8">
                <h3 id={`${id}-heading`} className="font-display text-2xl font-semibold">
                  {title}
                </h3>
                <p className="mt-2 font-medium text-brand-600">{heading}</p>
                {paragraphs.map((paragraph) => (
                  <p key={paragraph} className="mt-3 leading-relaxed text-finanza-text">
                    {paragraph}
                  </p>
                ))}
                {link && (
                  <a
                    href={link.href}
                    className="mt-4 inline-flex items-center gap-2 font-medium text-brand-600 underline underline-offset-4"
                  >
                    {link.label} <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
                  </a>
                )}
              </Reveal>
            </article>
          ))}
        </div>
      </FinanzaSection>
      <FinanzaSection id="contact" labelledBy="contact-heading">
        <div className="grid items-start gap-8 md:grid-cols-2">
          <FinanzaHeading
            id="contact-heading"
            title="Contact Subira International"
            lede="Get in touch about our programmes, partnerships or ways to support our work."
          />
          <address className="space-y-4 rounded-lg border border-brand-100 bg-brand-50 p-6 not-italic">
            <p className="flex items-start gap-3">
              <MapPin aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-brand-600" />
              {CONTACT.location}
            </p>
            <ul className="space-y-2">
              {CONTACT.phones.map((phone) => (
                <li key={phone} className="flex items-start gap-3">
                  <Phone aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-brand-600" />
                  <a href={`tel:${phone.replace(/\s/g, '')}`} className="text-brand-600 underline underline-offset-4">
                    {phone}
                  </a>
                </li>
              ))}
              {CONTACT.emails.map((email) => (
                <li key={email} className="flex items-start gap-3">
                  <Mail aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-brand-600" />
                  <a href={`mailto:${email}`} className="min-w-0 break-all text-brand-600 underline underline-offset-4">
                    {email}
                  </a>
                </li>
              ))}
            </ul>
          </address>
        </div>
      </FinanzaSection>
      <FinanzaSection labelledBy="explore-heading">
        <FinanzaHeading id="explore-heading" title="Explore Subira" align="center" />
        <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {HOME_SECTIONS.map(({ id, title, description }) => (
            <article key={id} id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-28">
              <Reveal className="h-full rounded-lg border border-brand-100 bg-white p-6">
                <h3 id={`${id}-heading`} className="font-display text-2xl font-semibold">
                  {title}
                </h3>
                <p className="mt-2 leading-relaxed text-finanza-text">{description}</p>
                {id === 'donate' && (
                  <Link
                    href="/#contact"
                    className="mt-4 inline-flex items-center gap-2 font-medium text-brand-600 hover:underline"
                  >
                    Contact <ArrowRight aria-hidden="true" className="size-4" />
                  </Link>
                )}
              </Reveal>
            </article>
          ))}
        </div>
      </FinanzaSection>
    </main>
  );
}
