'use client';

import Link from 'next/link';
import { Cake, Send, Users2, MessageSquare } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { SummaryStatsGrid, SectionHeader } from '@/components/dashboard/sms/shared';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useMembers } from '@/hooks/use-members';
import { useSmsCreditBalance } from '@/hooks/use-billing';
import { useBirthdays, useSmsSettings } from '@/hooks/use-sms-settings';
import { formatDate } from '@/lib/utils';

/** How many of the upcoming birthdays to surface here before deferring to the full page. */
const PREVIEW_COUNT = 5;

export default function ReminderDashboardPage() {
  const { data: members }     = useMembers({ page: 1, limit: 1 });
  const { data: smsBalance }  = useSmsCreditBalance();
  const { data: birthdays }   = useBirthdays();
  const { data: settings }    = useSmsSettings();

  const credits = smsBalance ? Math.floor(Number(smsBalance.credits)) : null;
  const upcoming = birthdays?.upcoming ?? [];

  // Deliberately four plain numbers rather than charts. The people running a
  // chama want to know whether they can send, to how many, and what is due —
  // not to interpret a trend line.
  const stats = [
    {
      label: 'Members',
      value: members?.total ?? '—',
      tone:  'text-foreground',
    },
    {
      label: 'SMS credits',
      value: credits ?? '—',
      // The only number that stops the product working when it hits zero.
      tone:  credits != null && credits < 50 ? 'text-amber-600' : 'text-foreground',
    },
    {
      label: 'Birthdays (30d)',
      value: upcoming.length,
      tone:  'text-foreground',
    },
    {
      label: 'Auto-greetings',
      value: settings?.autoSendBirthday ? 'On' : 'Off',
      tone:  settings?.autoSendBirthday ? 'text-emerald-600' : 'text-muted-foreground',
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description="Remind. Inform. Celebrate. Mobilize." />

      <SummaryStatsGrid items={stats} />

      {credits != null && credits < 50 && (
        <Card className="border-amber-200 bg-amber-50/60">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div>
              <p className="text-sm font-semibold text-amber-900">Low SMS credits</p>
              <p className="mt-0.5 text-xs text-amber-800">
                You have {credits} credits left. Messages stop sending at zero.
              </p>
            </div>
            <Button asChild size="sm">
              <Link href="/reminder/usage">Top up</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardContent className="space-y-3 py-5">
            <SectionHeader title="Coming up" subtitle="Birthdays in the next 30 days" />
            {upcoming.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                No birthdays in the next 30 days.
              </p>
            ) : (
              <ul className="divide-y">
                {upcoming.slice(0, PREVIEW_COUNT).map((b) => (
                  <li key={b.memberId} className="flex items-center justify-between py-2 text-sm">
                    <span className="font-medium text-foreground">{b.firstName} {b.lastName}</span>
                    <span className="text-muted-foreground">{formatDate(b.nextBirthday)}</span>
                  </li>
                ))}
              </ul>
            )}
            {upcoming.length > PREVIEW_COUNT && (
              <Link href="/reminder/birthdays" className="text-sm font-medium text-brand-600 hover:underline">
                See all {upcoming.length} →
              </Link>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 py-5">
            <SectionHeader title="Quick actions" />
            <div className="grid gap-2">
              <Button asChild variant="outline" className="justify-start">
                <Link href="/reminder/messages"><Send size={15} className="mr-2" /> Send a message</Link>
              </Button>
              <Button asChild variant="outline" className="justify-start">
                <Link href="/reminder/campaigns"><MessageSquare size={15} className="mr-2" /> Start a campaign</Link>
              </Button>
              <Button asChild variant="outline" className="justify-start">
                <Link href="/reminder/members"><Users2 size={15} className="mr-2" /> Manage members</Link>
              </Button>
              <Button asChild variant="outline" className="justify-start">
                <Link href="/reminder/birthdays"><Cake size={15} className="mr-2" /> Birthday settings</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
