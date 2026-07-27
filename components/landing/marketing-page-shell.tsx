import Navbar from '@/components/landing/navbar';
import Footer from '@/components/landing/footer';

interface MarketingPageShellProps {
  title:       string;
  description?: string;
  children:    React.ReactNode;
}

/**
 * Shared wrapper for simple marketing/info pages (About, Contact, Status,
 * Support, Docs) that just need the site chrome + a readable text column —
 * avoids five copies of the same Navbar/Footer/padding boilerplate. Not used
 * by the landing page itself (which composes its own full-bleed sections) or
 * by /pricing (which predates this and has its own inline nav — left as-is,
 * a separate known inconsistency, not in scope here).
 */
export function MarketingPageShell({ title, description, children }: MarketingPageShellProps) {
  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main className="mx-auto max-w-3xl px-4 pb-24 pt-32 sm:px-6 lg:px-8 md:pt-40">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{title}</h1>
        {description && (
          <p className="mt-3 text-lg text-slate-500">{description}</p>
        )}
        <div className="mt-10 space-y-4 text-base leading-relaxed text-slate-600 [&_a]:font-medium [&_a]:text-brand-600 [&_a]:hover:underline [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-slate-900">
          {children}
        </div>
      </main>
      <Footer />
    </div>
  );
}
