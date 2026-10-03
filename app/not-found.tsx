import Link from 'next/link';
import { TriangleAlert } from 'lucide-react';
import { PageShell } from '@/components/marketing/page-shell';
import { ROUTES } from '@/components/marketing/routes';
import { FinanzaSection, btnOutline, btnPrimary } from '@/components/marketing/finanza';

/**
 * Global 404 — Next.js renders this for any route that matches no page
 * anywhere in the app (root-level, outside every route group). No auth
 * context is available here, so this never assumes a signed-in user.
 * Laid out as the Finanza template's 404.html.
 */
export default function NotFound() {
  return (
    <PageShell title="404 Error" layout="sections">
      <FinanzaSection className="pt-8 lg:pt-12">
        <div className="mx-auto max-w-xl text-center">
          <TriangleAlert aria-hidden="true" className="mx-auto h-20 w-20 text-brand-500" strokeWidth={1.5} />
          <p className="font-display text-[5rem] font-bold leading-none text-finanza-dark">404</p>
          <h2 className="mb-4 mt-2 font-display text-3xl font-bold text-finanza-dark">Page Not Found</h2>
          <p className="mb-8 text-finanza-text">
            We&rsquo;re sorry, the page you&rsquo;re looking for doesn&rsquo;t exist, or may have moved. Try the home
            page, or sign in if you were heading to your group.
          </p>
          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            <Link href={ROUTES.home} className={btnPrimary}>
              Go Back To Home
            </Link>
            <Link href={ROUTES.signIn} className={btnOutline}>
              Sign in
            </Link>
          </div>
        </div>
      </FinanzaSection>
    </PageShell>
  );
}
