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
}

export function NewsletterSignupForm({ source, className }: NewsletterSignupFormProps) {
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
    return (
      <p className={className}>
        You&rsquo;re subscribed. Thanks for following along.
      </p>
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
