'use client';

import { useState, type FormEvent } from 'react';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { useSubmitApplication } from '@/hooks/use-careers';
import { getErrorMessage } from '@/lib/utils';

interface ApplicationFormProps {
  jobSlug: string;
  jobTitle: string;
}

export function ApplicationForm({ jobSlug, jobTitle }: ApplicationFormProps) {
  const submit = useSubmitApplication();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [coverNote, setCoverNote] = useState('');
  const [resume, setResume] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await submit.mutateAsync({
        jobSlug,
        jobTitle,
        applicantName: name,
        applicantEmail: email,
        applicantPhone: phone || undefined,
        coverNote: coverNote || undefined,
        resume,
      });
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  if (submit.isSuccess) {
    return (
      <div role="status" className="rounded-lg border border-brand-500 bg-brand-50 p-6">
        <p className="font-display text-xl font-semibold text-finanza-dark">Application received</p>
        <p className="mt-1 text-finanza-text">
          Thanks for applying for {jobTitle} — our team will be in touch if there&rsquo;s a fit.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5 rounded-lg border border-brand-100 bg-white p-6 sm:p-8">
      <div>
        <h2 className="font-display text-2xl font-semibold text-finanza-dark">Apply for this role</h2>
        <p className="mt-1 text-finanza-text">Fields marked * are required.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="app_name">Full name *</Label>
          <Input id="app_name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="app_email">Email *</Label>
          <Input id="app_email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="app_phone">Phone</Label>
        <Input id="app_phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="app_resume">Resume (PDF or Word, max 5MB)</Label>
        <Input
          id="app_resume"
          type="file"
          accept=".pdf,.doc,.docx"
          onChange={(e) => setResume(e.target.files?.[0] ?? null)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="app_note">A note to the team</Label>
        <Textarea
          id="app_note"
          rows={4}
          value={coverNote}
          onChange={(e) => setCoverNote(e.target.value)}
          placeholder="Why this role, why Kitabu Yetu?"
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <Button
        type="submit"
        size="lg"
        className="bg-brand-500 text-white hover:bg-brand-600"
        disabled={submit.isPending || !name.trim() || !email.trim()}
      >
        {submit.isPending ? 'Submitting…' : 'Submit application'}
      </Button>
    </form>
  );
}
