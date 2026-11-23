'use client';
import { useRef, useState, type FormEvent } from 'react';
export function EnquiryForm({ slug }: { slug?: string }) {
  const [busy, setBusy] = useState(false),
    [result, setResult] = useState('');
  const key = useRef('');
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!slug || busy) return;
    const form = event.currentTarget,
      data = new FormData(form);
    key.current ||= crypto.randomUUID();
    setBusy(true);
    setResult('');
    try {
      const response = await fetch('/api/sites/' + slug + '/enquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestKey: key.current,
          email: data.get('email'),
          message: data.get('message'),
          consent: data.get('consent') === 'on',
          website: data.get('website'),
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Please try again.');
      form.reset();
      key.current = '';
      setResult('Your enquiry has been received.');
    } catch (e) {
      setResult(e instanceof Error ? e.message : 'Unable to send your enquiry.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={send}
      onChange={() => {
        key.current = '';
        setResult('');
      }}
      className="max-w-xl space-y-3"
    >
      <fieldset disabled={busy || !slug} className="grid gap-3">
        <label>
          Your email
          <input
            type="email"
            name="email"
            required
            maxLength={254}
            className="block w-full rounded border bg-white p-2"
          />
        </label>
        <label>
          Message
          <textarea
            name="message"
            required
            maxLength={1500}
            rows={3}
            className="block w-full rounded border bg-white p-2"
          />
        </label>
        <input aria-hidden="true" className="hidden" name="website" tabIndex={-1} autoComplete="off" />
        <label>
          <input type="checkbox" name="consent" required /> I agree to share my email and message with this organization
          so it can respond.
        </label>
        <button className="justify-self-start rounded-full bg-[#194837] px-5 py-2 text-white disabled:opacity-60">
          {busy ? 'Sending…' : 'Send enquiry'}
        </button>
      </fieldset>
      <p role="status">{result}</p>
    </form>
  );
}
