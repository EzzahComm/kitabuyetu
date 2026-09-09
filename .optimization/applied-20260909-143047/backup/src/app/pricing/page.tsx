import type { Metadata } from "next";
import { SectionTitle } from "@/components/SectionTitle";
import { Pricing } from "@/components/Pricing";
import { Faq } from "@/components/Faq";
import { Cta } from "@/components/Cta";

export const metadata: Metadata = {
  title: "Pricing — Kitabu Yetu",
  description:
    "One price a month for the whole group. Kitabu Yetu from KES 150, Chama Reminder from KES 100, every plan with an SMS allowance included.",
};

export default function PricingPage() {
  return (
    <>
      <SectionTitle
        preTitle="Pricing"
        title="Start with the product your group needs today"
        titleAs="h1"
      >
        Choose Bookkeeper for the full group record or Chama Reminder for
        communication on its own. Every price below is for the whole group, not
        per member, with room to add capability as the group grows.
      </SectionTitle>

      <Faq />
      <Cta />
    </>
  );
}
