"use client";
import React from "react";
import { Container } from "./Container";
import { Disclosure, DisclosureButton, DisclosurePanel } from "@headlessui/react";
import { ChevronUpIcon } from "@heroicons/react/24/solid";

export const Faq = () => {
  return (
    <Container className="!p-0">
      <div className="w-full max-w-2xl p-2 mx-auto rounded-2xl">
        {faqdata.map((item, index) => (
          <div key={item.question} className="mb-5">
            <Disclosure>
              {({ open }) => (
                <>
                  <DisclosureButton className="flex items-center justify-between w-full px-4 py-4 text-lg text-left text-gray-800 rounded-lg bg-gray-50 hover:bg-gray-100 focus:outline-none focus-visible:ring focus-visible:ring-indigo-100 focus-visible:ring-opacity-75 dark:bg-trueGray-800 dark:text-gray-200">
                    <span>{item.question}</span>
                    <ChevronUpIcon
                      className={`${
                        open ? "transform rotate-180" : ""
                      } w-5 h-5 text-indigo-500`}
                    />
                  </DisclosureButton>
                  <DisclosurePanel className="px-4 pt-4 pb-2 text-gray-500 dark:text-gray-300">
                    {item.answer}
                  </DisclosurePanel>
                </>
              )}
            </Disclosure>
          </div>
        ))}
      </div>
    </Container>
  );
}

const faqdata = [
  {
    question: "Is M-Pesa included?",
    answer:
      "Yes. Every Kitabu Yetu plan includes the full Safaricom Daraja integration — STK push prompts, PayBill (C2B) collections and B2C payouts.",
  },
  {
    question: "Do you hold our money?",
    answer:
      "It depends on the plan. On Starter, Growth and Premium, contributions are collected through the Kitabu Yetu PayBill, tracked to the member and the group that sent them, and settled to your group's own bank account. On Enterprise, the group collects into its own PayBill. Either way the books stay yours: every shilling is tracked to a member, only the signatories your group has appointed can approve a payout, and every movement in and out is posted to your ledger with an audit trail.",
  },
  {
    question: "Can I bring my existing records?",
    answer:
      "Yes. Every plan supports bulk CSV import for members and historical contributions.",
  },
  {
    question: "How is our data kept private?",
    answer:
      "Data is stored on encrypted servers, and each group's records are isolated at the database level. One group can never read another's.",
  },
  {
    question: "Can we change plan later?",
    answer:
      "Yes. Pay for a different plan by M-Pesa at any time and it activates immediately. There is no lock-in period.",
  },
  {
    question: "What if we use up our SMS?",
    answer:
      "Nothing stops. Each plan includes a set number of messages per billing cycle, and the allowance resets at the start of each new cycle. Once it is used up you buy top-up credits from your billing page; purchased credits are used after the included allowance.",
  },
  {
    question: "Which product should we start with?",
    answer:
      "If you only need to reach members — contribution reminders, meeting notices, birthdays — Chama Reminder is enough. Choose Kitabu Yetu when you also need to record and reconcile the money.",
  },
  {
    question: "Can we move from Chama Reminder to Kitabu Yetu?",
    answer:
      "Yes. Buy a Kitabu Yetu plan from your subscription page and your chart of accounts is set up then. Your group, members and message history carry over unchanged.",
  },
  {
    question: "Is there a free plan?",
    answer:
      "No. Every plan is paid, starting at the Starter price above, and is bought self-service by M-Pesa.",
  },
];
