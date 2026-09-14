import React from "react";
import Link from "next/link";
import { Container } from "@/components/Container";

interface ProductCard {
  name: string;
  tagline: string;
  desc: string;
  cta: { text: string; href: string };
}

/**
 * The four solutions, as cards. Card styling matches Pricing's PlanCard so the
 * two grids read as the same system.
 */
export const ProductGrid = () => {
  return (
    <Container className="mb-20">
      <div className="grid gap-8 md:grid-cols-2 xl:grid-cols-4">
        {products.map((product) => (
          <div
            key={product.name}
            className="flex flex-col border border-gray-200 bg-gray-50 p-7 transition-colors hover:border-brand-300 dark:border-trueGray-700 dark:bg-trueGray-800 dark:hover:border-brand-700"
          >
            <h3 className="text-xl font-medium text-gray-800 dark:text-gray-200">
              {product.name}
            </h3>
            <p className="mt-2 font-medium text-gray-700 dark:text-gray-300">
              {product.tagline}
            </p>
            <p className="mt-3 text-gray-500 dark:text-gray-400">
              {product.desc}
            </p>
            <div className="mt-auto pt-7">
              <Link
                href={product.cta.href}
                className="inline-flex min-h-12 w-full items-center justify-center rounded-md border border-brand-600 bg-white px-6 py-3 text-center font-semibold text-brand-700 transition-colors hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-brand-400 dark:bg-trueGray-800 dark:text-brand-300 dark:hover:bg-trueGray-700"
              >
                {product.cta.text}
              </Link>
            </div>
          </div>
        ))}
      </div>
    </Container>
  );
};

const products: ProductCard[] = [
  {
    name: "Bookkeeper",
    tagline: "Your group's financial record.",
    desc: "Manage members, contributions, loans, expenses, investments, income-generating activities, M-Pesa payments and reporting.",
    cta: { text: "Explore Bookkeeper", href: "/products#bookkeeper" },
  },
  {
    name: "Chama Reminder",
    tagline: "Keep members engaged and contributions on track.",
    desc: "Send reminders, announcements, birthday messages and SMS campaigns.",
    cta: { text: "Explore Chama Reminder", href: "/products#chama-reminder" },
  },
  {
    name: "Fundraise / Changi$ha",
    tagline: "Raise money for groups, projects and community initiatives.",
    desc: "Create fundraising campaigns and connect contributors to causes that matter.",
    cta: { text: "Explore Fundraise", href: "/products#fundraise" },
  },
  {
    name: "Enterprise",
    tagline: "Manage many groups from one place.",
    desc: "Give organizations visibility across groups, programs, finances, activities and impact.",
    cta: { text: "Explore Enterprise", href: "/products#enterprise" },
  },
];

export default ProductGrid;
