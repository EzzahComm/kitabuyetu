import { BrandLogo } from '@/components/branding/BrandLogo';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand-50 to-brand-100 p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <BrandLogo
            size={88}
            href="/"
            priority
            alt="Kitabu Yetu"
            className="justify-center mb-3"
          />
          <h1 className="text-2xl font-bold text-brand-blue-500">Kitabu Yetu</h1>
          <p className="text-sm font-medium text-brand-600 mt-1">
            Build Vibrant Communities
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
