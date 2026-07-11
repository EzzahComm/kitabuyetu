import Link from 'next/link';
import { Check } from 'lucide-react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

const PLANS = [
  {
    type: 'starter', label: 'Starter', price: 0, period: 'forever',
    description: 'Perfect for small groups just getting started',
    features: [
      'Up to 10 members', 'Basic contribution tracking', 'Loan management',
      '50 SMS per month', 'M-Pesa integration', 'Basic reports',
    ],
  },
  {
    type: 'growth', label: 'Growth', price: 2500, period: 'month',
    description: 'For growing groups that need more power',
    highlight: true,
    features: [
      'Up to 100 members', 'Everything in Starter',
      '500 SMS per month', 'Advanced reporting', 'Double-entry accounting',
      'Data export (CSV/PDF)', 'Email support',
    ],
  },
  {
    type: 'enterprise', label: 'Enterprise', price: 8000, period: 'month',
    description: 'For large groups and Organizations managing multiple chapters',
    features: [
      'Unlimited members', 'Everything in Growth',
      'Unlimited SMS', 'Organization multi-group portal', 'API access',
      'Bulk data import', 'Priority support', 'Custom branding',
    ],
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-background">
      <nav className="border-b px-6 py-4 flex items-center justify-between max-w-6xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span className="font-bold">Kitabu Yetu</span>
        </div>
        <div className="flex gap-3">
          <Link href="/login" className="inline-flex items-center justify-center rounded-md text-sm font-medium h-9 px-4 hover:bg-accent hover:text-accent-foreground transition-colors">
            Sign in
          </Link>
          <Link href="/register" className="inline-flex items-center justify-center rounded-md text-sm font-medium h-9 px-4 bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
            Get started free
          </Link>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4">Simple, transparent pricing</h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Start free and grow as your community grows. All plans include M-Pesa integration and mobile-friendly access.
          </p>
        </div>

        <div className="grid gap-8 lg:grid-cols-3">
          {PLANS.map((plan) => (
            <Card key={plan.type} className={`relative flex flex-col ${plan.highlight ? 'ring-2 ring-brand-500 shadow-lg' : ''}`}>
              {plan.highlight && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-brand-500 text-white text-sm font-semibold px-4 py-1 rounded-full">
                  Most popular
                </div>
              )}
              <CardHeader className="pb-2">
                <CardTitle className="text-xl">{plan.label}</CardTitle>
                <CardDescription>{plan.description}</CardDescription>
                <div className="mt-3">
                  {plan.price === 0 ? (
                    <span className="text-4xl font-bold">Free</span>
                  ) : (
                    <>
                      <span className="text-4xl font-bold">KES {plan.price.toLocaleString()}</span>
                      <span className="text-muted-foreground">/{plan.period}</span>
                    </>
                  )}
                </div>
              </CardHeader>
              <CardContent className="flex-1">
                <ul className="space-y-3">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <Check size={16} className="text-brand-500 mt-0.5 shrink-0"/>
                      {f}
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                <Link
                  href="/register"
                  className={`w-full inline-flex items-center justify-center rounded-md text-sm font-medium h-10 px-4 transition-colors ${
                    plan.highlight
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                      : 'border border-input bg-background hover:bg-accent hover:text-accent-foreground'
                  }`}
                >
                  {plan.price === 0 ? 'Get started free' : 'Start free trial'}
                </Link>
              </CardFooter>
            </Card>
          ))}
        </div>

        <div className="mt-16 text-center">
          <h2 className="text-2xl font-bold mb-4">Frequently asked questions</h2>
          <div className="grid gap-6 md:grid-cols-2 max-w-4xl mx-auto text-left">
            {[
              ['Is M-Pesa integration included?', 'Yes, all plans include full Safaricom Daraja M-Pesa integration for STK push, C2B collections, and B2C disbursements.'],
              ['Can I import existing member data?', 'Yes, Growth and Enterprise plans support bulk CSV import for members and contributions.'],
              ['How is data secured?', 'Data is stored on encrypted servers with row-level multi-tenant isolation. Each group can only see its own data.'],
              ['What happens when I hit the member limit?', "You'll be prompted to upgrade. Existing members and data are preserved."],
            ].map(([q, a]) => (
              <div key={q} className="space-y-1">
                <p className="font-semibold text-sm">{q}</p>
                <p className="text-sm text-muted-foreground">{a}</p>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
