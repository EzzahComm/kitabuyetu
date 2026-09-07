import React from "react";
import Link from "next/link";
import { Container } from "./Container";
import { CheckIcon } from "@heroicons/react/24/solid";

interface Plan {
  name: string;
  price: string;
  period?: string;
  allowance: string;
  featured?: boolean;
  cta: string;
  features: string[];
}

interface PricingProduct {
  product: string;
  desc: string;
  plans: Plan[];
}

const PlanCard = ({ plan }: { plan: Plan }) => (
  <div
    className={`flex flex-col p-7 bg-gray-50 rounded-2xl dark:bg-trueGray-800 ${
      plan.featured ? "ring-2 ring-indigo-600" : ""
    }`}
  >
    <div className="flex items-center justify-between">
      <h4 className="text-xl font-medium text-gray-800 dark:text-gray-200">
        {plan.name}
      </h4>
      {plan.featured && (
        <span className="px-3 py-1 text-xs font-bold tracking-wider text-indigo-600 uppercase bg-indigo-100 rounded-full dark:bg-trueGray-700">
          Most popular
        </span>
      )}
    </div>

    <div className="mt-5">
      <span className="text-3xl font-bold text-gray-800 dark:text-white">
        {plan.price}
      </span>
      {plan.period && (
        <span className="ml-1 text-gray-500 dark:text-gray-400">
          {plan.period}
        </span>
      )}
    </div>

    <p className="mt-2 text-gray-500 dark:text-gray-400">{plan.allowance}</p>

    <div className="w-full mt-7">
      {plan.features.map((feature) => (
        <div key={feature} className="flex items-start mt-4 space-x-3">
          <div className="flex items-center justify-center flex-shrink-0 mt-1 bg-indigo-500 rounded-md w-5 h-5">
            <CheckIcon className="w-4 h-4 text-indigo-50" />
          </div>
          <p className="text-gray-500 dark:text-gray-400">{feature}</p>
        </div>
      ))}
    </div>

    <div className="mt-auto pt-7">
      <Link
        href="/contact"
        className={`inline-block w-full px-6 py-3 text-lg font-medium text-center rounded-md ${
          plan.featured
            ? "text-white bg-indigo-600"
            : "text-indigo-600 bg-white border border-indigo-600 dark:bg-trueGray-800 dark:text-indigo-400 dark:border-indigo-400"
        }`}
      >
        {plan.cta}
      </Link>
    </div>
  </div>
);

export const Pricing = () => {
  return (
    <Container>
      <p className="max-w-2xl mx-auto -mt-4 mb-12 text-center text-gray-500 dark:text-gray-400">
        Every plan includes a monthly SMS allowance, renewed at the start of
        each billing cycle. Once your included messages are used up you can buy
        more at any time — sending never stops, you simply top up.
      </p>

      {pricingdata.map((item) => (
        <div key={item.product} className="mb-16 last:mb-0">
          <div className="max-w-2xl mb-10">
            <h3 className="text-2xl font-bold leading-snug tracking-tight text-gray-800 lg:text-3xl dark:text-white">
              {item.product}
            </h3>
            <p className="mt-3 text-lg leading-normal text-gray-500 dark:text-gray-300">
              {item.desc}
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
            {item.plans.map((plan) => (
              <PlanCard key={plan.name} plan={plan} />
            ))}
          </div>
        </div>
      ))}
    </Container>
  );
};

const pricingdata: PricingProduct[] = [
  {
    product: "Kitabu Yetu",
    desc: "The full book: double-entry accounting, contributions, loans, M-Pesa collection and reconciliation, member records and reporting — with SMS included.",
    plans: [
      {
        name: "Starter",
        price: "KES 150",
        period: "/month",
        allowance: "100 SMS included every month",
        cta: "Start your group",
        features: ["Basic reporting", "M-Pesa integration", "SMS included"],
      },
      {
        name: "Growth",
        price: "KES 300",
        period: "/month",
        allowance: "200 SMS included every month",
        featured: true,
        cta: "Start your group",
        features: [
          "All Starter features",
          "Advanced reports",
          "Accounting module",
        ],
      },
      {
        name: "Premium",
        price: "KES 500",
        period: "/month",
        allowance: "300 SMS included every month",
        cta: "Start your group",
        features: [
          "All Growth features",
          "Priority support",
          "Higher SMS allowance",
        ],
      },
      {
        name: "Enterprise",
        price: "By agreement",
        allowance: "Negotiated SMS allowance",
        cta: "Talk to us",
        features: [
          "All Premium features",
          "Enterprise portal",
          "API access",
          "Dedicated support",
        ],
      },
    ],
  },
  {
    product: "Chama Reminder",
    desc: "Just the messaging. Keep your member list, send contribution reminders, birthday greetings and group announcements by SMS — no ledger, no accounting to set up. Start here and move to Kitabu Yetu whenever your group is ready; your members come with you.",
    plans: [
      {
        name: "Starter",
        price: "KES 100",
        period: "/month",
        allowance: "100 SMS included every month",
        cta: "Start your group",
        features: ["Member list & SMS", "Birthday greetings", "SMS included"],
      },
      {
        name: "Growth",
        price: "KES 250",
        period: "/month",
        allowance: "200 SMS included every month",
        featured: true,
        cta: "Start your group",
        features: [
          "All Starter features",
          "Scheduled campaigns",
          "Message templates",
        ],
      },
      {
        name: "Premium",
        price: "KES 400",
        period: "/month",
        allowance: "300 SMS included every month",
        cta: "Start your group",
        features: [
          "All Growth features",
          "Higher SMS allowance",
          "Priority support",
        ],
      },
      {
        name: "Enterprise",
        price: "By agreement",
        allowance: "Negotiated SMS allowance",
        cta: "Talk to us",
        features: [
          "All Premium features",
          "Custom sender ID",
          "Dedicated support",
        ],
      },
    ],
  },
];
