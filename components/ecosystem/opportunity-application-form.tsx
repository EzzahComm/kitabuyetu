'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { api, ApiError, getStoredAccessToken } from '@/lib/api/client';

interface OpportunityApplicationFormProps {
  opportunityId: string;
  groupName?: string;
  groupMemberCount?: number;
  onSuccess?: () => void;
}

interface EligibilityCheck {
  matches: boolean;
  failedRules: { id: string; name: string; error_message: string }[];
}

export function OpportunityApplicationForm({
  opportunityId,
  groupName,
  groupMemberCount,
  onSuccess,
}: OpportunityApplicationFormProps) {
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [eligibility, setEligibility] = useState<EligibilityCheck | null>(null);
  const [formData, setFormData] = useState({
    group_name: groupName || '',
    group_member_count: groupMemberCount ? String(groupMemberCount) : '',
    group_registration_number: '',
    contact_member_name: '',
    contact_member_phone: '',
    contact_member_email: '',
    message: '',
  });

  const { toast } = useToast();

  // Advisory only, and only worth checking for a visitor who's actually
  // logged in as a group official — an anonymous visitor gets the plain
  // form with no eligibility fetch (and no 401 noise) at all.
  useEffect(() => {
    if (!getStoredAccessToken()) return;
    let cancelled = false;
    api.get<EligibilityCheck>(`/ecosystem/opportunities/${opportunityId}/eligibility`)
      .then((result) => { if (!cancelled) setEligibility(result); })
      .catch(() => { /* silent — this is advisory, not required for the form to work */ });
    return () => { cancelled = true; };
  }, [opportunityId]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // The `api` client (not a raw fetch) is what actually attaches the
      // group's Bearer token from localStorage — a raw fetch() here used to
      // send no Authorization header at all, so proxy.ts's JWT check
      // rejected every submission with 401 before the route handler ever
      // ran, regardless of whether the visitor was logged in. Confirmed via
      // code reading, not a report: this form has never successfully
      // submitted an application.
      await api.post(`/ecosystem/opportunities/${opportunityId}/apply`, {
        ...formData,
        group_member_count: formData.group_member_count ? Number(formData.group_member_count) : undefined,
      });

      toast({
        title: 'Application submitted',
        description: 'The partner will review your application and get back to you.',
      });

      setSubmitted(true);
      onSuccess?.();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        toast({
          title: 'Log in required',
          description: 'Log in as a group official to submit this application.',
          variant: 'destructive',
        });
        return;
      }
      toast({
        title: 'Error',
        description: error instanceof ApiError ? error.message : 'Failed to submit application. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  if (submitted) {
    return (
      <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
        Application submitted. The partner will review it and respond.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {eligibility && (
        eligibility.matches ? (
          <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
            Your group appears eligible for this opportunity, based on its record.
          </div>
        ) : (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <p className="font-medium">Your group may not meet all of this partner&rsquo;s criteria:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {eligibility.failedRules.map((r) => (
                <li key={r.id}>{r.error_message || r.name}</li>
              ))}
            </ul>
            <p className="mt-1 text-xs">You can still apply — the partner makes the final call.</p>
          </div>
        )
      )}
      <div>
        <label className="block text-sm font-medium text-gray-900">Group Name *</label>
        <Input
          name="group_name"
          value={formData.group_name}
          onChange={handleChange}
          required
          placeholder="Your group's registered name"
          className="mt-1"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-900">Contact Person Name *</label>
        <Input
          name="contact_member_name"
          value={formData.contact_member_name}
          onChange={handleChange}
          required
          placeholder="Full name"
          className="mt-1"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-900">Phone Number *</label>
        <Input
          name="contact_member_phone"
          value={formData.contact_member_phone}
          onChange={handleChange}
          required
          placeholder="+254..."
          className="mt-1"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-900">Email Address</label>
        <Input
          name="contact_member_email"
          type="email"
          value={formData.contact_member_email}
          onChange={handleChange}
          placeholder="email@example.com"
          className="mt-1"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-900">Message (Optional)</label>
        <Textarea
          name="message"
          value={formData.message}
          onChange={handleChange}
          placeholder="Tell the partner about your group and why you're interested..."
          rows={4}
          className="mt-1"
        />
      </div>

      <Button type="submit" disabled={loading} className="w-full">
        {loading ? 'Submitting...' : 'Apply Now'}
      </Button>
    </form>
  );
}
