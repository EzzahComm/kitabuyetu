import type { Metadata } from "next";
import { SectionTitle } from "@/components/SectionTitle";

export const metadata: Metadata = {
  title: "Legal — Kitabu Yetu",
  description:
    "Terms and conditions, privacy policy and data protection for Kitabu Yetu.",
};

export default function LegalPage() {
  return (
    <>
      <SectionTitle
        preTitle="Legal"
        title="Terms, privacy and data protection"
        titleAs="h1"
      >
        We explain the platform responsibilities here in plain language. The
        signed service agreement and published policy documents control the
        relationship, and we will update this page as the platform expands.
      </SectionTitle>

      <div id="terms">
        <SectionTitle preTitle="Terms & Conditions" title="Using Kitabu Yetu">
          Organizations choose the Kitabu Yetu products and subscription terms
          that fit their work. Plans, usage charges, payment timing, support
          commitments and cancellation terms are shown before an organization
          starts or changes service.
        </SectionTitle>
      </div>

      <div id="privacy">
        <SectionTitle preTitle="Privacy Policy" title="What we hold, and why">
          We process the information needed to run a group or organization:
          members, users, contacts, financial activity, communications and
          configuration. We use it to provide the requested service, protect
          accounts, support users and improve reliability. We do not turn a
          group&apos;s financial record into a public profile.
        </SectionTitle>
      </div>

      <div id="data-protection">
        <SectionTitle
          preTitle="Data Protection"
          title="Where a group's records live"
        >
          Access is scoped to the active organization and the permissions that
          organization grants. Records should be isolated between tenants,
          sensitive actions should be auditable, and exports or integrations
          should be available only to authorized roles. Contact us promptly if
          you suspect unauthorized access or a data error.
        </SectionTitle>
      </div>
    </>
  );
}
