import Link from 'next/link';
import { FileQuestion } from 'lucide-react';
import { BrandLogo } from '@/components/branding/BrandLogo';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';

/**
 * Global 404 — Next.js renders this for any route that matches no page
 * anywhere in the app (root-level, outside every route group). No auth
 * context is available here, so this never assumes a signed-in user.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 to-brand-100 p-4">
      <div className="w-full max-w-md text-center">
        <BrandLogo size={72} href="/" priority alt="Kitabu Yetu" className="justify-center mb-6" />
        <div className="rounded-2xl border bg-background p-8 shadow-sm">
          <EmptyState
            icon={FileQuestion}
            title="Page not found"
            description="The page you're looking for doesn't exist, or may have moved."
          />
          <div className="mt-2 flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
            <Button asChild>
              <Link href="/">Go to homepage</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/login">Sign in</Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
