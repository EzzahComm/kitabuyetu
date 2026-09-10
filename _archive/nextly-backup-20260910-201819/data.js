import {
  BookOpenIcon,
  DevicePhoneMobileIcon,
  ChartBarSquareIcon,
  ChatBubbleLeftRightIcon,
  ArrowTrendingUpIcon,
  UserGroupIcon,
} from "@heroicons/react/24/solid";

import benefitOneImg from "../../../public/img/benefit-one.png";
import benefitTwoImg from "../../../public/img/benefit-two.png";

const benefitOne = {
  title: "Your group's digital book",
  desc: "Double-entry accounting underneath — the discipline an auditor expects — with none of the accounting vocabulary on the surface.",
  image: benefitOneImg,
  bullets: [
    {
      title: "Keep the books",
      desc: "Members, savings, loans, welfare, shares and dividends on one ledger, with journals posted automatically as money moves.",
      icon: <BookOpenIcon />,
    },
    {
      title: "Move the money",
      desc: "Collection and payout both run on Safaricom's Daraja, so the payment and the record of the payment are the same event.",
      icon: <DevicePhoneMobileIcon />,
    },
    {
      title: "Know your numbers",
      desc: "Balances, contributions, loans and welfare all read from the same ledger, so the report and the meeting agree.",
      icon: <ChartBarSquareIcon />,
    },
  ],
};

const benefitTwo = {
  title: "More than a savings pot",
  desc: "The group keeps its members informed, puts its money to work, and lets every member check their own record without waiting for a meeting.",
  image: benefitTwoImg,
  bullets: [
    {
      title: "Keep everyone in the loop",
      desc: "Confirmations, reminders and announcements go out from the same system that holds the money, so the message and the balance never disagree.",
      icon: <ChatBubbleLeftRightIcon />,
    },
    {
      title: "Grow the group's money",
      desc: "Share capital and dividends alongside the farms, rentals, shops and projects the group invests in — what each earns and what it costs to run.",
      icon: <ArrowTrendingUpIcon />,
    },
    {
      title: "Every member has a passbook",
      desc: "Members sign in to see what they have saved, what they still owe and their own statements, and can pay from their phone.",
      icon: <UserGroupIcon />,
    },
  ],
};


export {benefitOne, benefitTwo};
