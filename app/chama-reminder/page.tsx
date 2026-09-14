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
import { SiteHeader } from "@/components/marketing/site-header";
import { SiteFooter } from "@/components/marketing/site-footer";
import { signUpUrl } from "@/lib/app-links";
import {
  PLAN_MONTHLY_FEES,
  PLAN_SMS_ALLOWANCE,
  PLAN_COPY,
  SELF_SERVE_PLANS,
  PRODUCT_LABEL,
} from "@/types/enums";

import benefitImg from "../../public/img/chama-reminder.jpg";

export const metadata: Metadata = {
  title: "Chama Reminder — SMS Communication for Groups",
  description:
    "Remind. Inform. Celebrate. Mobilize. Automated SMS reminders and announcements for chamas, welfare groups and SACCOs.",
};

/**
 * Chama Reminder — the communication-only product. Separate purchase from
 * Bookkeeper, with its own pricing tier. No accounting setup, just a member
 * list and scheduled SMS.
 *
 * Pricing reads from PLAN_COPY and PLAN_MONTHLY_FEES; no hand-typed member
 * caps or SMS quotas (see /bookkeeper's note on why).
 */
export default function ChamaReminderPage() {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <SiteHeader />
      <main id="main" className="flex-1">
        <Container className="mb-20 pt-28 md:pt-36">
          <div className="mx-auto max-w-3xl text-center">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.24em] text-brand-700">
              Chama Reminder
            </p>
            <h1 className="mt-5 font-display text-[2.25rem] font-light leading-[1.05] tracking-tight text-brand-blue-900 sm:text-5xl lg:text-6xl">
              Keep the group moving <em className="font-normal italic text-brand-600">between meetings</em>.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-brand-blue-900/65">
              Contribution reminders, meeting notices, payment confirmations and
              announcements from one member list, with no accounting setup
              needed.
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <Link
                href={signUpUrl("chama_reminder")}
                className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-7 py-3 text-base font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
              >
                Start with Chama Reminder
              </Link>
              <Link
                href="/bookkeeper"
                className="inline-flex items-center gap-2 rounded-md border border-brand-blue-900/15 px-7 py-3 text-base font-medium text-brand-blue-900 transition-colors hover:bg-brand-blue-900/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
              >
                Explore Bookkeeper
              </Link>
            </div>
          </div>
        </Container>

        <SectionTitle
          preTitle="Features"
          title="Everything for group communication"
        >
          Member management and SMS messaging, without the accounting complexity.
        </SectionTitle>

        <Container className="mb-20">
          <div className="grid gap-6 md:grid-cols-2">
            {coreFeatures.map((feature) => (
              <div
                key={feature.title}
                className="rounded-lg border border-brand-blue-900/10 bg-paper-deep p-6"
              >
                <div className="flex items-start gap-4">
                  <div className="mt-0.5 shrink-0 text-brand-600">{feature.icon}</div>
                  <div>
                    <h3 className="mb-2 text-xl font-semibold text-brand-blue-900">
                      {feature.title}
                    </h3>
                    <p className="leading-relaxed text-brand-blue-900/65">
                      {feature.description}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Container>

        <Benefits data={keepMembersInformed} />

        <Container className="mb-20 rounded-2xl bg-brand-50/40 p-8 md:p-12">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="mb-4 font-display text-3xl font-light tracking-tight text-brand-blue-900">
              Start with messaging, grow to full accounting
            </h2>
            <p className="mb-8 text-lg leading-relaxed text-brand-blue-900/65">
              Chama Reminder is perfect for groups that only need to reach members.
              Upgrade to Bookkeeper whenever your group is ready — everything comes with you.
            </p>
            <div className="mt-8 grid gap-6 md:grid-cols-2">
              <div className="text-left">
                <h3 className="mb-3 font-semibold text-brand-700">
                  Start here (Chama Reminder)
                </h3>
                <ul className="space-y-2 text-sm text-brand-blue-900/65">
                  <li>✓ Member list &amp; contacts</li>
                  <li>✓ SMS campaigns &amp; reminders</li>
                  <li>✓ No accounting</li>
                  <li>✓ Lower cost entry point</li>
                </ul>
              </div>
              <div className="text-left">
                <h3 className="mb-3 font-semibold text-brand-700">
                  Grow here (Kitabu Yetu)
                </h3>
                <ul className="space-y-2 text-sm text-brand-blue-900/65">
                  <li>✓ Add Bookkeeper accounting</li>
                  <li>✓ Members &amp; history carry over</li>
                  <li>✓ All messaging features stay</li>
                  <li>✓ Pay-as-you-go upgrade</li>
                </ul>
              </div>
            </div>
          </div>
        </Container>

        <SectionTitle preTitle="Pricing" title="Affordable messaging plans">
          SMS included in every plan. Add more anytime with top-up credits.
        </SectionTitle>

        <Container className="mb-20">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {plans.map((plan) => (
              <div
                key={plan.label}
                className={
                  plan.featured
                    ? "flex flex-col rounded-lg border-2 border-brand-600 bg-brand-50/60 p-6"
                    : "flex flex-col rounded-lg border border-brand-blue-900/12 p-6"
                }
              >
                <div>
                  <h3 className="text-xl font-semibold text-brand-blue-900">
                    {plan.label}
                  </h3>
                  {plan.featured && (
                    <p className="mt-1 text-sm font-semibold text-brand-700">
                      Most popular
                    </p>
                  )}
                </div>

                <div className="my-4">
                  <p className="font-display text-3xl font-normal text-brand-blue-900">
                    {plan.price}
                  </p>
                  {plan.period && (
                    <p className="mt-1 text-sm text-brand-blue-900/55">{plan.period}</p>
                  )}
                </div>

                <p className="mb-6 text-sm text-brand-blue-900/65">{plan.sms}</p>

                <ul className="mb-6 flex-grow space-y-3">
                  {plan.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-2 text-sm text-brand-blue-900/70"
                    >
                      <IconCircleCheck
                        size={18}
                        aria-hidden="true"
                        className="mt-0.5 shrink-0 text-brand-600"
                      />
                      {feature}
                    </li>
                  ))}
                </ul>

                <Link
                  href={plan.ctaHref}
                  className={
                    plan.featured
                      ? "w-full rounded-md bg-brand-600 px-4 py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-brand-700"
                      : "w-full rounded-md border border-brand-blue-900/15 px-4 py-2.5 text-center text-sm font-semibold text-brand-blue-900 transition-colors hover:bg-brand-blue-900/[0.04]"
                  }
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
          <p className="mt-6 text-center text-sm text-brand-blue-900/55">
            Every plan is paid and bought self-service by M-Pesa. See{" "}
            <Link href="/pricing" className="font-medium text-brand-700 hover:underline">
              full pricing
            </Link>{" "}
            for both products side by side.
          </p>
        </Container>

        <Container className="mb-20">
          <h2 className="mb-12 text-center font-display text-3xl font-light tracking-tight text-brand-blue-900">
            Perfect for groups that need to reach members
          </h2>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {useCases.map((useCase) => (
              <div
                key={useCase.name}
                className="rounded-lg border border-brand-blue-900/10 p-6 transition-shadow hover:shadow-md"
              >
                <div className="mb-3 text-brand-600">{useCase.icon}</div>
                <h3 className="mb-2 text-lg font-semibold text-brand-blue-900">
                  {useCase.name}
                </h3>
                <p className="leading-relaxed text-brand-blue-900/65">
                  {useCase.description}
                </p>
              </div>
            ))}
          </div>
        </Container>

        <Cta
          title="Connect with your group"
          subtitle="Simple SMS messaging for groups that just need to reach members."
          note="Move to Kitabu Yetu anytime to add accounting — no re-setup needed."
          footnote="No lock-in period · Pay by M-Pesa · Free migration to Bookkeeper"
          primary={{
            text: "Get started with Chama Reminder",
            href: signUpUrl("chama_reminder"),
          }}
          secondary={{ text: "Compare with Bookkeeper", href: "/bookkeeper" }}
        />
      </main>
      <SiteFooter />
    </div>
  );
}

const coreFeatures = [
  {
    title: "Member list",
    description:
      "Names, phone numbers and groups in one place. Ready to message without rebuilding the list every time.",
    icon: <IconUsers size={24} />,
  },
  {
    title: "SMS campaigns",
    description:
      "One-time messages or scheduled campaigns. Send to individuals, groups or the whole membership.",
    icon: <IconMessages size={24} />,
  },
  {
    title: "Message templates",
    description:
      "Create templates with variables (name, amount, date) and reuse them for consistency.",
    icon: <IconBell size={24} />,
  },
  {
    title: "Scheduled reminders",
    description:
      "Set messages to go out at specific times. Contribution reminders, meeting notices, birthday greetings.",
    icon: <IconClock size={24} />,
  },
  {
    title: "Delivery tracking",
    description:
      "See which messages were delivered, read failure reports and retry failed sends.",
    icon: <IconCircleCheck size={24} />,
  },
  {
    title: "Simple pricing",
    description:
      "Pay once. Monthly SMS allowance included. Buy top-ups only when you need them.",
    icon: <IconTrendingUp size={24} />,
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

/**
 * Plans derived from canonical sources, not hand-typed.
 */
const plans = PLAN_COPY.chama_reminder.map((plan) => {
  const selfServe = SELF_SERVE_PLANS.includes(plan.type);
  const fee = PLAN_MONTHLY_FEES.chama_reminder[plan.type];
  const sms = PLAN_SMS_ALLOWANCE.chama_reminder[plan.type];

  return {
    label: plan.label,
    price: selfServe ? `KES ${fee.toLocaleString()}` : "By agreement",
    period: selfServe ? "/month" : "",
    sms: selfServe
      ? `${sms.toLocaleString()} SMS included`
      : "SMS allowance by agreement",
    featured: plan.type === "growth",
    features: plan.features,
    cta: selfServe ? "Get started" : "Contact us",
    ctaHref: selfServe ? signUpUrl("chama_reminder") : "/contact",
  };
});

const useCases = [
  {
    name: "Contribution reminders",
    description:
      "Remind members when contributions are due. Automatic or scheduled messages.",
    icon: "📱",
  },
  {
    name: "Birthday greetings",
    description:
      "Celebrate members with automated birthday SMS messages on their special day.",
    icon: "🎂",
  },
  {
    name: "Meeting notices",
    description:
      "Send meeting schedules, venues and agenda to all members at once.",
    icon: "📅",
  },
  {
    name: "Payment confirmations",
    description:
      "Confirm receipt of payments and balance updates to members immediately.",
    icon: "✅",
  },
  {
    name: "Group announcements",
    description:
      "Share important news, policy changes and opportunities with the group.",
    icon: "📢",
  },
  {
    name: "Loan reminders",
    description:
      "Notify loan recipients about repayment schedules and due dates.",
    icon: "💳",
  },
];
