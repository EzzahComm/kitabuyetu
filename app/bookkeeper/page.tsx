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
  IconHomeHeart,
  IconHeartHandshake,
  IconBuildingBank,
  IconPlant2,
  IconClipboardList,
  IconCoins,
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
} from "@/types/enums";

import benefitImg from "../../public/img/bookkeeper.jpg";

export const metadata: Metadata = {
  title: "Kitabu Yetu Bookkeeper — Group Financial Management",
  description:
    "Digital bookkeeping for chamas, SACCOs, welfare groups and investment clubs. Collect by M-Pesa, reconcile every shilling, and keep an audit-ready double-entry book.",
};

/**
 * Kitabu Yetu Bookkeeper — the flagship product page.
 *
 * Built out from the UI template's layout, but three things in that template
 * are deliberately NOT reproduced here:
 *
 *  1. Its "5,000+ groups / KES 50B+ tracked annually" stat band. Those numbers
 *     are not real, and a made-up traction claim on a page selling a financial
 *     product is the kind of thing that has to be true before it is printed.
 *  2. Its hand-typed pricing table, which invented member caps ("Up to 500
 *     members") and SMS quotas that no plan actually enforces. Prices, SMS
 *     allowances and per-tier bullets are all read from types/enums.ts, the
 *     same table the billing page and the M-Pesa callback price against —
 *     see PLAN_COPY's own note on why that list exists.
 *  3. Its "isolated databases per group" security claim. Tenant isolation here
 *     is Postgres row-level security inside one database, which is a different
 *     (and accurately describable) thing.
 */
export default function BookkeeperPage() {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <SiteHeader />
      <main id="main" className="flex-1">
        <Container className="mb-20 pt-28 md:pt-36">
          <div className="mx-auto max-w-3xl text-center">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.24em] text-brand-700">
              Bookkeeper
            </p>
            <h1 className="mt-5 font-display text-[2.25rem] font-light leading-[1.05] tracking-tight text-brand-blue-900 sm:text-5xl lg:text-6xl">
              The group book that keeps every shilling{" "}
              <em className="font-normal italic text-brand-600">visible</em>.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-brand-blue-900/65">
              Move from notebooks and spreadsheets to a double-entry record for
              members, contributions, savings, loans, welfare, shares and M-Pesa.
            </p>
            <div className="mt-9 flex flex-wrap justify-center gap-3">
              <Link
                href={signUpUrl("kitabu_yetu")}
                className="inline-flex items-center gap-2 rounded-md bg-brand-600 px-7 py-3 text-base font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
              >
                Start with Bookkeeper
              </Link>
              <Link
                href="/how-it-works"
                className="inline-flex items-center gap-2 rounded-md border border-brand-blue-900/15 px-7 py-3 text-base font-medium text-brand-blue-900 transition-colors hover:bg-brand-blue-900/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
              >
                See how it works
              </Link>
            </div>
          </div>
        </Container>

        <SectionTitle
          preTitle="Features"
          title="Everything for managing a group's finances"
        >
          A complete system for members, money, contributions, loans and reporting.
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

        <Benefits data={manageMoney} />

        <SectionTitle preTitle="Pricing" title="Simple, transparent pricing">
          SMS included in every plan. Start small, grow with us.
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
            Who uses Bookkeeper?
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

        <Container className="mb-20">
          <div className="rounded-2xl bg-brand-blue-900 p-8 text-white md:p-12">
            <div className="mx-auto max-w-2xl text-center">
              <IconPhone size={48} aria-hidden="true" className="mx-auto mb-4 text-brand-400" />
              <h2 className="mb-4 font-display text-3xl font-light tracking-tight">
                Built for M-Pesa
              </h2>
              <p className="mb-6 text-lg leading-relaxed text-white/70">
                Bookkeeper plans include Safaricom Daraja integration — PayBill
                collections, STK prompts and B2C payouts.
              </p>
              <div className="mt-8 grid gap-6 md:grid-cols-3">
                <div>
                  <p className="mb-2 font-semibold text-brand-400">Collections</p>
                  <p className="text-sm text-white/65">
                    PayBill and STK push to member phones
                  </p>
                </div>
                <div>
                  <p className="mb-2 font-semibold text-brand-400">Matching</p>
                  <p className="text-sm text-white/65">
                    Payments matched to members by membership number
                  </p>
                </div>
                <div>
                  <p className="mb-2 font-semibold text-brand-400">Payouts</p>
                  <p className="text-sm text-white/65">
                    Loans, welfare and dividends by B2C
                  </p>
                </div>
              </div>
            </div>
          </div>
        </Container>

        <Cta
          title="Ready to digitize your group?"
          subtitle="Bring your members, money and records together."
          note="Not sure where to start? Tell us about your group and we'll recommend the right plan."
          footnote="No lock-in period · Pay by M-Pesa · Built for Kenyan groups"
          primary={{ text: "Get started with Bookkeeper", href: signUpUrl("kitabu_yetu") }}
          secondary={{ text: "Talk to us", href: "/contact" }}
        />
      </main>
      <SiteFooter />
    </div>
  );
}

const coreFeatures = [
  {
    title: "Member register",
    description:
      "Names, contacts, roles, status and membership history. One source of truth for who is in the group and what they owe.",
    icon: <IconUsers size={24} />,
  },
  {
    title: "Financial tracking",
    description:
      "Contributions, savings, loans, welfare, shares, dividends, investments and expenses, all posting to one double-entry ledger that has to balance.",
    icon: <IconCash size={24} />,
  },
  {
    title: "M-Pesa integration",
    description:
      "PayBill collections, STK push, payment matching and reconciliation. A payment that cannot be matched waits in a queue for a human rather than being guessed at.",
    icon: <IconPhone size={24} />,
  },
  {
    title: "Reporting",
    description:
      "Trial balance, income statement, balance sheet and member statements — generated from the ledger, not re-keyed into a spreadsheet.",
    icon: <IconFileText size={24} />,
  },
  {
    title: "Loan management",
    description:
      "Applications, approvals, disbursement, repayment schedules, interest and arrears, with the repayment posting back to the same books.",
    icon: <IconTrendingUp size={24} />,
  },
  {
    title: "Access control and audit trail",
    description:
      "Every group's data is isolated by row-level security in the database, roles decide who can see and do what, and money actions leave an audit trail.",
    icon: <IconLock size={24} />,
  },
];

const manageMoney = {
  title: "Manage your money with confidence",
  desc: "From the first member to the first dividend, everything your group needs to keep an account it can defend.",
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

/**
 * Plans are derived, never typed: label and bullets from PLAN_COPY, price from
 * PLAN_MONTHLY_FEES, SMS from PLAN_SMS_ALLOWANCE. Enterprise is negotiated, so
 * it shows "By agreement" rather than the 0 that sits in the fee table.
 */
const plans = PLAN_COPY.kitabu_yetu.map((plan) => {
  const selfServe = SELF_SERVE_PLANS.includes(plan.type);
  const fee = PLAN_MONTHLY_FEES.kitabu_yetu[plan.type];
  const sms = PLAN_SMS_ALLOWANCE.kitabu_yetu[plan.type];

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
    ctaHref: selfServe ? signUpUrl("kitabu_yetu") : "/contact",
  };
});

const useCases = [
  {
    name: "Savings groups (chamas)",
    description:
      "Monthly contributions, loan cycles and dividend distribution for savings-based groups.",
    icon: <IconCoins size={32} />,
  },
  {
    name: "VSLAs",
    description:
      "Village savings and loan associations tracking member cycles, share-outs and group funds.",
    icon: <IconHomeHeart size={32} />,
  },
  {
    name: "Welfare groups",
    description:
      "Welfare contributions, claims, beneficiaries and payouts, with a record of who was paid what.",
    icon: <IconHeartHandshake size={32} />,
  },
  {
    name: "Cooperatives",
    description:
      "Member shares, share capital, dividends and member equity across a growing membership.",
    icon: <IconBuildingBank size={32} />,
  },
  {
    name: "CBOs",
    description:
      "Community-based organizations tracking projects, funding received and what it was spent on.",
    icon: <IconPlant2 size={32} />,
  },
  {
    name: "Associations",
    description:
      "Professional and community associations managing member records, dues and group funds.",
    icon: <IconClipboardList size={32} />,
  },
];
