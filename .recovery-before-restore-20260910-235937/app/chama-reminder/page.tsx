import type { Metadata } from 'next';
import Link from 'next/link';
import { PageShell } from '@/components/marketing/page-shell';
import { PLAN_MONTHLY_FEES, PRODUCT_LABEL } from '@/types/enums';

export const metadata: Metadata = {
  title: 'Chama Reminder',
  description:
    'Remind. Inform. Celebrate. Mobilize. Automated SMS reminders and announcements for chamas, welfare groups and SACCOs across East Africa.',
};

/**
 * Chama Reminder — the communication tool. A separately purchasable product,
 * not a Kitabu Yetu feature, which is why every buy link below carries
 * ?product=chama_reminder: without it register_group() seeds a chart of
 * accounts the buyer never uses and quotes the Kitabu Yetu price.
 */
export default function ChamaReminderPage() {
  return (
    <PageShell
      title={PRODUCT_LABEL.chama_reminder}
      description="Remind. Inform. Celebrate. Mobilize."
    >
      <p>
        Chama Reminder keeps a group talking to its members without anyone having to
        remember to send the message. Contribution reminders, meeting notices,
        announcements and birthday wishes go out on schedule, by SMS, to the numbers
        the group already has.
      </p>

      <h2>What it does</h2>
      <ul className="ml-5 list-disc space-y-2">
        <li><strong>Contribution reminders.</strong> Scheduled nudges before and after a due date, sent once per member per cycle — never twice.</li>
        <li><strong>Meeting and event notices.</strong> Tell everyone at once, on a schedule you set.</li>
        <li><strong>Birthdays.</strong> Automatic, personalised to each member.</li>
        <li><strong>Announcements.</strong> One message to the whole group, or to a chosen list.</li>
        <li><strong>Personalised text.</strong> Templates fill in each member&rsquo;s own name and figures.</li>
        <li><strong>Opt-out respected.</strong> A member who opts out stops receiving messages, automatically.</li>
      </ul>

      <h2>It works on its own</h2>
      <p>
        Chama Reminder does not require Kitabu Yetu Bookkeeper. A group can sign up for
        reminders alone and add bookkeeping later if it wants to.
      </p>

      <h2>Pricing</h2>
      <p>
        From <strong>KES {PLAN_MONTHLY_FEES.chama_reminder.starter}/month</strong>, plus SMS
        credits. See <Link href="/pricing#chama-reminder">Chama Reminder pricing</Link>.
      </p>

      <div className="flex flex-wrap gap-3 pt-4">
        <Link
          href="/register?product=chama_reminder"
          className="rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Start with Chama Reminder
        </Link>
        <Link
          href="/pricing#chama-reminder"
          className="rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          See pricing
        </Link>
      </div>
    </PageShell>
  );
}
