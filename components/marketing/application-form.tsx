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
        jobSlug, jobTitle, applicantName: name, applicantEmail: email,
        applicantPhone: phone || undefined, coverNote: coverNote || undefined, resume,
      });
    } catch (err) {
      setError(getErrorMessage(err));
    }
  };

  if (submit.isSuccess) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-6 dark:border-green-900 dark:bg-green-950/40">
        <p className="font-bold text-gray-800 dark:text-white">Application received</p>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">
          Thanks for applying for {jobTitle} — our team will be in touch if there&rsquo;s a fit.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-lg border border-gray-200 bg-gray-50 p-6 dark:border-trueGray-700 dark:bg-trueGray-800/40">
      <p className="font-bold text-gray-800 dark:text-white">Apply for this role</p>
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
        <Input id="app_resume" type="file" accept=".pdf,.doc,.docx" onChange={(e) => setResume(e.target.files?.[0] ?? null)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="app_note">A note to the team</Label>
        <Textarea id="app_note" rows={4} value={coverNote} onChange={(e) => setCoverNote(e.target.value)} placeholder="Why this role, why Kitabu Yetu?" />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button type="submit" disabled={submit.isPending || !name.trim() || !email.trim()}>
        {submit.isPending ? 'Submitting…' : 'Submit application'}
      </Button>
    </form>
  );
}
