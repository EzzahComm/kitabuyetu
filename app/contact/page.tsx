import type { Metadata } from 'next';
import { Mail, Phone, MapPin } from 'lucide-react';
import { MarketingPageShell } from '@/components/landing/marketing-page-shell';

export const metadata: Metadata = {
  title: 'Contact — Kitabu Yetu',
  description: 'Get in touch with the Kitabu Yetu team.',
};

export default function ContactPage() {
  return (
    <MarketingPageShell
      title="Contact us"
      description="Questions about your group, a demo, or a partnership — reach us directly."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <a
          href="mailto:kitabuyetu@gmail.com"
          className="flex flex-col items-start gap-2 rounded-xl border border-slate-200 p-5 transition-colors hover:border-brand-300 hover:bg-brand-50/50"
        >
          <Mail className="h-5 w-5 text-brand-600" />
          <span className="text-sm font-semibold text-slate-900">Email</span>
          <span className="text-sm text-slate-500">kitabuyetu@gmail.com</span>
        </a>
        <div className="flex flex-col items-start gap-2 rounded-xl border border-slate-200 p-5">
          <Phone className="h-5 w-5 text-brand-600" />
          <span className="text-sm font-semibold text-slate-900">Phone</span>
          <a href="tel:+254717548646" className="text-sm text-slate-500 hover:text-brand-600">+254 717 548 646</a>
          <a href="tel:+254738692698" className="text-sm text-slate-500 hover:text-brand-600">+254 738 692 698</a>
        </div>
        <div className="flex flex-col items-start gap-2 rounded-xl border border-slate-200 p-5">
          <MapPin className="h-5 w-5 text-brand-600" />
          <span className="text-sm font-semibold text-slate-900">Location</span>
          <span className="text-sm text-slate-500">Nairobi, Kenya</span>
        </div>
      </div>
      <p className="mt-8">
        Already using Kitabu Yetu and need help with your account? Your group&apos;s
        chairperson, secretary, or treasurer can also reach us on your behalf.
      </p>
    </MarketingPageShell>
  );
}
