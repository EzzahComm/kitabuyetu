import type { Metadata } from "next";
import { Container } from "@/components/Container";
import { SectionTitle } from "@/components/SectionTitle";
import { ContactForm } from "@/components/ContactForm";

export const metadata: Metadata = {
  title: "Contact — Kitabu Yetu",
  description:
    "Talk to Kitabu Yetu about starting a group, moving your records over, or Enterprise for organizations running many groups.",
};

export default function ContactPage() {
  return (
    <>
      <SectionTitle
        preTitle="Contact"
        title="Start a group, or ask us anything first"
        titleAs="h1"
      >
        Whether you are moving one chama off paper or running a hundred groups
        across a programme, tell us where you are and we will tell you what
        setting up looks like.
      </SectionTitle>

      <Container className="mb-16">
        <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-3">
          <div className="border-t-2 border-brand-600 pt-5">
            <p className="text-sm font-bold uppercase tracking-wider text-brand-600">For groups</p>
            <p className="mt-2 leading-7 text-gray-600 dark:text-gray-300">Tell us whether you are moving from a cash book, spreadsheet or another system.</p>
          </div>
          <div className="border-t-2 border-brand-600 pt-5">
            <p className="text-sm font-bold uppercase tracking-wider text-brand-600">For organizations</p>
            <p className="mt-2 leading-7 text-gray-600 dark:text-gray-300">Share your group count, programme structure and reporting needs for an Enterprise conversation.</p>
          </div>
          <div className="border-t-2 border-brand-600 pt-5">
            <p className="text-sm font-bold uppercase tracking-wider text-brand-600">Response</p>
            <p className="mt-2 leading-7 text-gray-600 dark:text-gray-300">We will reply with the next practical step, not a generic product brochure.</p>
          </div>
        </div>
      </Container>

      <Container className="mb-20">
        <div className="mx-auto max-w-2xl text-center text-lg leading-8 text-gray-600 dark:text-gray-300">
          <div className="mt-4">
            <a
              href="mailto:info@kitabuyetu.co.ke"
              className="rounded hover:text-indigo-500 focus:text-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
            >
              info@kitabuyetu.co.ke
            </a>
          </div>
          <div className="mt-2">
            <a
              href="tel:+254717548646"
              className="rounded hover:text-indigo-500 focus:text-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
            >
              +254 717 548 646
            </a>
          </div>
          <div className="mt-2">
            <a
              href="tel:+254738692698"
              className="rounded hover:text-indigo-500 focus:text-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
            >
              +254 738 692 698
            </a>
          </div>
          <div className="mt-2">Nairobi, Kenya</div>
        </div>
      </Container>

      <Container className="mb-20">
        <h2 className="max-w-xl mx-auto mb-8 text-2xl font-bold text-center text-gray-800 dark:text-white">
          Or tell us about your group
        </h2>
        <ContactForm />
      </Container>
    </>
  );
}
