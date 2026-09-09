import type { Metadata } from "next";
import Link from "next/link";
import {
  IconBuildingCommunity,
  IconCircleCheck,
  IconTrendingUp,
  IconUsers,
  IconShieldCheck,
  IconCode,
  IconBrush,
  IconPhone,
} from "@tabler/icons-react";

import { Container } from "@/components/Container";
import { SectionTitle } from "@/components/SectionTitle";
import { Cta } from "@/components/Cta";

export const metadata: Metadata = {
  title: "Enterprise — Multi-Group Management Platform",
  description:
    "Manage portfolios of community groups from one account. Portfolio dashboards, multi-group reporting, API access and white-label branding.",
};

export default function EnterprisePage() {
  return (
    <>
      {/* Hero */}
      <Container className="mb-16 pt-12 lg:pt-20">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-sm font-bold uppercase tracking-wider text-brand-600">Enterprise</p>
          <h1 className="mt-3 text-4xl font-bold leading-tight tracking-tight text-brand-blue-900 dark:text-white lg:text-6xl">
            See the whole portfolio. Support every group.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-xl leading-8 text-gray-600 dark:text-gray-400">
            A shared operating view for NGOs, cooperatives, programmes and
            organizations managing many community groups.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              href="/contact"
              className="inline-flex min-h-12 items-center gap-2 rounded-md bg-brand-600 px-8 py-3 text-lg font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              Plan your portfolio
              <span aria-hidden="true">→</span>
            </Link>
            <Link
              href="/bookkeeper"
              className="inline-flex min-h-12 items-center gap-2 rounded-md border border-brand-600 px-8 py-3 text-lg font-semibold text-brand-700 transition-colors hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-brand-400 dark:text-brand-300 dark:hover:bg-trueGray-800"
            >
              See Bookkeeper
            </Link>
          </div>
        </div>
      </Container>

      {/* The Problem */}
      <SectionTitle
        preTitle="The Challenge"
        title="Managing many groups is complex"
      >
          How do you keep visibility across 10, 100, or 1000 groups without
          turning every group into a spreadsheet row? Enterprise keeps the
          portfolio visible while each group keeps its own committee, members
          and ledger.
      </SectionTitle>

      <Container className="mb-20">
        <div className="grid gap-6 border-y border-gray-200 py-8 dark:border-trueGray-700 md:grid-cols-3">
          {portfolioView.map((item) => (
            <div key={item.label}>
              <p className="text-sm font-semibold uppercase tracking-wider text-brand-600">{item.label}</p>
              <p className="mt-2 text-lg font-bold text-brand-blue-900 dark:text-white">{item.value}</p>
              <p className="mt-1 text-sm leading-6 text-gray-600 dark:text-gray-400">{item.description}</p>
            </div>
          ))}
        </div>
      </Container>

      {/* Core Features */}
      <Container className="mb-20">
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-12 text-center">
          Built for portfolio management
        </h2>
        <div className="grid md:grid-cols-2 gap-8">
          {coreFeatures.map((feature) => (
            <div
              key={feature.title}
              className="border border-gray-200 bg-gray-50 p-6 dark:border-trueGray-700 dark:bg-gray-800"
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

      {/* Scale & Complexity */}
      <Container className="mb-20 border-y border-brand-200 bg-brand-50 py-16 dark:border-brand-900 dark:bg-trueGray-800/60">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-12 text-center">
            Scales from small to massive
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            {scales.map((scale) => (
              <div key={scale.title} className="text-center">
                <div className="mb-2 text-5xl font-bold text-brand-700 dark:text-brand-300">
                  {scale.groups}
                </div>
                <p className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                  {scale.title}
                </p>
                <p className="text-gray-600 dark:text-gray-400 text-sm">
                  {scale.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </Container>

      {/* Features Detail */}
      <Container className="mb-20">
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-12 text-center">
          Enterprise capabilities
        </h2>
        <div className="space-y-8">
          {enterpriseFeatures.map((feature, idx) => (
            <div
              key={idx}
              className="border-l-4 border-brand-600 bg-gray-50 p-8 dark:bg-gray-800"
            >
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0">
                  {feature.icon}
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                    {feature.title}
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400 mb-3">{feature.description}</p>
                  <ul className="space-y-1 text-sm text-gray-600 dark:text-gray-400">
                    {feature.details.map((detail) => (
                      <li key={detail} className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 bg-indigo-600 dark:bg-indigo-400 rounded-full"></span>
                        {detail}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Container>

      {/* Who Uses Enterprise */}
      <Container className="mb-20">
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-12 text-center">
          Built for organizations like yours
        </h2>
        <div className="grid md:grid-cols-2 gap-6">
          {useCases.map((useCase) => (
            <div
              key={useCase.name}
              className="border border-gray-200 p-6 transition-colors hover:border-brand-300 dark:border-gray-700 dark:hover:border-brand-700"
            >
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                {useCase.name}
              </h3>
              <p className="text-gray-600 dark:text-gray-400 mb-4">{useCase.description}</p>
              <p className="text-sm text-indigo-600 dark:text-indigo-400 font-medium">
                Typical: {useCase.typical}
              </p>
            </div>
          ))}
        </div>
      </Container>

      {/* Pricing */}
      <Container className="mb-20 bg-brand-blue-900 py-16 text-white dark:bg-gray-950">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">Pricing by Agreement</h2>
          <p className="text-lg text-gray-400 mb-8">
            Enterprise pricing depends on the number of groups, features needed and scale of your portfolio.
            We work with you to find a pricing structure that makes sense for your organization.
          </p>
          <div className="grid md:grid-cols-3 gap-6 mt-8">
            <div>
              <p className="font-semibold text-indigo-400 mb-2">Typically Includes</p>
              <ul className="text-left text-sm text-gray-400 space-y-1">
                <li>✓ All Bookkeeper features</li>
                <li>✓ Portfolio dashboard</li>
                <li>✓ API access</li>
                <li>✓ White-label option</li>
                <li>✓ Dedicated support</li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-indigo-400 mb-2">Custom Options</p>
              <ul className="text-left text-sm text-gray-400 space-y-1">
                <li>✓ Custom PayBills</li>
                <li>✓ Integration API</li>
                <li>✓ Bulk reporting</li>
                <li>✓ Training programs</li>
                <li>✓ SLA guarantees</li>
              </ul>
            </div>
            <div>
              <p className="font-semibold text-indigo-400 mb-2">Flexible Models</p>
              <ul className="text-left text-sm text-gray-400 space-y-1">
                <li>✓ Per-group pricing</li>
                <li>✓ Flat portfolio rate</li>
                <li>✓ Volume discounts</li>
                <li>✓ Annual billing</li>
                <li>✓ Custom terms</li>
              </ul>
            </div>
          </div>
        </div>
      </Container>

      {/* Implementation */}
      <Container className="mb-20">
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-12 text-center">
          Smooth implementation
        </h2>
        <div className="max-w-3xl mx-auto space-y-6">
          {implementation.map((step, idx) => (
            <div key={idx} className="flex gap-4">
              <div className="flex-shrink-0">
                <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-indigo-600 text-white font-bold">
                  {idx + 1}
                </div>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {step.title}
                </h3>
                <p className="text-gray-600 dark:text-gray-400 mt-1">{step.description}</p>
              </div>
            </div>
          ))}
        </div>
      </Container>

      {/* Final CTA */}
      <Cta
        title="Let's talk about your portfolio"
        subtitle="We'll work with you to understand your needs and design an Enterprise solution that fits."
        note="From project scope to implementation to training — we handle the whole journey."
        footnote="Custom pricing · Flexible terms · Dedicated support"
        primary={{ text: "Schedule a Call", href: "/contact" }}
        secondary={{ text: "Talk to the team", href: "/contact" }}
      />
    </>
  );
}

const portfolioView = [
  {
    label: "Organization",
    value: "One accountable portfolio",
    description: "Set permissions, programmes and reporting expectations once.",
  },
  {
    label: "Group",
    value: "Independent day-to-day books",
    description: "Each committee keeps its own members, money and decisions.",
  },
  {
    label: "Member",
    value: "A record people can trust",
    description: "Drill from a portfolio figure to the group and member activity behind it.",
  },
];

const coreFeatures = [
  {
    title: "Portfolio Dashboard",
    description: "One view across all your groups. See total members, contributions, loans and impact at a glance.",
    icon: <IconBuildingCommunity size={24} className="text-indigo-600 dark:text-indigo-400" />,
  },
  {
    title: "Multi-Group Reporting",
    description: "Reports that roll up across groups, programs or regions. Built from actual group data, not summaries.",
    icon: <IconTrendingUp size={24} className="text-indigo-600 dark:text-indigo-400" />,
  },
  {
    title: "Team Access",
    description: "Staff accounts with role-based permissions. Each person sees only what they need.",
    icon: <IconUsers size={24} className="text-indigo-600 dark:text-indigo-400" />,
  },
  {
    title: "Custom PayBills",
    description: "Enterprise groups collect into their own PayBill, not the Kitabu Yetu one. Full control.",
    icon: <IconPhone size={24} className="text-indigo-600 dark:text-indigo-400" />,
  },
  {
    title: "API Access",
    description: "Connect Kitabu Yetu to your existing systems. Automated reporting, data sync, integrations.",
    icon: <IconCode size={24} className="text-indigo-600 dark:text-indigo-400" />,
  },
  {
    title: "White-Label Branding",
    description: "Your logo and colors. Groups see your organization's brand, not Kitabu Yetu.",
    icon: <IconBrush size={24} className="text-indigo-600 dark:text-indigo-400" />,
  },
];

const scales = [
  {
    groups: "10–50",
    title: "Small Networks",
    description: "Local networks and programs",
  },
  {
    groups: "50–500",
    title: "Growing Organizations",
    description: "Regional programs and initiatives",
  },
  {
    groups: "500+",
    title: "Large Portfolios",
    description: "National networks and movements",
  },
];

const enterpriseFeatures = [
  {
    title: "Portfolio Management",
    description: "Organize groups into programs, regions or categories. Report at any level.",
    icon: <IconBuildingCommunity size={24} className="text-indigo-600 dark:text-indigo-400" />,
    details: [
      "Unlimited groups and hierarchies",
      "Drill-down from portfolio to group to member",
      "Consolidated reporting",
      "Performance tracking across portfolio",
    ],
  },
  {
    title: "Advanced Reporting",
    description: "Reports that go beyond balance sheets. Analyze trends, compare groups, track impact.",
    icon: <IconTrendingUp size={24} className="text-indigo-600 dark:text-indigo-400" />,
    details: [
      "Real-time portfolio dashboards",
      "Custom report builder",
      "Automated report scheduling",
      "Multi-group analysis and benchmarking",
    ],
  },
  {
    title: "Team & Permissions",
    description: "Grant staff access to the groups they manage. Control exactly what they see.",
    icon: <IconUsers size={24} className="text-indigo-600 dark:text-indigo-400" />,
    details: [
      "Unlimited staff accounts",
      "Role-based access control",
      "Group-level permissions",
      "Audit trail of all staff actions",
    ],
  },
  {
    title: "Technical Integration",
    description: "Connect to your existing systems. Automate data sync and reporting.",
    icon: <IconCode size={24} className="text-indigo-600 dark:text-indigo-400" />,
    details: [
      "REST API access",
      "Webhook support for events",
      "Bulk import/export",
      "Custom integration support",
    ],
  },
];

const useCases = [
  {
    name: "NGOs & Development Organizations",
    description: "Manage groups in VSLA, microfinance or community development programs.",
    typical: "50–500 groups",
  },
  {
    name: "Cooperative Networks",
    description: "Oversight of member cooperatives with consolidated reporting to leadership.",
    typical: "100–1000+ coops",
  },
  {
    name: "Government & Donor Programs",
    description: "Funded programs spanning multiple groups, regions or beneficiary populations.",
    typical: "100–5000 groups",
  },
  {
    name: "Faith-Based Organizations",
    description: "Manage savings groups, welfare circles, or development programs in congregations.",
    typical: "10–100 groups",
  },
  {
    name: "Social Enterprises",
    description: "Track impact of group-based social programs with accountability to investors.",
    typical: "50–500 groups",
  },
  {
    name: "Financial Institutions",
    description: "Partner with groups for financial inclusion, credit guarantees, or savings programs.",
    typical: "500–5000+ groups",
  },
];

const implementation = [
  {
    title: "Discovery & Scoping",
    description: "We understand your portfolio structure, workflows and goals. Together we design the solution.",
  },
  {
    title: "Setup & Configuration",
    description: "We configure Kitabu Yetu for your organization. Branding, PayBills, permissions and integrations.",
  },
  {
    title: "Data Migration",
    description: "Bring existing group data from spreadsheets or other systems. We handle the technical heavy lifting.",
  },
  {
    title: "Staff Training",
    description: "Your team learns to use the platform. Tailored training on the features your staff needs.",
  },
  {
    title: "Go Live & Support",
    description: "Launch with confidence. Dedicated support through the first months and beyond.",
  },
];
