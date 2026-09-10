import type { Metadata } from "next";
import Link from "next/link";
import {
  IconMessages,
  IconCalendarDot,
  IconUsers,
  IconPhone,
  IconCircleCheck,
  IconTrendingUp,
  IconBell,
  IconClock,
} from "@tabler/icons-react";

import { Container } from "@/components/Container";
import { SectionTitle } from "@/components/SectionTitle";
import { Benefits } from "@/components/Benefits";
import { Cta } from "@/components/Cta";
import { signUpUrl } from "@/lib/app-links";

import benefitImg from "../../../public/img/chama-reminder.jpg";

export const metadata: Metadata = {
  title: "Chama Reminder — SMS Communication for Groups",
  description:
    "Keep members connected with SMS reminders, birthday greetings, and group announcements. Simple messaging platform for community groups.",
};

export default function ChamaReminderPage() {
  return (
    <>
      {/* Hero */}
      <Container className="mb-20 pt-20">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-sm font-bold uppercase tracking-wider text-brand-600">Chama Reminder</p>
          <h1 className="mt-3 text-4xl font-bold leading-tight tracking-tight text-gray-900 dark:text-white lg:text-6xl">
            Keep the group moving between meetings.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-xl leading-8 text-gray-600 dark:text-gray-400">
            Contribution reminders, meeting notices, payment confirmations and
            announcements from one member list, with no accounting setup needed.
          </p>
          <div className="flex gap-4 justify-center flex-wrap">
            <Link
              href={signUpUrl("chama_reminder")}
              className="inline-flex items-center gap-2 px-8 py-3 text-lg font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Start with Chama Reminder
              <span>→</span>
            </Link>
            <Link
              href="/bookkeeper"
              className="inline-flex items-center gap-2 px-8 py-3 text-lg font-semibold text-indigo-600 border-2 border-indigo-600 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
            >
              Explore Bookkeeper
            </Link>
          </div>
        </div>
      </Container>

      {/* Core Features */}
      <SectionTitle
        preTitle="Features"
        title="Everything for group communication"
      >
        Member management and SMS messaging, without the accounting complexity.
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
      <Benefits data={keepMembersInformed} />

      {/* Why Chama Reminder */}
      <Container className="mb-20 py-20 bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-gray-900 dark:to-gray-800 rounded-2xl">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
            Start with messaging, grow to full accounting
          </h2>
          <p className="text-lg text-gray-600 dark:text-gray-400 mb-8">
            Chama Reminder is perfect for groups that only need to reach members.
            Upgrade to Kitabu Yetu whenever your group is ready — everything comes with you.
          </p>
          <div className="grid md:grid-cols-2 gap-6 mt-8">
            <div className="text-left">
              <h3 className="font-semibold text-indigo-600 dark:text-indigo-400 mb-3">
                Start Here (Chama Reminder)
              </h3>
              <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                <li>✓ Member list & contacts</li>
                <li>✓ SMS campaigns & reminders</li>
                <li>✓ No accounting</li>
                <li>✓ Lower cost entry point</li>
              </ul>
            </div>
            <div className="text-left">
              <h3 className="font-semibold text-indigo-600 dark:text-indigo-400 mb-3">
                Grow Here (Kitabu Yetu)
              </h3>
              <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                <li>✓ Add Bookkeeper accounting</li>
                <li>✓ Members & history carry over</li>
                <li>✓ All messaging features stay</li>
                <li>✓ Pay-as-you-go upgrade</li>
              </ul>
            </div>
          </div>
        </div>
      </Container>

      {/* Pricing Section */}
      <SectionTitle
        preTitle="Pricing"
        title="Affordable messaging plans"
      >
        SMS included in every plan. Add more anytime with top-up credits.
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
          Perfect for groups that need to reach members
        </h2>
        <div className="grid md:grid-cols-3 gap-6">
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

      {/* Final CTA */}
      <Cta
        title="Connect with your group"
        subtitle="Simple SMS messaging for groups that just need to reach members."
        note="Move to Kitabu Yetu anytime to add accounting — no re-setup needed."
        footnote="No lock-in period · Pay by M-Pesa · Free migration to Bookkeeper"
        primary={{ text: "Get Started with Chama Reminder", href: signUpUrl("chama_reminder") }}
        secondary={{ text: "Compare with Bookkeeper", href: "/bookkeeper" }}
      />
    </>
  );
}

const coreFeatures = [
  {
    title: "Member List",
    description: "Names, phone numbers and groups in one place. Ready to message without rebuilding the list every time.",
    icon: <IconUsers size={24} className="text-indigo-600 dark:text-indigo-400" />,
  },
  {
    title: "SMS Campaigns",
    description: "One-time messages or scheduled campaigns. Send to individuals, groups or the whole membership.",
    icon: <IconMessages size={24} className="text-indigo-600 dark:text-indigo-400" />,
  },
  {
    title: "Message Templates",
    description: "Create templates with variables (name, amount, date) and reuse them for consistency.",
    icon: <IconBell size={24} className="text-indigo-600 dark:text-indigo-400" />,
  },
  {
    title: "Scheduled Reminders",
    description: "Set messages to go out at specific times. Contribution reminders, meeting notices, birthday greetings.",
    icon: <IconClock size={24} className="text-indigo-600 dark:text-indigo-400" />,
  },
  {
    title: "Delivery Tracking",
    description: "See which messages were delivered, read failure reports and retry failed sends.",
    icon: <IconCircleCheck size={24} className="text-indigo-600 dark:text-indigo-400" />,
  },
  {
    title: "Simple Pricing",
    description: "Pay once. Monthly SMS allowance included. Buy top-ups only when you need them.",
    icon: <IconTrendingUp size={24} className="text-indigo-600 dark:text-indigo-400" />,
  },
];

const keepMembersInformed = {
  title: "Keep members in the loop",
  desc: "Reminders that go out on time, messages that reach everyone, and a member list you control.",
  image: benefitImg,
  bullets: [
    {
      title: "A member list that is yours",
      desc: "Names, numbers and groups in one place, ready to message without rebuilding every time.",
      icon: <IconUsers size={24} />,
    },
    {
      title: "Reminders that go out on time",
      desc: "Scheduled campaigns and message templates, so the reminder doesn't depend on someone remembering.",
      icon: <IconClock size={24} />,
    },
    {
      title: "Move to Bookkeeper when ready",
      desc: "Buy a Kitabu Yetu plan and your chart of accounts is set up; group, members and message history carry over.",
      icon: <IconTrendingUp size={24} />,
    },
  ],
};

const pricingPlans = [
  {
    name: "Starter",
    price: "KES 100",
    period: "/month",
    sms: "100 SMS included",
    featured: false,
    features: [
      "Up to 500 members",
      "SMS campaigns",
      "Scheduled messages",
      "Delivery reports",
    ],
    cta: "Get Started",
    ctaHref: signUpUrl("chama_reminder"),
  },
  {
    name: "Growth",
    price: "KES 250",
    period: "/month",
    sms: "200 SMS included",
    featured: true,
    features: [
      "Up to 2,000 members",
      "All Starter features",
      "Message templates",
      "Bulk campaigns",
      "Birthday automation",
    ],
    cta: "Get Started",
    ctaHref: signUpUrl("chama_reminder"),
  },
  {
    name: "Premium",
    price: "KES 400",
    period: "/month",
    sms: "300 SMS included",
    featured: false,
    features: [
      "Unlimited members",
      "All Growth features",
      "Custom sender ID",
      "Priority support",
      "Analytics",
    ],
    cta: "Get Started",
    ctaHref: signUpUrl("chama_reminder"),
  },
  {
    name: "Enterprise",
    price: "By agreement",
    period: "",
    sms: "Custom SMS allowance",
    featured: false,
    features: [
      "All Premium features",
      "Multiple sender IDs",
      "API access",
      "Custom integrations",
      "Dedicated support",
    ],
    cta: "Contact Us",
    ctaHref: "/contact",
  },
];

const useCases = [
  {
    name: "Contribution Reminders",
    description: "Remind members when contributions are due. Automatic or scheduled messages.",
    icon: "📱",
  },
  {
    name: "Birthday Greetings",
    description: "Celebrate members with automated birthday SMS messages on their special day.",
    icon: "🎂",
  },
  {
    name: "Meeting Notices",
    description: "Send meeting schedules, venues and agenda to all members at once.",
    icon: "📅",
  },
  {
    name: "Payment Confirmations",
    description: "Confirm receipt of payments and balance updates to members immediately.",
    icon: "✅",
  },
  {
    name: "Group Announcements",
    description: "Share important news, policy changes and opportunities with the group.",
    icon: "📢",
  },
  {
    name: "Loan Reminders",
    description: "Notify loan recipients about repayment schedules and due dates.",
    icon: "💳",
  },
];
