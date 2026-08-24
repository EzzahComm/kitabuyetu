import type { Metadata } from 'next';
import { CheckCircle2 } from 'lucide-react';
import { PageShell } from '@/components/marketing/page-shell';

export const metadata: Metadata = {
  title: 'System status',
  description: 'Current operational status of Kitabu Yetu services.',
};

const SERVICES = [
  'Web application',
  'M-Pesa collections (STK Push, PayBill)',
  'M-Pesa disbursements (B2C)',
  'API',
];

export default function StatusPage() {
  return (
    <PageShell
      title="System status"
      description="Current status of Kitabu Yetu's core services."
    >
      <div className="mb-8 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        All systems operational
      </div>
      <ul className="space-y-3">
        {SERVICES.map((service) => (
          <li
            key={service}
            className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3 text-sm"
          >
            <span className="text-slate-700">{service}</span>
            <span className="flex items-center gap-1.5 font-medium text-green-700">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              Operational
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-8 text-sm text-slate-500">
        This page is updated manually, not by automated monitoring. If something looks
        wrong on your end, please <a href="/support">contact support</a> rather than
        relying solely on this page.
      </p>
    </PageShell>
  );
}
