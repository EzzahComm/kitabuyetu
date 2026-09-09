import type { Metadata } from "next";
import { Container } from "@/components/Container";
import { SectionTitle } from "@/components/SectionTitle";
import { Cta } from "@/components/Cta";

export const metadata: Metadata = {
  title: "About — Kitabu Yetu",
  description:
    "Why Kitabu Yetu exists, who builds it, and what it has changed for the groups using it.",
};

export default function AboutPage() {
  return (
    <>
      <div id="our-story">
        <SectionTitle
          preTitle="Our Story"
          title="Most groups already keep good records"
          titleAs="h1"
        >
          The trouble was never discipline. It was where the records lived — one
          cash book in one person&apos;s handwriting, a spreadsheet three
          officers all need at once, and an M-Pesa statement somebody matches to
          a list of names the evening before every meeting.
        </SectionTitle>

        <Container className="mb-20">
          <div className="mx-auto max-w-3xl text-center text-lg leading-8 text-gray-600 dark:text-gray-300">
            Kitabu Yetu was built to put those three things in one place: the
            members, the money and the payments, on a ledger that has to
            balance before it saves. The group keeps doing what it already
            does. The book just stops being something one person carries.
          </div>
        </Container>
      </div>

      <div id="team">
        <SectionTitle preTitle="Team" title="A product built across the community">
          Kitabu Yetu brings together product, engineering, operations and
          community knowledge. The people who use the platform are part of the
          feedback loop, not an audience we design around from a distance.
        </SectionTitle>
        <Container className="mb-20">
          <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-3">
            {[
              ["Community", "Listen to treasurers, officials and members before we decide what to build."],
              ["Product", "Turn complicated group workflows into steps people can understand and repeat."],
              ["Trust", "Treat financial records, permissions and communication as responsibilities, not details."],
            ].map(([title, description]) => (
              <div key={title} className="border-t-2 border-brand-600 pt-5">
                <h3 className="text-xl font-bold text-brand-blue-900 dark:text-white">{title}</h3>
                <p className="mt-3 leading-7 text-gray-600 dark:text-gray-300">{description}</p>
              </div>
            ))}
          </div>
        </Container>
      </div>

      <div id="impact">
        <SectionTitle preTitle="Impact" title="Measure what becomes easier">
          We will publish verified numbers as the platform grows. Until then,
          our standard is practical: records close on time, members can see
          their own activity, and organizations can act on figures they can
          trace back to a group.
        </SectionTitle>
        <Container className="mb-20">
          <div className="mx-auto grid max-w-5xl gap-6 border-y border-gray-200 py-8 md:grid-cols-3 dark:border-trueGray-700">
            <div><p className="font-bold text-brand-blue-900 dark:text-white">Manage</p><p className="mt-2 text-gray-600 dark:text-gray-300">Members, contributions, loans, welfare and group activity.</p></div>
            <div><p className="font-bold text-brand-blue-900 dark:text-white">Understand</p><p className="mt-2 text-gray-600 dark:text-gray-300">Reports and insights that explain where the money went.</p></div>
            <div><p className="font-bold text-brand-blue-900 dark:text-white">Grow</p><p className="mt-2 text-gray-600 dark:text-gray-300">A clearer track record for funding, products and opportunity.</p></div>
          </div>
        </Container>
      </div>

      <Cta />
    </>
  );
}
