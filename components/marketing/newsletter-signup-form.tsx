'use client';

import { useState, type FormEvent } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useSubscribeNewsletter } from '@/hooks/use-newsletter';
import { getErrorMessage } from '@/lib/utils';

interface NewsletterSignupFormProps {
  /** Where this form is mounted — lets the admin subscriber list distinguish footer vs. in-article signups. */
  source: string;
  className?: string;
  /** `inset` puts the button inside a full-width field, as the Finanza footer does. */
  appearance?: 'default' | 'inset';
}

export function NewsletterSignupForm({ source, className, appearance = 'default' }: NewsletterSignupFormProps) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const subscribe = useSubscribeNewsletter();

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await subscribe.mutateAsync({ email, source });
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  if (subscribe.isSuccess) {
    return <p className={className}>You&rsquo;re subscribed. Thanks for following along.</p>;
  }

  if (appearance === 'inset') {
    return (
      <form onSubmit={onSubmit} className={className}>
        <div className="relative w-full">
          <input
            type="email"
            required
            placeholder="Your email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-label="Email address"
            className="h-14 w-full rounded-lg border-0 bg-white pl-4 pr-32 text-[0.9375rem] text-finanza-dark placeholder:text-finanza-text/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
          />
          <button
            type="submit"
            disabled={subscribe.isPending}
            className="absolute bottom-2 right-2 top-2 rounded-lg bg-brand-500 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-300 disabled:opacity-70"
          >
            {subscribe.isPending ? 'Signing up…' : 'Sign up'}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} className={className}>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-label="Email address"
          className="sm:max-w-xs"
        />
        <Button type="submit" disabled={subscribe.isPending}>
          {subscribe.isPending ? 'Subscribing…' : 'Subscribe'}
        </Button>
      </div>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </form>
  );
}
