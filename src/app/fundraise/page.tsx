import type { Metadata } from "next";
import Link from "next/link";
import {
  IconHeart,
  IconCircleCheck,
  IconTrendingUp,
  IconUsers,
  IconGift,
  IconTarget,
  IconWorld,
  IconShieldCheck,
} from "@tabler/icons-react";

import { Container } from "@/components/Container";
import { SectionTitle } from "@/components/SectionTitle";
import { Cta } from "@/components/Cta";
import { signUpUrl } from "@/lib/app-links";

export const metadata: Metadata = {
  title: "Fundraise / Changi$ha — Group Fundraising Platform",
  description:
    "Dedicated fundraising campaigns for groups, projects, and community initiatives. Track donations, send receipts, and manage fundraising goals.",
};

export default function FundraisePage() {
  return (
    <>
      {/* Hero */}
      <Container className="mb-20 pt-20">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-sm font-bold uppercase tracking-wider text-brand-600">Fundraise / Changi$ha</p>
          <h1 className="mt-3 text-4xl font-bold leading-tight tracking-tight text-gray-900 dark:text-white lg:text-6xl">
            Give every community project a clear campaign.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-xl leading-8 text-gray-600 dark:text-gray-400">
            Set a target, invite donors, track progress and keep campaign money
            separate from the group&apos;s ordinary contributions.
          </p>
          <div className="flex gap-4 justify-center flex-wrap">
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 px-8 py-3 text-lg font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
            >
              Create a campaign
              <span>→</span>
            </Link>
            <Link
              href="/bookkeeper"
              className="inline-flex items-center gap-2 px-8 py-3 text-lg font-semibold text-indigo-600 border-2 border-indigo-600 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
            >
              Learn More
            </Link>
          </div>
        </div>
      </Container>

      {/* Core Features */}
      <SectionTitle
        preTitle="Features"
        title="Everything for group fundraising"
      >
        Create campaigns, accept donations, track progress and send receipts.
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

      {/* How It Works */}
      <Container className="mb-20">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-12 text-center">
            How fundraising works
          </h2>
          <div className="space-y-8">
            {howItWorks.map((step, idx) => (
              <div key={idx} className="flex gap-6">
                <div className="flex-shrink-0">
                  <div className="flex items-center justify-center h-12 w-12 rounded-lg bg-indigo-600 text-white font-bold text-lg">
                    {idx + 1}
                  </div>
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                    {step.title}
                  </h3>
                  <p className="text-gray-600 dark:text-gray-400">{step.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Container>

      {/* Why Fundraise */}
      <Container className="mb-20 py-20 bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-gray-900 dark:to-gray-800 rounded-2xl">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
            Separated and accountable
          </h2>
          <p className="text-lg text-gray-600 dark:text-gray-400 mb-8">
            Money raised for a specific project needs its own record.
            Fundraise keeps campaign funds separated from regular group contributions.
          </p>
          <div className="grid md:grid-cols-2 gap-6 mt-8">
            <div className="text-left">
              <p className="font-semibold text-indigo-600 dark:text-indigo-400 mb-3">
                Without Fundraise
              </p>
              <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                <li>❌ Money mixed with regular contributions</li>
                <li>❌ Unclear what was for the project</li>
                <li>❌ Hard to report to donors</li>
                <li>❌ Reconciliation nightmare</li>
              </ul>
            </div>
            <div className="text-left">
              <p className="font-semibold text-indigo-600 dark:text-indigo-400 mb-3">
                With Fundraise
              </p>
              <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                <li>✅ Campaign has its own record</li>
                <li>✅ All donors visible in one place</li>
                <li>✅ Easy reporting to donors</li>
                <li>✅ Clear project accounting</li>
              </ul>
            </div>
          </div>
        </div>
      </Container>

      {/* Use Cases */}
      <Container className="mb-20">
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-12 text-center">
          Fundraising for community projects
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

      {/* Features Detail */}
      <Container className="mb-20">
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-12 text-center">
          Complete fundraising toolkit
        </h2>
        <div className="grid md:grid-cols-2 gap-12">
          <div>
            <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
              For Group Leaders
            </h3>
            <ul className="space-y-4">
              {leaderFeatures.map((feature) => (
                <li key={feature} className="flex items-start gap-3">
                  <IconCircleCheck size={24} className="text-indigo-600 dark:text-indigo-400 flex-shrink-0 mt-0.5" />
                  <span className="text-gray-600 dark:text-gray-400">{feature}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
              For Donors
            </h3>
            <ul className="space-y-4">
              {donorFeatures.map((feature) => (
                <li key={feature} className="flex items-start gap-3">
                  <IconCircleCheck size={24} className="text-indigo-600 dark:text-indigo-400 flex-shrink-0 mt-0.5" />
                  <span className="text-gray-600 dark:text-gray-400">{feature}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Container>

      {/* Final CTA */}
      <Cta
        title="Ready to fundraise?"
        subtitle="Create a campaign, set your target, and start receiving donations."
        note="Donors see a transparent view of where their money goes."
        footnote="M-Pesa integration · Transparent tracking · Easy receipts"
        primary={{ text: "Start Fundraising", href: "/contact" }}
        secondary={{ text: "See Pricing", href: "/pricing" }}
      />
    </>
  );
}

const coreFeatures = [
  {
    title: "Campaign Creation",
    description: "Set up a campaign with a target amount, description and deadline. Share it with your network.",
    icon: <IconTarget size={24} className="text-indigo-600 dark:text-indigo-400" />,
  },
  {
    title: "Donation Tracking",
    description: "See every donation as it arrives. Know who gave what and when. No guessing.",
    icon: <IconTrendingUp size={24} className="text-indigo-600 dark:text-indigo-400" />,
  },
  {
    title: "Donor Receipts",
    description: "Automatic receipts sent to donors via SMS or email. Professional and transparent.",
    icon: <IconCircleCheck size={24} className="text-indigo-600 dark:text-indigo-400" />,
  },
  {
    title: "Progress Tracking",
    description: "Show progress toward your goal. Update the campaign to keep donors engaged.",
    icon: <IconHeart size={24} className="text-indigo-600 dark:text-indigo-400" />,
  },
  {
    title: "M-Pesa Integration",
    description: "Accept donations via M-Pesa. Payments verified before posting to campaign record.",
    icon: <IconShieldCheck size={24} className="text-indigo-600 dark:text-indigo-400" />,
  },
  {
    title: "Transparent Reporting",
    description: "Easy reports for donors. Show what came in, what was spent, and the impact.",
    icon: <IconWorld size={24} className="text-indigo-600 dark:text-indigo-400" />,
  },
];

const howItWorks = [
  {
    title: "Create a campaign",
    description:
      "Name the project, set your fundraising target, add a description, and decide on a deadline. This becomes the campaign record.",
  },
  {
    title: "Share with your network",
    description:
      "Share the campaign with group members, friends and potential donors. Anyone can contribute, not just group members.",
  },
  {
    title: "Accept donations",
    description:
      "Donors pay via M-Pesa. Each payment is verified and matched to the campaign. No more hunting through messages.",
  },
  {
    title: "Send receipts",
    description:
      "Automatic receipts confirm the donation. Donors see the impact their money is making in real time.",
  },
  {
    title: "Track progress",
    description:
      "See your target, running total, and who contributed. Update the campaign with milestones and progress updates.",
  },
  {
    title: "Report transparently",
    description:
      "When the campaign ends, run a report. Donors see exactly what came in and how it was used.",
  },
];

const useCases = [
  {
    name: "Community Projects",
    description: "Repair a school, build a community center, or fund a well.",
    icon: "🏫",
  },
  {
    name: "Emergency Relief",
    description: "Quick fundraising for members facing hardship or disaster.",
    icon: "🆘",
  },
  {
    name: "Income Activities",
    description: "Raise capital for group farming, trading or business activities.",
    icon: "🌱",
  },
  {
    name: "Member Events",
    description: "Organize and fund group celebrations, retreats or training.",
    icon: "🎉",
  },
  {
    name: "Educational Support",
    description: "Fund scholarships, training programs or educational initiatives.",
    icon: "📚",
  },
  {
    name: "Health Initiatives",
    description: "Fundraise for health camps, wellness programs or medical support.",
    icon: "❤️",
  },
];

const leaderFeatures = [
  "Create multiple campaigns at once",
  "Set flexible fundraising targets",
  "Accept donations from anyone",
  "See real-time donation updates",
  "Send campaign updates to donors",
  "Generate transparent reports",
  "Track campaign performance",
  "Auto-send donor receipts",
];

const donorFeatures = [
  "Donate to trusted community projects",
  "See real-time progress toward goal",
  "Receive instant donation receipts",
  "View campaign updates and milestones",
  "Choose where your money goes",
  "Get transparent impact reports",
  "Support multiple campaigns",
  "Pay securely via M-Pesa",
];
