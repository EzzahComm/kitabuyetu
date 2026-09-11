'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { BrandLogo } from '@/components/branding/BrandLogo';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth/context';

/**
 * Shown when a signed-in session doesn't carry the role/audience a portal
 * guard requires — distinct from "not signed in at all" (those cases still
 * redirect straight to the relevant login page). Reached from
 * (admin)/layout.tsx and (enterprise)/layout.tsx's role-mismatch branches,
 * which previously bounced an already-authenticated-but-denied user back to
 * the login page they'd just come from — a dead-end loop, not an explanation.
 */
export default function UnauthorizedPage() {
  const { user, audience, logout } = useAuth();
  const router = useRouter();

  // Backoffice audience splits further by role now that organization staff
  // and platform staff have separate login surfaces (SURFACE_ALLOWED_ROLES,
  // app/api/v1/auth/admin/login/route.ts) — sending an organization_coordinator
  // to /admin-login would just get them turned away again.
  const signOutHref =
    audience !== 'backoffice' ? '/login'
    : user?.platformRole === 'organization_coordinator' ? '/enterprise/login'
    : '/admin-login';

  const handleSignOut = () => {
    logout();
    router.push(signOutHref);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 to-brand-100 p-4">
      <div className="w-full max-w-md text-center">
        <BrandLogo size={72} href="/" priority alt="Kitabu Yetu" className="justify-center mb-6" />
        <div className="rounded-2xl border bg-background p-8 shadow-sm">
          <EmptyState
            icon={ShieldAlert}
            title="You don't have access to this page"
            description={
              user
                ? `Signed in as ${user.platformRole ?? 'member'}. This area needs different permissions.`
                : 'This area needs a different sign-in.'
            }
          />
          <div className="mt-2 flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
            <Button onClick={handleSignOut}>Sign in with a different account</Button>
            <Button asChild variant="outline">
              <Link href="/">Go to homepage</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
