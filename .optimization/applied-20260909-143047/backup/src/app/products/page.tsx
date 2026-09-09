import type { Metadata } from "next";
import {
  IconBook,
  IconDeviceMobile,
  IconChartBar,
  IconUsers,
  IconCalendarDot,
  IconTrendingUp,
  IconCash,
  IconHandStop,
  IconFileText,
  IconBuildingCommunity,
  IconCode,
  IconBrush,
} from "@tabler/icons-react";

import { SectionTitle } from "@/components/SectionTitle";
import { Benefits } from "@/components/Benefits";
import { Cta } from "@/components/Cta";
import { signUpUrl } from "@/lib/app-links";

import bookkeeperImg from "../../../public/img/bookkeeper.jpg";
import chamaReminderImg from "../../../public/img/chama-reminder.jpg";
import fundraiseImg from "../../../public/img/fundraise.jpg";
import enterpriseImg from "../../../public/img/enterprise.jpg";

export const metadata: Metadata = {
  title: "Products — Kitabu Yetu",
  description:
    "The full book with Kitabu Yetu, SMS reminders on their own with Chama Reminder, fundraising with Changi$ha, and Enterprise for organizations running many groups.",
};

export default function ProductsPage() {
  return (
    <>
      <SectionTitle
        preTitle="Products"
        title="Four ways to help a community group move forward"
        titleAs="h1"
      >
        Start with the job in front of you: manage the group, keep members
        connected, fund a project or coordinate a portfolio of groups. The
        products share one Kitabu Yetu ecosystem, so your group history does
        not have to start over.
      </SectionTitle>

      <div id="bookkeeper">
        <Benefits data={bookkeeper} />
      </div>

      <div id="chama-reminder">
        <Benefits imgPos="right" data={chamaReminder} />
      </div>

      <div id="fundraise">
        <Benefits data={fundraise} />
      </div>

      <div id="enterprise">
        <Benefits imgPos="right" data={enterprise} />
      </div>

      <Cta />
    </>
  );
}

const bookkeeper = {
  title: "Bookkeeper — the full book",
  desc: "Members, savings, contributions, loans, welfare, shares and dividends, posted to a double-entry ledger that has to balance before it saves.",
  image: bookkeeperImg,
  bullets: [
    {
      title: "Members and their money",
      desc: "One register of members, their roles and their financial activity, current the moment a payment lands.",
      icon: <IconUsers />,
    },
    {
      title: "M-Pesa in and out",
      desc: "PayBill and STK collections post against the right member; loans, welfare and dividends go out by B2C.",
      icon: <IconDeviceMobile />,
    },
    {
      title: "Close the month off the ledger",
      desc: "Statements, trial balance and member reports come straight from the books, and a closed period stops changing.",
      icon: <IconBook />,
    },
  ],
  cta: {
    text: "Get Started with Bookkeeper",
    href: signUpUrl("kitabu_yetu"),
  },
};

const chamaReminder = {
  title: "Chama Reminder — just the messaging",
  desc: "Keep your member list and reach everyone by SMS: contribution reminders, birthday greetings and group announcements, with no ledger to set up.",
  image: chamaReminderImg,
  bullets: [
    {
      title: "A member list that is yours",
      desc: "Names, numbers and groups in one place, ready to send to without rebuilding the list every time.",
      icon: <IconChartBar />,
    },
    {
      title: "Reminders that go out on time",
      desc: "Scheduled campaigns and message templates, so the reminder does not depend on somebody remembering.",
      icon: <IconCalendarDot />,
    },
    {
      title: "Move up when you are ready",
      desc: "Buy a Kitabu Yetu plan and your chart of accounts is set up then; group, members and message history carry over unchanged.",
      icon: <IconTrendingUp />,
    },
  ],
  cta: {
    text: "Get Started with Chama Reminder",
    href: signUpUrl("chama_reminder"),
  },
};

const fundraise = {
  title: "Fundraise / Changi$ha — a drive the group can account for",
  desc: "A fundraiser with its own target and its own record, so what came in for the drive never has to be picked back out of the group's ordinary contributions.",
  image: fundraiseImg,
  bullets: [
    {
      title: "One target, one record",
      desc: "Every contribution to the drive is recorded against the campaign rather than mixed into the month's collections.",
      icon: <IconCash />,
    },
    {
      title: "Anyone can give",
      desc: "A well-wisher who is not a member can contribute, and the payment still lands where it belongs.",
      icon: <IconHandStop />,
    },
    {
      title: "Receipts and a running total",
      desc: "Contributors get a confirmation, and the committee sees where the drive stands without adding up messages.",
      icon: <IconFileText />,
    },
  ],
  cta: {
    text: "Start Fundraising",
    href: "/contact",
  },
};

const enterprise = {
  title: "Enterprise — one connected view across the groups you support",
  desc: "For NGOs, networks and organizations running many groups at once: linked groups under a single account, with pricing agreed across the portfolio.",
  image: enterpriseImg,
  bullets: [
    {
      title: "Linked groups in one portal",
      desc: "Every group you support in a single view, with staff accounts and reports that read off the same ledgers.",
      icon: <IconBuildingCommunity />,
    },
    {
      title: "Collect into your own PayBill",
      desc: "Enterprise groups collect into their own PayBill rather than through the Kitabu Yetu one.",
      icon: <IconDeviceMobile />,
    },
    {
      title: "API access",
      desc: "Connect the portal to the systems your organization already runs.",
      icon: <IconCode />,
    },
    {
      title: "White-label branding",
      desc: "Your logo and your primary colour on the surface your groups use every day.",
      icon: <IconBrush />,
    },
  ],
  cta: {
    text: "Contact Us",
    href: "/contact",
  },
};
