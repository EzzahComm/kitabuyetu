import type { Metadata } from "next";
import {
  IconDeviceMobile,
  IconShieldCheck,
  IconBook,
  IconCash,
  IconChecklist,
  IconTrendingUp,
} from "@tabler/icons-react";

import { SectionTitle } from "@/components/SectionTitle";
import { Benefits } from "@/components/Benefits";
import { Video } from "@/components/Video";
import { Cta } from "@/components/Cta";

import paymentImg from "../../../public/img/fundraise.jpg";
import recordImg from "../../../public/img/bookkeeper.jpg";

export const metadata: Metadata = {
  title: "How it works — Kitabu Yetu",
  description:
    "From an M-Pesa payment to the member's updated balance and the journal entry behind it — how a contribution reaches the group's books.",
};

export default function HowItWorksPage() {
  return (
    <>
      <SectionTitle
        preTitle="How it works"
        title="From member activity to a record the group can trust"
        titleAs="h1"
      >
        Members pay, officials review and the ledger keeps the history. The
        platform connects payments, communication and reporting so the group
        can spend its meetings making decisions instead of rebuilding records.
      </SectionTitle>

      <Benefits data={theFlow} />

      <Video videoId="fZ0D0cnR88E" />

      <Benefits imgPos="right" data={theEdges} />

      <Cta />
    </>
  );
}

const theFlow = {
  title: "Three steps, and none of them are yours",
  desc: "A member pays the way they already pay. Everything after that happens because the payment happened.",
  image: paymentImg,
  bullets: [
    {
      title: "Member pays",
      desc: "An STK prompt straight to their phone, or your PayBill quoting their membership number. Anyone can pay for a member — a spouse, a child, a well-wisher — and it still lands in the right place.",
      icon: <IconDeviceMobile />,
    },
    {
      title: "Payment is matched",
      desc: "Safaricom's Daraja callback is verified before anything is written down, then matched to the member by their membership number or the STK request that started it.",
      icon: <IconShieldCheck />,
    },
    {
      title: "The records update",
      desc: "Split into savings, welfare and loan repayment by the rules your group set once, posted to the ledger with Safaricom's fee, and confirmed to the member.",
      icon: <IconBook />,
    },
  ],
};

const theEdges = {
  title: "What it will not do",
  desc: "A payment in the wrong member's account is a far worse problem than a payment in a queue.",
  image: recordImg,
  bullets: [
    {
      title: "It never guesses",
      desc: "A PayBill payment that arrives without a usable reference is not attached to whoever seems likely. It waits in an unrouted queue and shows on your dashboard as a task until someone assigns it.",
      icon: <IconChecklist />,
    },
    {
      title: "Cash still counts",
      desc: "Not every group is cashless. Contributions taken in cash at the meeting are recorded by hand and post to exactly the same ledger.",
      icon: <IconCash />,
    },
    {
      title: "Money goes out the same way",
      desc: "Loan disbursements, welfare payouts and dividends are sent to a member's phone by B2C — approved first, posted with Safaricom's fee, and confirmed to the member.",
      icon: <IconTrendingUp />,
    },
  ],
};
