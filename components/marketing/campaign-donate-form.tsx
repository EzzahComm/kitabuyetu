'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface CampaignDonateFormProps {
  slug: string;
}

type Step = 'form' | 'sent' | 'error';

/**
 * The one public, unauthenticated form on this platform that triggers a real
 * M-Pesa payment. Deliberately does NOT poll for completion the way the
 * authenticated billing flow does (hooks/use-stk-checkout.ts) — that relies
 * on tenant-scoped, authenticated status routes a public donor has no
 * session for. Instead: submit, tell the donor to check their phone, and let
 * them refresh once they've paid — router.refresh() re-fetches the server
 * component's live amount_raised.
 */
export function CampaignDonateForm({ slug }: CampaignDonateFormProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [donorName, setDonorName] = useState('');
  const [message, setMessage] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch(`/api/v1/campaigns/${slug}/donate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone,
          amount: parseFloat(amount),
          donorName: donorName || undefined,
          message: message || undefined,
          isAnonymous,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? 'Something went wrong. Please try again.');
      setStep('sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setStep('error');
    } finally {
      setSubmitting(false);
    }
  };

  if (step === 'sent') {
    return (
      <div className="rounded-2xl border border-brand-blue-900/10 bg-white p-6 text-center">
        <p className="font-display text-xl font-normal text-brand-blue-900">Check your phone</p>
        <p className="mt-2 text-[0.9375rem] leading-relaxed text-brand-blue-900/65">
          We sent an M-Pesa prompt to {phone}. Enter your PIN to complete the donation.
        </p>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="mt-5 inline-flex items-center justify-center rounded-md bg-brand-500 px-5 py-3 text-sm font-semibold text-white hover:bg-brand-400"
        >
          I&apos;ve paid — refresh this page
        </button>
        <button
          type="button"
          onClick={() => setStep('form')}
          className="mt-3 block w-full text-sm font-medium text-brand-blue-900/50 hover:text-brand-blue-900"
        >
          Make another donation
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="rounded-2xl border border-brand-blue-900/10 bg-white p-6">
      <p className="font-display text-xl font-normal text-brand-blue-900">Support this campaign</p>

      {step === 'error' && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      <div className="mt-5 space-y-4">
        <label className="block text-sm font-medium text-brand-blue-900">
          Amount (KES)
          <input
            required type="number" min={1} step="1" value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-1.5 w-full rounded-md border border-brand-blue-900/15 px-3 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
          />
        </label>
        <label className="block text-sm font-medium text-brand-blue-900">
          M-Pesa phone number
          <input
            required type="tel" placeholder="07XX XXX XXX" value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="mt-1.5 w-full rounded-md border border-brand-blue-900/15 px-3 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
          />
        </label>
        <label className="block text-sm font-medium text-brand-blue-900">
          Your name (optional)
          <input
            type="text" value={donorName} onChange={(e) => setDonorName(e.target.value)}
            className="mt-1.5 w-full rounded-md border border-brand-blue-900/15 px-3 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
          />
        </label>
        <label className="block text-sm font-medium text-brand-blue-900">
          Message (optional)
          <textarea
            rows={2} value={message} onChange={(e) => setMessage(e.target.value)}
            className="mt-1.5 w-full rounded-md border border-brand-blue-900/15 px-3 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-200"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-brand-blue-900/70">
          <input type="checkbox" checked={isAnonymous} onChange={(e) => setIsAnonymous(e.target.checked)} />
          Give anonymously (hide my name from other visitors)
        </label>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="mt-6 w-full rounded-md bg-brand-500 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-400 disabled:opacity-60"
      >
        {submitting ? 'Sending prompt…' : 'Donate now'}
      </button>
    </form>
  );
}
