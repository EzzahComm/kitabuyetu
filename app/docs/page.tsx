import type { Metadata } from 'next';
import { MarketingPageShell } from '@/components/landing/marketing-page-shell';

export const metadata: Metadata = {
  title: 'Documentation — Kitabu Yetu',
  description: 'Kitabu Yetu documentation.',
};

export default function DocsPage() {
  return (
    <MarketingPageShell
      title="Documentation"
      description="Full guides and API reference are on the way."
    >
      <p>
        We&apos;re still building out written documentation for Kitabu Yetu. In the
        meantime, if you&apos;re trying to do something specific — set up M-Pesa
        collections, understand a report, or integrate with the API as an enterprise
        partner — <a href="/support">contact support</a> and we&apos;ll help directly.
      </p>
    </MarketingPageShell>
  );
}
