import Link from "next/link";
import {
  IconCash,
  IconTrendingUp,
  IconMessages,
  IconChartBar,
  IconSchool,
  IconBuildingStore,
  IconShieldCheck,
  IconFileText,
} from "@tabler/icons-react";

import { Hero } from "@/components/Hero";
import { Container } from "@/components/Container";
import { SectionTitle } from "@/components/SectionTitle";
import { Benefits } from "@/components/Benefits";
import { ProductGrid } from "@/components/ProductGrid";
import { Testimonials } from "@/components/Testimonials";
import { Cta } from "@/components/Cta";
import { signUpUrl } from "@/lib/app-links";

import benefitOneImg from "../../public/img/benefit-one.jpg";
import benefitTwoImg from "../../public/img/benefit-two.jpg";

/** The punchy one-liner that closes several sections. */
const Emphasis = ({ children }: { children: React.ReactNode }) => (
  <Container className="mb-20">
    <p className="mx-auto max-w-2xl border-l-4 border-brand-500 px-5 text-center text-lg font-semibold leading-8 text-brand-blue-900 dark:text-gray-200">
      {children}
    </p>
  </Container>
);

export default function Home() {
  return (
    <>
      <Hero />

      <SectionTitle
        preTitle="The whole picture"
        title="Everything your group needs, in one place."
      >
        No more switching between notebooks, spreadsheets, M-Pesa messages and
        WhatsApp to understand your group&apos;s finances.
      </SectionTitle>

      <Benefits data={manage} />

      <Emphasis>
        More visibility. More accountability. Better decisions.
      </Emphasis>

      <SectionTitle
        preTitle="Ecosystem"
        title="From managing your group to growing it."
      >
        The Kitabu Yetu Ecosystem connects organized groups to opportunities,
        knowledge and resources beyond their own savings.
      </SectionTitle>

      <Benefits imgPos="right" data={ecosystem} />

      <Emphasis>
        Manage your group. Build its track record. Unlock its potential.
      </Emphasis>

      <SectionTitle preTitle="Products" title="One platform. Four solutions." />

      <ProductGrid />

      <SectionTitle preTitle="How it works" title="From M-Pesa to your books.">
        Payments and records work together. Members pay through M-Pesa and
        Kitabu Yetu helps match payments to members and update the group&apos;s
        records.
      </SectionTitle>

      <Container className="mb-20">
        <p className="max-w-2xl mx-auto text-lg font-medium text-center text-gray-800 dark:text-gray-200">
          Less manual reconciliation. Less guessing. More confidence.
        </p>
        <div className="mt-8 text-center">
          <Link
            href="/how-it-works"
            className="inline-flex min-h-12 items-center justify-center rounded-md bg-brand-600 px-6 py-3 text-lg font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            See How It Works
          </Link>
        </div>
      </Container>

      <SectionTitle preTitle="Testimonials" title="Trusted by groups" />

      <Testimonials />

      <SectionTitle
        preTitle="Pricing"
        title="Simple pricing. Start small. Grow with us."
      >
        SMS included in every plan, with affordable top-ups when you need more.
      </SectionTitle>

      <Container className="mb-20">
        <div className="max-w-2xl mx-auto text-center">
          <p className="text-xl font-medium text-gray-800 dark:text-gray-200">
            Bookkeeper from KES 150/month
          </p>
          <p className="mt-2 text-xl font-medium text-gray-800 dark:text-gray-200">
            Chama Reminder from KES 100/month
          </p>
          <div className="mt-8">
            <Link
              href="/pricing"
              className="inline-flex min-h-12 items-center justify-center rounded-md bg-brand-600 px-6 py-3 text-lg font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              View Pricing
            </Link>
          </div>
        </div>
      </Container>

      <Cta
        title="Ready to grow your group?"
        subtitle="Bring your members, money, records and investments together."
        note="Not sure where to start? Tell us about your group and we'll recommend the right solution."
        footnote="No lock-in period · Pay by M-Pesa · Built for Kenyan groups"
        primary={{ text: "Get Started", href: signUpUrl() }}
        secondary={{ text: "Talk to Us", href: "/contact" }}
      />
    </>
  );
}

const manage = {
  title: "Everything your group needs, in one place.",
  desc: "No more switching between notebooks, spreadsheets, M-Pesa messages and WhatsApp to understand your group's finances.",
  image: benefitOneImg,
  bullets: [
    {
      title: "Manage your money",
      desc: "Track members, contributions, savings, loans, welfare, shares, dividends, income and expenses from one reliable financial record.",
      icon: <IconCash size={24} />,
    },
    {
      title: "Track what you're building",
      desc: "Manage farms, rentals, shops, businesses, projects and other investments. See what each activity costs, earns and contributes to the group.",
      icon: <IconTrendingUp size={24} />,
    },
    {
      title: "Keep members informed",
      desc: "Send contribution reminders, payment confirmations, announcements and campaigns — while members access their own balances and statements.",
      icon: <IconMessages size={24} />,
    },
    {
      title: "Make every shilling visible",
      desc: "Know where group money comes from, where it goes and what it is building.",
      icon: <IconChartBar size={24} />,
    },
  ],
};

const ecosystem = {
  title: "From managing your group to growing it.",
  desc: "The Kitabu Yetu Ecosystem connects organized groups to opportunities, knowledge and resources beyond their own savings.",
  image: benefitTwoImg,
  bullets: [
    {
      title: "Funding",
      desc: "Connect with potential donors, development partners and funding opportunities for groups and community projects.",
      icon: <IconCash size={24} />,
    },
    {
      title: "Financial products",
      desc: "Discover relevant loans, insurance and other financial products for groups and their members.",
      icon: <IconShieldCheck size={24} />,
    },
    {
      title: "Professional knowledge",
      desc: "Access information, training and practical guidance from professionals in finance, agriculture, investment, entrepreneurship, governance and other areas.",
      icon: <IconSchool size={24} />,
    },
    {
      title: "Markets & services",
      desc: "Discover potential markets, suppliers, service providers and business opportunities that can support your group's activities.",
      icon: <IconBuildingStore size={24} />,
    },
    {
      title: "Build your track record",
      desc: "Better records help your group build a clearer picture of its financial health, activities and impact.",
      icon: <IconFileText size={24} />,
    },
  ],
  cta: {
    text: "Explore the Ecosystem",
    href: "/ecosystem",
  },
};
