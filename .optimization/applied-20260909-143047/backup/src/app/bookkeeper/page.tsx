import type { Metadata } from "next";
import Link from "next/link";
import {
  IconCash,
  IconPhone,
  IconBook,
  IconUsers,
  IconTrendingUp,
  IconFileText,
  IconLock,
  IconCircleCheck,
} from "@tabler/icons-react";

import { Hero } from "@/components/Hero";
import { Container } from "@/components/Container";
import { SectionTitle } from "@/components/SectionTitle";
import { Benefits } from "@/components/Benefits";
import { Cta } from "@/components/Cta";
import { signUpUrl } from "@/lib/app-links";

import benefitImg from "../../../public/img/bookkeeper.jpg";

export const metadata: Metadata = {
  title: "Kitabu Yetu Bookkeeper — Group Financial Management",
  description:
    "The complete accounting platform for community groups. Track members, contributions, loans, welfare, M-Pesa payments and more on a double-entry ledger.",
};

export default function BookkeeperPage() {
  return (
    <>
      {/* Custom Hero for Bookkeeper */}
      <Container className="mb-20 pt-20">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-sm font-bold uppercase tracking-wider text-brand-600">Bookkeeper</p>
          <h1 className="mt-3 text-4xl font-bold leading-tight tracking-tight text-gray-900 dark:text-white lg:text-6xl">
            The group book that keeps every shilling visible.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-xl leading-8 text-gray-600 dark:text-gray-400">
            Move from notebooks and spreadsheets to a double-entry record for
            members, contributions, savings, loans, welfare, shares and M-Pesa.
          </p>
          <div className="flex gap-4 justify-center flex-wrap">
            <Link
              href={signUpUrl("kitabu_yetu")}
              className="inline-flex items-center gap-2 px-8 py-3 text-lg font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Start with Bookkeeper
              <span>→</span>
            </Link>
            <Link
              href="/how-it-works"
              className="inline-flex items-center gap-2 px-8 py-3 text-lg font-semibold text-indigo-600 border-2 border-indigo-600 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
            >
              See How It Works
            </Link>
          </div>
        </div>
      </Container>

      {/* Core Features */}
      <SectionTitle
        preTitle="Features"
        title="Everything for managing a group's finances"
      >
        A complete system for members, money, contributions, loans and reporting.
      </SectionTitle>

      <Container className="mb-20">
        <div className="grid md:grid-cols-2 gap-8">
          {coreFeatures.map((feature) => (
            <div
              key={feature.title}
              className="p-6 bg-gray-50 dark:bg-gray-800 rounded-lg"
            >
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 mt-1">
                  {feature.icon}
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                    {feature.title}
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400">
                    {feature.description}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Container>

      {/* Benefits Section */}
      <Benefits data={manageMoney} />

      <Container className="mb-20 py-20 bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-gray-900 dark:to-gray-800 rounded-2xl">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
            Why groups choose Kitabu Yetu
          </h2>
          <p className="text-lg text-gray-600 dark:text-gray-400 mb-12">
            More than 5,000 groups across East Africa manage their finances with Kitabu Yetu.
          </p>
          <div className="grid md:grid-cols-3 gap-8">
            {whyChooseUs.map((item) => (
              <div key={item.title}>
                <div className="text-4xl font-bold text-indigo-600 dark:text-indigo-400 mb-2">
                  {item.stat}
                </div>
                <p className="text-gray-600 dark:text-gray-400">{item.title}</p>
              </div>
            ))}
          </div>
        </div>
      </Container>

      {/* Pricing Section */}
      <SectionTitle
        preTitle="Pricing"
        title="Simple, transparent pricing"
      >
        SMS included in every plan. Start small, grow with us.
      </SectionTitle>

      <Container className="mb-20">
        <div className="grid md:grid-cols-4 gap-6">
          {pricingPlans.map((plan) => (
            <div
              key={plan.name}
              className={`flex flex-col p-6 rounded-lg border-2 transition-all ${
                plan.featured
                  ? "border-indigo-600 bg-indigo-50 dark:bg-indigo-900/20 ring-2 ring-indigo-300 dark:ring-indigo-700"
                  : "border-gray-200 dark:border-gray-700"
              }`}
            >
              <div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-1">
                  {plan.name}
                </h3>
                {plan.featured && (
                  <p className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 mb-3">
                    Most Popular
                  </p>
                )}
              </div>

              <div className="my-4">
                <p className="text-3xl font-bold text-gray-900 dark:text-white">
                  {plan.price}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                  {plan.period}
                </p>
              </div>

              <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
                {plan.sms}
              </p>

              <ul className="space-y-3 mb-6 flex-grow">
                {plan.features.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-start gap-2 text-sm text-gray-600 dark:text-gray-400"
                  >
                    <IconCircleCheck
                      size={18}
                      className="flex-shrink-0 mt-0.5 text-indigo-600 dark:text-indigo-400"
                    />
                    {feature}
                  </li>
                ))}
              </ul>

              <Link
                href={plan.ctaHref}
                className={`w-full py-2 px-4 rounded-lg font-semibold text-center transition-colors ${
                  plan.featured
                    ? "bg-indigo-600 text-white hover:bg-indigo-700"
                    : "border-2 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-800"
                }`}
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>
      </Container>

      {/* Use Cases */}
      <Container className="mb-20">
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-12 text-center">
          Who uses Bookkeeper?
        </h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {useCases.map((useCase) => (
            <div
              key={useCase.name}
              className="p-6 border border-gray-200 dark:border-gray-700 rounded-lg hover:shadow-lg dark:hover:shadow-lg/20 transition-shadow"
            >
              <div className="text-4xl mb-3">{useCase.icon}</div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                {useCase.name}
              </h3>
              <p className="text-gray-600 dark:text-gray-400">{useCase.description}</p>
            </div>
          ))}
        </div>
      </Container>

      {/* Integration with M-Pesa */}
      <Container className="mb-20 p-8 bg-gray-900 dark:bg-gray-950 rounded-2xl text-white">
        <div className="max-w-2xl mx-auto text-center">
          <IconPhone size={48} className="mx-auto mb-4 text-indigo-400" />
          <h2 className="text-3xl font-bold mb-4">Built for M-Pesa</h2>
          <p className="text-lg text-gray-400 mb-6">
            Every Bookkeeper plan includes full Safaricom Daraja integration.
            PayBill collections, STK prompts, and B2C payouts all built in.
          </p>
          <div className="grid md:grid-cols-3 gap-6 mt-8">
            <div>
              <p className="font-semibold text-indigo-400 mb-2">Collections</p>
              <p className="text-gray-400 text-sm">PayBill and STK push to member phones</p>
            </div>
            <div>
              <p className="font-semibold text-indigo-400 mb-2">Matching</p>
              <p className="text-gray-400 text-sm">Payments matched to members automatically</p>
            </div>
            <div>
              <p className="font-semibold text-indigo-400 mb-2">Payouts</p>
              <p className="text-gray-400 text-sm">Loans, welfare, dividends by B2C</p>
            </div>
          </div>
        </div>
      </Container>

      {/* Final CTA */}
      <Cta
        title="Ready to digitize your group?"
        subtitle="Bring your members, money and records together."
        note="Not sure where to start? We'll help you set up in minutes."
        footnote="No lock-in period · Pay by M-Pesa · Built for Kenyan groups"
        primary={{ text: "Get Started with Bookkeeper", href: signUpUrl("kitabu_yetu") }}
        secondary={{ text: "Schedule a Demo", href: "/contact" }}
      />
    </>
  );
}

const coreFeatures = [
  {
    title: "Member Register",
    description: "Names, contacts, roles, status and membership history. One source of truth for who is in the group and their details.",
    icon: <IconUsers size={24} className="text-indigo-600 dark:text-indigo-400" />,
  },
  {
    title: "Financial Tracking",
    description: "Contributions, savings, loans, welfare, shares, dividends, investments and income all tracked in one double-entry ledger that has to balance.",
    icon: <IconCash size={24} className="text-indigo-600 dark:text-indigo-400" />,
  },
  {
    title: "M-Pesa Integration",
    description: "PayBill collections, STK push, payment matching and reconciliation. Money hits the group's records the moment it arrives.",
    icon: <IconPhone size={24} className="text-indigo-600 dark:text-indigo-400" />,
  },
  {
    title: "Reporting",
    description: "Trial balance, income statement, balance sheet, member statements and more. Reports straight from the ledger, not spreadsheets.",
    icon: <IconFileText size={24} className="text-indigo-600 dark:text-indigo-400" />,
  },
  {
    title: "Loan Management",
    description: "Loan products, applications, approvals, disbursement, repayment tracking, interest calculations and arrears management.",
    icon: <IconTrendingUp size={24} className="text-indigo-600 dark:text-indigo-400" />,
  },
  {
    title: "Data Security",
    description: "Encrypted servers, isolated databases per group, access controls and audit trails. Your group's records are yours alone.",
    icon: <IconLock size={24} className="text-indigo-600 dark:text-indigo-400" />,
  },
];

const manageMoney = {
  title: "Manage your money with confidence",
  desc: "From the first member to the first dividend, everything your group needs to grow financially.",
  image: benefitImg,
  bullets: [
    {
      title: "Members and their money",
      desc: "One register of members with their roles, contact information, membership history and complete financial activity.",
      icon: <IconUsers size={24} />,
    },
    {
      title: "M-Pesa in and out",
      desc: "PayBill and STK collections post against the right member; loans, welfare and dividends go out by B2C.",
      icon: <IconPhone size={24} />,
    },
    {
      title: "Close the month off the ledger",
      desc: "Statements, trial balance and member reports come straight from the books, and a closed period stops changing.",
      icon: <IconBook size={24} />,
    },
  ],
};

const whyChooseUs = [
  {
    stat: "5,000+",
    title: "Groups using Bookkeeper",
  },
  {
    stat: "KES 50B+",
    title: "Tracked annually",
  },
  {
    stat: "100%",
    title: "Data encrypted & isolated",
  },
];

const pricingPlans = [
  {
    name: "Starter",
    price: "KES 150",
    period: "/month",
    sms: "100 SMS included",
    featured: false,
    features: [
      "Up to 500 members",
      "Basic reporting",
      "M-Pesa integration",
      "Member statements",
    ],
    cta: "Get Started",
    ctaHref: signUpUrl("kitabu_yetu"),
  },
  {
    name: "Growth",
    price: "KES 300",
    period: "/month",
    sms: "200 SMS included",
    featured: true,
    features: [
      "Up to 2,000 members",
      "Advanced reporting",
      "Loan management",
      "Welfare module",
      "Full accounting",
    ],
    cta: "Get Started",
    ctaHref: signUpUrl("kitabu_yetu"),
  },
  {
    name: "Premium",
    price: "KES 500",
    period: "/month",
    sms: "300 SMS included",
    featured: false,
    features: [
      "Unlimited members",
      "All Growth features",
      "Investment tracking",
      "Priority support",
      "Custom reports",
    ],
    cta: "Get Started",
    ctaHref: signUpUrl("kitabu_yetu"),
  },
  {
    name: "Enterprise",
    price: "By agreement",
    period: "",
    sms: "Custom SMS allowance",
    featured: false,
    features: [
      "All Premium features",
      "Multiple PayBills",
      "Custom integrations",
      "API access",
      "Dedicated support",
    ],
    cta: "Contact Us",
    ctaHref: "/contact",
  },
];

const useCases = [
  {
    name: "Savings Groups (Chamas)",
    description: "Monthly contributions, loan cycles, and dividend management for savings-based groups.",
    icon: "💰",
  },
  {
    name: "VSLAs",
    description: "Village savings and loan associations tracking member cycles and group finances.",
    icon: "🏘️",
  },
  {
    name: "Welfare Groups",
    description: "Track welfare contributions, claims, beneficiaries and payouts with accountability.",
    icon: "❤️",
  },
  {
    name: "Cooperatives",
    description: "Manage member shares, dividends, share capital and member equity effectively.",
    icon: "🤝",
  },
  {
    name: "CBOs",
    description: "Community-based organizations tracking projects, funding and community impact.",
    icon: "🌱",
  },
  {
    name: "Associations",
    description: "Professional and community associations managing member records and funds.",
    icon: "📋",
  },
];
