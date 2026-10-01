import Link from 'next/link';
import { BrandLockup } from '@/components/branding/BrandLockup';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-50 to-brand-100 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1>
            <Link
              href="/"
              className="inline-flex rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <BrandLockup size={72} layout="stacked" tagline />
            </Link>
          </h1>
        </div>
        {children}
      </div>
    </div>
  );
}
