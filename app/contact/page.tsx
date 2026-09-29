import type { Metadata } from 'next';
import Link from 'next/link';
import { Mail, MapPin, Phone } from 'lucide-react';
import { IconBrandWhatsapp } from '@tabler/icons-react';
import { PageShell } from '@/components/marketing/page-shell';
import { CONTACT, ROUTES, telHref, whatsappHref } from '@/components/marketing/routes';
import { marketingMetadata } from '@/components/marketing/page-metadata';
import { CallbackForm } from '@/components/marketing/callback-form';
import { FinanzaSection, IconBadge, Pill, patternBandStyle } from '@/components/marketing/finanza';
import { Reveal } from '@/components/marketing/reveal';
import { SocialLinks } from '@/components/marketing/social-links';

export const metadata: Metadata = marketingMetadata({
  path: '/contact',
  title: 'Contact',
  description: 'Get in touch with the Kitabu Yetu team.',
});

/** Maps URLs API: a search link, so it needs no key and no embed. */
const MAP_URL = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(CONTACT.city)}`;

/**
 * Finanza's contact.html: form on the left, location on the right. The
 * template embeds a Google Map iframe there; this site's CSP has no
 * frame-src for Google (default-src 'self'), and loosening a security header
 * for decoration isn't worth it — so the right column is a location card that
 * opens Maps in a new tab instead.
 */
export default function ContactPage() {
  const phone = CONTACT.phones[0];
  return (
    <PageShell
      title="Contact Us"
      description="Questions about your group, a demo, or a partnership — reach us directly."
      layout="sections"
    >
      <FinanzaSection labelledBy="contact-heading" className="pt-8 lg:pt-12">
        <div className="grid gap-12 lg:grid-cols-2">
          <Reveal>
            <Pill>Contact</Pill>
            <h2
              id="contact-heading"
              className="mb-5 font-display text-[2rem] font-bold leading-[1.15] text-finanza-dark sm:text-[2.5rem] xl:text-5xl"
            >
              If You Have Any Query, Please Contact Us
            </h2>
            <p className="mb-8 leading-relaxed text-finanza-text">
              Already using Kitabu Yetu and need help with your account? Your group&apos;s chairperson, secretary, or
              treasurer can also reach us on your behalf — or see{' '}
              <Link href={ROUTES.support} className="font-medium text-brand-500 hover:text-brand-700">
                Support
              </Link>
              .
            </p>
            <CallbackForm variant="contact" />
          </Reveal>

          <Reveal delay={150} className="min-h-[450px]">
            <div
              className="flex h-full flex-col justify-between gap-10 overflow-hidden rounded-lg p-8 text-white sm:p-10"
              style={patternBandStyle}
            >
              <div>
                <h2 className="font-display text-3xl font-bold text-white">Our Office</h2>
                <p className="mt-2 text-white/85">Built in Nairobi, for East Africa.</p>
              </div>

              <ul className="space-y-6">
                <li className="flex items-center gap-4">
                  <IconBadge icon={MapPin} className="bg-white/15" />
                  <div>
                    <p className="text-sm text-white/75">Location</p>
                    <a
                      href={MAP_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-white underline-offset-4 hover:underline"
                    >
                      {CONTACT.city}
                    </a>
                  </div>
                </li>
                <li className="flex items-center gap-4">
                  <IconBadge icon={Phone} className="bg-white/15" />
                  <div>
                    <p className="text-sm text-white/75">Calls &amp; WhatsApp</p>
                    <a href={telHref(phone)} className="font-medium text-white underline-offset-4 hover:underline">
                      {phone}
                    </a>
                  </div>
                </li>
                <li className="flex items-center gap-4">
                  <IconBadge icon={Mail} className="bg-white/15" />
                  <div>
                    <p className="text-sm text-white/75">Email</p>
                    <a
                      href={`mailto:${CONTACT.email}`}
                      className="break-all font-medium text-white underline-offset-4 hover:underline"
                    >
                      {CONTACT.email}
                    </a>
                  </div>
                </li>
              </ul>

              <div className="flex flex-col gap-5">
                <a
                  href={whatsappHref(phone)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-white px-6 py-3 font-medium text-brand-500 transition-colors hover:bg-brand-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  <IconBrandWhatsapp aria-hidden="true" size={20} />
                  Chat on WhatsApp
                </a>
                <SocialLinks variant="footer" className="flex-wrap justify-center" />
              </div>
            </div>
          </Reveal>
        </div>
      </FinanzaSection>
    </PageShell>
  );
}
