import Image from 'next/image';
import Link from 'next/link';
import type { WebsiteSnapshot } from '@/lib/websites/content';

import { EnquiryForm } from './enquiry-form';
export function PublicSite({ site, slug }: { site: WebsiteSnapshot; slug?: string }) {
  const hasPrograms = site.stories.length + site.programs.length > 0;
  const nav = [
    ...(site.about ? [{ href: '#about', label: 'About' }] : []),
    ...(hasPrograms ? [{ href: '#programmes', label: 'Programmes' }] : []),
    ...(site.campaigns.length ? [{ href: '#fundraisers', label: 'Fundraisers' }] : []),
    ...(site.contactEmail || site.acceptEnquiries ? [{ href: '#contact', label: 'Contact' }] : []),
  ];
  return (
    <div className="bg-[#faf8f1] text-[#162e2a]" style={{ borderTop: '5px solid ' + site.accent }}>
      <div className="mx-auto max-w-7xl px-5 sm:px-10 lg:px-16">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#bfcac1] py-5">
          <a href="#home" className="flex items-center gap-3 font-semibold tracking-tight">
            {site.logo && (
              <Image
                unoptimized
                src={site.logo.src}
                alt={site.logo.alt}
                width={52}
                height={52}
                className="h-12 w-12 object-contain"
              />
            )}
            {site.name}
          </a>
          <nav aria-label="Website navigation" className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {nav.map((item) => (
              <a key={item.href} href={item.href} className="underline-offset-4 hover:underline">
                {item.label}
              </a>
            ))}
          </nav>
        </header>
        <section id="home" className="grid items-center gap-8 py-10 sm:py-16 lg:grid-cols-[1fr_0.9fr]">
          <div className="space-y-6">
            <h1 className="max-w-3xl break-words font-serif text-5xl font-medium leading-[1.04] tracking-tight sm:text-7xl">
              {site.headline}
            </h1>
            {site.introduction && (
              <p className="max-w-xl whitespace-pre-line text-lg leading-relaxed text-[#3c554d]">{site.introduction}</p>
            )}
            {hasPrograms && (
              <a className="inline-block rounded-full bg-[#194837] px-6 py-3 font-medium text-white" href="#programmes">
                Explore programmes
              </a>
            )}
          </div>
          <div
            role="img"
            aria-label={site.cover?.alt ?? 'Illustrative street photograph'}
            className="min-h-56 rounded-t-[5rem] rounded-br-[3rem] bg-[#d4ded2] bg-cover bg-center sm:min-h-80 lg:min-h-[25rem]"
            style={{ backgroundImage: site.cover ? 'url(' + site.cover.src + ')' : 'url(/img/hero-two.jpg)' }}
          />
        </section>
        {site.about && (
          <section id="about" className="grid gap-5 border-t border-[#bfcac1] py-12 md:grid-cols-[1fr_2fr]">
            <h2 className="font-serif text-4xl">About us</h2>
            <p className="max-w-3xl whitespace-pre-line text-lg leading-relaxed">{site.about}</p>
          </section>
        )}
        {hasPrograms && (
          <section id="programmes" className="border-t border-[#bfcac1] py-12">
            <h2 className="mb-7 font-serif text-4xl">Community programmes</h2>
            <div className="grid gap-x-10 gap-y-7 md:grid-cols-2">
              {site.stories.map((story, i) => (
                <article key={i} className="border-l-2 border-[#7c9267] pl-5">
                  <h3 className="mb-2 text-xl font-semibold">{story.title}</h3>
                  <p className="whitespace-pre-line leading-relaxed">{story.description}</p>
                </article>
              ))}
              {site.programs.map((p, i) => (
                <article key={i} className="border-l-2 border-[#7c9267] pl-5">
                  <h3 className="text-xl font-semibold">{p.name}</h3>
                  <a className="mt-3 inline-block underline" href={'/login?program=' + encodeURIComponent(p.slug)}>
                    Group applications in Kitabu Yetu
                  </a>
                </article>
              ))}
            </div>
          </section>
        )}
        {site.campaigns.length > 0 && (
          <section id="fundraisers" className="border-t border-[#bfcac1] py-12">
            <h2 className="mb-5 font-serif text-4xl">Support a fundraiser</h2>
            {site.campaigns.map((c) => (
              <a key={c.slug} href={'/fundraise/' + c.slug} className="block py-3 text-lg font-semibold underline">
                {c.title}
              </a>
            ))}
          </section>
        )}
        {(site.contactEmail || site.acceptEnquiries) && (
          <section id="contact" className="space-y-3 border-t border-[#bfcac1] py-12">
            <h2 className="font-serif text-4xl">Get in touch</h2>
            {site.contactEmail && (
              <a href={'mailto:' + site.contactEmail} className="break-all text-lg underline">
                {site.contactEmail}
              </a>
            )}
            {site.acceptEnquiries && <EnquiryForm slug={slug} />}
          </section>
        )}
        <footer className="flex flex-wrap justify-between gap-5 border-t border-[#bfcac1] py-6 text-sm">
          <span>{site.name}</span>
          <div className="flex flex-wrap gap-5">
            {site.memberAccess && (
              <a className="underline" href="/login">
                Member sign in
              </a>
            )}
            <a className="underline" href="/enterprise/login">
              Staff sign in
            </a>
            <Link className="underline" href="/">
              Kitabu Yetu
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
