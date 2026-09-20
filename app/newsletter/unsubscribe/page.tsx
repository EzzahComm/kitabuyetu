import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/marketing/page-shell';
import { unsubscribeFromNewsletter } from '@/lib/services/newsletter.service';

export const metadata: Metadata = {
  title: 'Unsubscribe',
  robots: { index: false },
};

interface UnsubscribePageProps {
  searchParams: Promise<{ token?: string }>;
}

async function tryUnsubscribe(token: string): Promise<boolean> {
  try {
    await unsubscribeFromNewsletter(token);
    return true;
  } catch {
    return false;
  }
}

/**
 * A server component, not an API route: unsubscribing is "click a link in an
 * email, see a confirmation" — no client-side interactivity needed, so the
 * DB write happens directly in the page render rather than round-tripping
 * through a public API endpoint (one less thing to whitelist in proxy.ts).
 */
export default async function UnsubscribePage({ searchParams }: UnsubscribePageProps) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <PageShell title="Unsubscribe">
        <p>
          This link is missing its unsubscribe code. If you followed a link from an email, please use that link
          directly.
        </p>
      </PageShell>
    );
  }

  const succeeded = await tryUnsubscribe(token);

  if (succeeded) {
    return (
      <PageShell title="You're unsubscribed">
        <p>
          You won&rsquo;t receive any further newsletter emails from Kitabu Yetu. Changed your mind? You can subscribe
          again any time from our <Link href="/resources">Resources</Link> page.
        </p>
      </PageShell>
    );
  }

  return (
    <PageShell title="Unsubscribe">
      <p>We couldn&rsquo;t find that subscription. It may already be unsubscribed, or the link may be out of date.</p>
    </PageShell>
  );
}
