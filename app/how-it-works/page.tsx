import type { Metadata } from 'next';
import {
  Smartphone,
  ShieldCheck,
  BookOpen,
  DollarSign,
  ListChecks,
  TrendingUp,
} from 'lucide-react';

import { SectionTitle } from '@/components/SectionTitle';
import { Benefits } from '@/components/Benefits';
import { Video } from '@/components/Video';
import { Cta } from '@/components/Cta';
import { SiteHeader } from '@/components/marketing/site-header';
import { SiteFooter } from '@/components/marketing/site-footer';
import { displayFont } from '@/components/marketing/display-font';
import { marketingMetadata } from '@/components/marketing/page-metadata';
import { PHOTOS } from '@/components/marketing/photos';

export const metadata: Metadata = marketingMetadata({
  path: '/how-it-works',
  title: 'How M-Pesa Chama Contributions Get Recorded',
  description:
    "From a member's M-Pesa payment to their updated balance: how Kitabu Yetu keeps chama records accurate automatically.",
});

/**
 * This page predates the marketing redesign and was missed when the rest of
 * the site moved to SiteHeader/SiteFooter — it shipped with no navigation at
 * all, live, at /how-it-works. Wrapping it here (rather than porting its
 * content into PageShell) keeps this fix to "put the nav back" and out of
 * "redesign the page", since its layout is a custom icon/benefit grid that
 * PageShell's single-column prose container isn't built for.
 */
export default function HowItWorksPage() {
  return (
    <div className={`${displayFont.variable} flex min-h-screen flex-col bg-white`}>
      <SiteHeader />
      <main id="main" className="flex-1 pt-16 lg:pt-20">
        <SectionTitle preTitle="How it works" title="Member pays. Books update. Done." titleAs="h1">
          Spend meetings making decisions — not rebuilding records.
        </SectionTitle>

        <Benefits data={theFlow} />

        <Video videoId="fZ0D0cnR88E" />

        <Benefits imgPos="right" data={theEdges} />

        <Cta />
      </main>
      <SiteFooter />
    </div>
  );
}

const theFlow = {
  title: 'Three steps. None of them yours.',
  desc: 'Members pay the way they already do. The rest happens on its own.',
  image: PHOTOS.youthTech.src,
  imageAlt: PHOTOS.youthTech.alt,
  bullets: [
    {
      title: 'Member pays',
      desc: 'A payment prompt on their phone, or your PayBill with their member number. Anyone can pay on their behalf.',
      icon: <Smartphone />,
    },
    {
      title: 'Payment is matched',
      desc: 'Each payment is checked with M-Pesa, then linked to the right member automatically.',
      icon: <ShieldCheck />,
    },
    {
      title: 'The records update',
      desc: 'Split into savings, welfare and loan repayment by your rules — and confirmed to the member by SMS.',
      icon: <BookOpen />,
    },
  ],
};

const theEdges = {
  title: ‘Built to never get it wrong’,
  desc: ‘A payment on the wrong member is worse than one waiting for a check.’,
  image: PHOTOS.vslaReading.src,
  imageAlt: PHOTOS.vslaReading.alt,
  bullets: [
    {
      title: ‘It never guesses’,
      desc: ‘A payment without a clear reference waits on your dashboard until an official assigns it.’,
      icon: <ListChecks />,
    },
    {
      title: ‘Cash still counts’,
      desc: ‘Cash collected at the meeting is recorded by hand, in the same books.’,
      icon: <DollarSign />,
    },
    {
      title: ‘Money goes out the same way’,
      desc: ‘Loans, welfare and dividends go straight to members’ M-Pesa — approved first, then confirmed.’,
      icon: <TrendingUp />,
    },
  ],
};
