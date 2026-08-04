'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { useEmailPreferences, useUpdatePreferences, type EmailPreference } from '@/hooks/use-email';
import { useToast } from '@/hooks/use-toast';

const CATEGORY_LABELS: Record<string, string> = {
  financial_reports:    'Financial Reports',
  loan_updates:         'Loan Updates',
  contribution_updates: 'Contribution Updates',
  meeting_invitations:  'Meeting Invitations',
  announcements:        'Group Announcements',
  billing:              'Billing & Invoices',
  birthday:             'Birthday Greetings',
  weekly_summary:       'Weekly Summary',
  monthly_statement:    'Monthly Statement',
};

const FREQUENCY_OPTIONS = [
  { value: 'immediate', label: 'Immediately' },
  { value: 'daily',     label: 'Daily digest' },
  { value: 'weekly',    label: 'Weekly digest' },
  { value: 'never',     label: 'Never'         },
];

export default function EmailPreferencesPage() {
  const { data, isLoading }  = useEmailPreferences();
  const updateMutation        = useUpdatePreferences();
  const { toast }             = useToast();
  // Derived state: render server data unless the user has made local edits.
  // This avoids the copy-props-to-state anti-pattern (no setState-in-effect).
  const [edits, setEdits]     = useState<EmailPreference[] | null>(null);
  const prefs: EmailPreference[] = edits ?? data ?? [];

  function togglePref(category: string, field: 'enabled' | 'frequency', value: string | boolean) {
    setEdits(
      prefs.map((p) => p.category === category ? { ...p, [field]: value } : p),
    );
  }

  async function handleSave() {
    await updateMutation.mutateAsync(prefs);
    setEdits(null); // resync with server after a successful save
    toast({ title: 'Preferences saved' });
  }

  return (
    <div className="space-y-4 p-6 max-w-2xl">
      <PageHeader
        title="Email Preferences"
        description="Control which emails you receive and how often"
        actions={
          <Button onClick={handleSave} disabled={updateMutation.isPending}>
            {updateMutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        }
      />

      <Card>
        <CardHeader><CardTitle className="text-base">Notification Categories</CardTitle></CardHeader>
        <CardContent className="divide-y">
          {isLoading
            ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 my-2 w-full" />)
            : prefs.map((pref) => (
                <div key={pref.category} className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => togglePref(pref.category, 'enabled', !pref.enabled)}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${pref.enabled ? 'bg-green-500' : 'bg-muted'}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-card shadow transition-transform ${pref.enabled ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                    <span className="text-sm font-medium">
                      {CATEGORY_LABELS[pref.category] ?? pref.category}
                    </span>
                  </div>
                  <Select
                    value={pref.frequency}
                    onValueChange={(v) => togglePref(pref.category, 'frequency', v)}
                    disabled={!pref.enabled}
                  >
                    <SelectTrigger className="w-40 h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FREQUENCY_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
        </CardContent>
      </Card>
    </div>
  );
}
