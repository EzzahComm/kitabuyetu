import type { Metadata } from 'next';
import { PageShell } from '@/components/marketing/page-shell';

export const metadata: Metadata = {
  title: 'Support',
  description: 'Get help with your Kitabu Yetu account.',
};

export default function SupportPage() {
  return (
    <PageShell
      title="Support"
      description="Need help with your group, a payment, or your account?"
    >
      <p>
        The fastest way to get help is to email{' '}
        <a href="mailto:kitabuyetu@gmail.com">kitabuyetu@gmail.com</a> or call{' '}
        <a href="tel:+254717548646">+254 717 548 646</a>. If you&apos;re a member of a
        group, your chairperson, secretary, or treasurer can also raise an issue on
        your behalf.
      </p>
      <h2>Common questions</h2>
      <p>
        <strong>A payment didn&apos;t reflect in my account.</strong> M-Pesa payments
        are matched automatically, but if a reference number is missing or mistyped it
        may need manual reconciliation — reach out with the M-Pesa confirmation code
        and we&apos;ll help trace it.
      </p>
      <p>
        <strong>I forgot my password.</strong> Contact support directly with your
        registered phone number so we can help you regain access.
      </p>
      <p>
        <strong>I want to register a new group.</strong> You can start directly from
        the <a href="/register">registration page</a> — no need to contact us first.
      </p>
    </PageShell>
  );
}
