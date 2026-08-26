import type { Metadata } from 'next';
import { IMPACT_STATS } from '@/components/marketing/content';
import { PageShell } from '@/components/marketing/page-shell';

export const metadata: Metadata = {
  title: 'Impact',
  description: 'The social and economic impact of digitizing group administration.',
};

export default function ImpactPage() {
  return (
    <PageShell
      title="Impact"
      description="What digitizing group administration is changing."
    >
      <p>
        Every group that moves off a paper book and onto Kitabu Yetu gets the same
        three things: a ledger nobody can lose or falsify, a member who can check their
        own balance without waiting for a meeting, and a treasurer who stops spending
        the night before every meeting reconciling an M-Pesa statement by hand.
      </p>
      <p>
        Multiplied across chamas, SACCOs, welfare groups and investment clubs, that adds
        up to real economic effect — money moving faster, records that survive a change
        of officers, and financial history a member can actually point to when they need
        it, for a loan application or simply their own peace of mind.
      </p>

      <h2>The numbers</h2>
      <p>
        We report real figures here, not estimates — pulled from the same ledger the
        platform runs on, the moment there is a track record worth publishing.
      </p>
      <div className="not-prose grid grid-cols-2 gap-4 sm:grid-cols-3">
        {IMPACT_STATS.map((stat) => (
          <div
            key={stat.label}
            className="rounded-lg border border-brand-blue-900/10 bg-paper px-4 py-5 text-center"
          >
            <p className="font-display text-2xl font-light text-brand-blue-900">{stat.value}</p>
            <p className="mt-1 text-xs font-medium uppercase tracking-wide text-brand-blue-900/55">
              {stat.label}
            </p>
          </div>
        ))}
      </div>
      <p className="text-sm text-brand-blue-900/55">
        Figures shown as — have not been published yet. See <a href="/status">system status</a>{' '}
        for what is running right now.
      </p>
    </PageShell>
  );
}
