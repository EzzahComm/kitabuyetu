'use client';

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Mail } from 'lucide-react';
import { WhatsAppLogo } from './brand-icons';
import { cn } from '@/lib/utils';
import { CONTACT, whatsappHref } from './routes';

type Channel = 'whatsapp' | 'email';

interface CallbackFormProps {
  /** `callback` adds a mobile number field, as the template's "Request A Call-Back" does. */
  variant?: 'callback' | 'contact';
  className?: string;
}

const inputClass =
  'peer w-full rounded-lg border border-brand-100 bg-white px-3 pb-2 pt-6 text-finanza-dark placeholder-transparent transition-colors focus:border-brand-300 focus:outline-hidden focus:ring-4 focus:ring-brand-500/25';
const labelClass =
  'pointer-events-none absolute left-3 top-2 text-xs text-finanza-text transition-all peer-placeholder-shown:top-4 peer-placeholder-shown:text-base peer-focus:top-2 peer-focus:text-xs';

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="relative">
      {children}
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
    </div>
  );
}

/**
 * The template's call-back / contact form. The site has no public enquiry
 * endpoint, so rather than a form that silently goes nowhere (the template
 * ships its own as "currently inactive"), submitting opens WhatsApp or the
 * visitor's email app with the message already written, addressed to the
 * real CONTACT details.
 */
export function CallbackForm({ variant = 'callback', className }: CallbackFormProps) {
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  const [sent, setSent] = useState<Channel | null>(null);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const get = (key: string) => String(data.get(key) ?? '').trim();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const channel: Channel = submitter?.value === 'email' ? 'email' : 'whatsapp';

    const subject = get('subject') || (variant === 'callback' ? 'Call-back request' : 'Website enquiry');
    const greeting = variant === 'callback' ? 'Hello Kitabu Yetu, please call me back.' : 'Hello Kitabu Yetu,';
    const details = [
      `Name: ${get('name')}`,
      get('email') ? `Email: ${get('email')}` : null,
      get('mobile') ? `Mobile: ${get('mobile')}` : null,
      `Subject: ${subject}`,
    ].filter((line): line is string => line !== null);
    const body = [greeting, '', ...details, '', get('message')].join('\n');

    if (channel === 'whatsapp') {
      window.open(whatsappHref(CONTACT.phones[0], body), '_blank', 'noopener,noreferrer');
    } else {
      window.location.href = `mailto:${CONTACT.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    }
    setSent(channel);
  };

  return (
    <form onSubmit={onSubmit} className={cn('grid gap-4 sm:grid-cols-2', className)}>
      <Field id={id('name')} label="Your Name">
        <input
          id={id('name')}
          name="name"
          required
          autoComplete="name"
          placeholder="Your Name"
          className={cn(inputClass, 'h-14')}
        />
      </Field>
      <Field id={id('email')} label="Your Email">
        <input
          id={id('email')}
          name="email"
          type="email"
          autoComplete="email"
          placeholder="Your Email"
          className={cn(inputClass, 'h-14')}
        />
      </Field>
      {variant === 'callback' && (
        <Field id={id('mobile')} label="Your Mobile">
          <input
            id={id('mobile')}
            name="mobile"
            type="tel"
            autoComplete="tel"
            placeholder="Your Mobile"
            className={cn(inputClass, 'h-14')}
          />
        </Field>
      )}
      <div className={cn(variant === 'contact' && 'sm:col-span-2')}>
        <Field id={id('subject')} label="Subject">
          <input id={id('subject')} name="subject" placeholder="Subject" className={cn(inputClass, 'h-14')} />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field id={id('message')} label="Message">
          <textarea
            id={id('message')}
            name="message"
            required
            rows={4}
            placeholder="Message"
            className={cn(inputClass, 'min-h-[7.5rem] resize-y')}
          />
        </Field>
      </div>
      <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row">
        <button
          type="submit"
          value="whatsapp"
          className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-lg bg-brand-500 px-6 py-3.5 font-medium text-white transition-colors duration-500 hover:bg-brand-600 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
        >
          <WhatsAppLogo aria-hidden="true" size={20} />
          Send on WhatsApp
        </button>
        <button
          type="submit"
          value="email"
          className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-lg border border-brand-500 px-6 py-3.5 font-medium text-brand-500 transition-colors duration-500 hover:bg-brand-500 hover:text-white focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
        >
          <Mail aria-hidden="true" className="h-5 w-5" />
          Send by email
        </button>
      </div>
      <p role="status" className="text-sm text-finanza-text sm:col-span-2">
        {sent === 'whatsapp' && 'WhatsApp has opened with your message — press send there and we will reply.'}
        {sent === 'email' && `Your email app has opened with your message to ${CONTACT.email} — press send there.`}
        {!sent && 'Opens WhatsApp or your email app with your message ready to send.'}
      </p>
    </form>
  );
}
