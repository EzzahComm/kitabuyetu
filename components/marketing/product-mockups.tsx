import type { ReactNode } from 'react';
import {
  BarChart2, BookOpen, CreditCard, LayoutDashboard, Landmark, Users, Wallet,
  Check, ArrowUpRight, FileCheck, type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/* ────────────────────────────────────────────────────────────────────────────
 * Component-drawn representations of the real Kitabu Yetu UI.
 *
 * Deliberately NOT stock screenshots and NOT invented dashboards: every label
 * below is a string the product actually renders. The sidebar items are
 * components/layout/sidebar.tsx's real nav; the stat tiles are the real titles
 * from app/(dashboard)/dashboard/page.tsx ("Cash / M-Pesa", "Total savings",
 * "Outstanding loans", "This month's contributions", "Welfare fund",
 * "Members"); the payment card mirrors the real allocation flow, including
 * showing the MEMBERSHIP NUMBER as the payment reference — which is the only
 * public payment identifier the payment architecture allows on a
 * member-facing surface.
 *
 * The one real screenshot in the repo (public/screenshots/dashboard.png) is a
 * flat blue placeholder, so drawing these in markup is also the only way to
 * show the product honestly today. Figures are illustrative and typical of a
 * mid-size chama; nothing here is a live number or a customer's data.
 * ──────────────────────────────────────────────────────────────────────────── */

const SHADOW = 'shadow-[0_28px_70px_-30px_rgba(4,22,47,0.45)]';

/** The app-window chrome shared by every mockup. */
function AppWindow({
  title, children, className,
}: { title: string; children: ReactNode; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'overflow-hidden rounded-xl bg-white ring-1 ring-brand-blue-900/10',
        SHADOW,
        className,
      )}
    >
      <div className="flex items-center gap-2 border-b border-brand-blue-900/[0.07] bg-brand-blue-900/[0.025] px-4 py-2.5">
        <span className="flex gap-1.5">
          <span className="h-2 w-2 rounded-full bg-brand-blue-900/15" />
          <span className="h-2 w-2 rounded-full bg-brand-blue-900/15" />
          <span className="h-2 w-2 rounded-full bg-brand-blue-900/15" />
        </span>
        <span className="mx-auto truncate font-mono text-[10px] uppercase tracking-[0.16em] text-brand-blue-900/40">
          {title}
        </span>
      </div>
      {children}
    </div>
  );
}

/** The real sidebar, at mockup scale. */
const SIDEBAR: { label: string; icon: LucideIcon; active?: boolean }[] = [
  { label: 'Dashboard',     icon: LayoutDashboard, active: true },
  { label: 'Members',       icon: Users },
  { label: 'Contributions', icon: CreditCard },
  { label: 'Loans',         icon: Landmark },
  { label: 'Finance',       icon: Wallet },
  { label: 'Reports',       icon: BarChart2 },
];

const TILES = [
  { label: 'Total savings',            value: '842,300', tone: 'brand' as const },
  { label: 'Outstanding loans',        value: '210,500', tone: 'plain' as const },
  { label: "This month's contributions", value: '96,400', tone: 'plain' as const },
];

const ACTIVITY = [
  { name: 'Wanjiku N.',    detail: 'Contribution · M-Pesa',    amount: '+3,000' },
  { name: 'Otieno D.',     detail: 'Contribution · M-Pesa',    amount: '+1,500' },
  { name: 'Achieng M.',    detail: 'Loan repayment · M-Pesa',  amount: '+5,200' },
  { name: 'Welfare payout', detail: 'Approved · B2C',          amount: '−8,000', out: true },
];

export function DashboardMockup({ className }: { className?: string }) {
  return (
    <AppWindow title="Group dashboard" className={className}>
      <div className="flex">
        {/* Sidebar rail */}
        <div className="hidden w-[132px] shrink-0 border-r border-brand-blue-900/[0.07] bg-brand-blue-900/[0.02] py-4 sm:block">
          <ul className="space-y-0.5 px-2">
            {SIDEBAR.map((item) => (
              <li key={item.label}>
                <span
                  className={cn(
                    'flex items-center gap-2 rounded-md px-2.5 py-2 text-[11px] font-medium',
                    item.active
                      ? 'bg-brand-orange-500/10 text-brand-orange-700'
                      : 'text-brand-blue-900/50',
                  )}
                >
                  <item.icon className="h-3.5 w-3.5" />
                  {item.label}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Main */}
        <div className="min-w-0 flex-1 p-4 sm:p-5">
          <p className="font-display text-lg font-normal text-brand-blue-900">
            Welcome back, Grace
          </p>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-brand-blue-900/40">
            Umoja Women&apos;s Chama · 34 members
          </p>

          {/* Two-up below 640 px, three-up above. At 320 px a third column
              leaves ~54 px of content width, and "This month's contributions"
              wraps to four lines in it. */}
          <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {TILES.map((tile, i) => (
              <div
                key={tile.label}
                className={cn(
                  'rounded-lg p-3',
                  i === TILES.length - 1 && 'col-span-2 sm:col-span-1',
                  tile.tone === 'brand'
                    ? 'bg-brand-orange-50 ring-1 ring-brand-orange-500/15'
                    : 'bg-brand-blue-900/[0.035]',
                )}
              >
                <p className="font-mono text-[8.5px] uppercase leading-tight tracking-[0.1em] text-brand-blue-900/45">
                  {tile.label}
                </p>
                <p className="mt-1.5 font-mono text-[13px] font-medium tabular-nums text-brand-blue-900">
                  <span className="text-[9px] text-brand-blue-900/45">KSh </span>
                  {tile.value}
                </p>
              </div>
            ))}
          </div>

          <p className="mt-5 font-mono text-[9px] uppercase tracking-[0.16em] text-brand-blue-900/40">
            Recent activity
          </p>
          <ul className="mt-2 divide-y divide-brand-blue-900/[0.05]">
            {ACTIVITY.map((row) => (
              <li key={row.name} className="flex items-center justify-between gap-3 py-2">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span
                    className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-full',
                      row.out ? 'bg-brand-orange-500' : 'bg-brand-orange-500',
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-[11px] font-medium text-brand-blue-900/85">
                      {row.name}
                    </span>
                    <span className="block truncate font-mono text-[9px] text-brand-blue-900/40">
                      {row.detail}
                    </span>
                  </span>
                </span>
                <span
                  className={cn(
                    'shrink-0 font-mono text-[11px] font-medium tabular-nums',
                    row.out ? 'text-brand-orange-600' : 'text-brand-orange-700',
                  )}
                >
                  {row.amount}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </AppWindow>
  );
}

/** The M-Pesa receipt and its automatic split — the product's signature moment. */
export function PaymentMockup({ className }: { className?: string }) {
  const split = [
    { label: 'Savings',        amount: '2,000', width: 'w-[66%]' },
    { label: 'Welfare fund',   amount: '500',   width: 'w-[17%]' },
    { label: 'Loan repayment', amount: '500',   width: 'w-[17%]' },
  ];
  return (
    <div
      aria-hidden="true"
      className={cn(
        'overflow-hidden rounded-xl bg-white p-5 ring-1 ring-brand-blue-900/10 sm:p-6',
        SHADOW,
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4 border-b border-dashed border-brand-blue-900/15 pb-4">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-brand-blue-900/45">
            Contribution received
          </p>
          <p className="mt-1.5 font-display text-3xl font-normal tabular-nums text-brand-blue-900 sm:text-[2.25rem]">
            KSh 3,000
          </p>
        </div>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-orange-50 ring-1 ring-brand-orange-500/20">
          <Check className="h-5 w-5 text-brand-orange-600" />
        </span>
      </div>

      <dl className="space-y-2 py-4 font-mono text-[11px]">
        {[
          ['Member', 'Wanjiku N.'],
          ['M-Pesa receipt', 'SKE3X9QW12'],
          ['Account reference', 'BG 10253 4'],
        ].map(([key, value], i) => (
          <div key={key} className="flex items-center justify-between gap-3">
            <dt className="text-brand-blue-900/45">{key}</dt>
            <dd className={i === 1 ? 'font-medium text-brand-orange-700' : 'text-brand-blue-900/80'}>
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="rounded-lg bg-brand-blue-900/[0.035] p-4">
        <p className="mb-3 font-mono text-[9.5px] uppercase tracking-[0.18em] text-brand-blue-900/45">
          Split to the ledger
        </p>
        {split.map((row) => (
          <div key={row.label} className="mb-2.5 last:mb-0">
            <div className="mb-1 flex items-center justify-between font-mono text-[10.5px]">
              <span className="text-brand-blue-900/65">{row.label}</span>
              <span className="font-medium tabular-nums text-brand-blue-900">KSh {row.amount}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-brand-blue-900/10">
              <div className={cn('h-full rounded-full bg-brand-orange-500', row.width)} />
            </div>
          </div>
        ))}
      </div>

      <p className="mt-4 text-center font-mono text-[9.5px] uppercase tracking-[0.18em] text-brand-blue-900/35">
        Journal posted · receipt sent
      </p>
    </div>
  );
}

/** Reports: a contributions trend plus the trial-balance check. */
export function ReportsMockup({ className }: { className?: string }) {
  const bars = [38, 55, 47, 71, 60, 84, 76, 92];
  return (
    <AppWindow title="Reports" className={className}>
      <div className="p-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-brand-blue-900/45">
              Contributions · last 8 months
            </p>
            <p className="mt-1 flex items-baseline gap-2 font-display text-2xl font-normal tabular-nums text-brand-blue-900">
              KSh 1.24M
              <span className="flex items-center gap-0.5 font-sans text-[11px] font-semibold text-brand-orange-600">
                <ArrowUpRight className="h-3 w-3" />18%
              </span>
            </p>
          </div>
        </div>

        <div className="mt-5 flex h-28 items-end gap-1.5" role="presentation">
          {bars.map((height, i) => (
            <div
              key={`${height}-${i}`}
              className="flex-1 rounded-t-[3px] bg-brand-orange-500/20"
              style={{ height: `${height}%` }}
            >
              <span className="block h-1.5 rounded-t-[3px] bg-brand-orange-500" />
            </div>
          ))}
        </div>

        <div className="mt-5 grid grid-cols-3 gap-3 border-t border-brand-blue-900/[0.07] pt-4">
          {[
            { label: 'Trial balance', value: 'Balanced', tone: 'good' as const },
            { label: 'Members',       value: '34 active', tone: 'plain' as const },
            { label: 'Loans out',     value: '7 running', tone: 'plain' as const },
          ].map((item) => (
            <div key={item.label}>
              <p className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-brand-blue-900/40">
                {item.label}
              </p>
              <p
                className={cn(
                  'mt-1 text-[11px] font-medium',
                  item.tone === 'good' ? 'text-brand-orange-700' : 'text-brand-blue-900/80',
                )}
              >
                {item.value}
              </p>
            </div>
          ))}
        </div>
      </div>
    </AppWindow>
  );
}

/** The member's own view — the passbook portal at /me. */
export function MemberPhoneMockup({ className }: { className?: string }) {
  const rows = [
    { label: 'Contribution',   sub: 'Today · 08:14',  amount: '+3,000' },
    { label: 'Loan repayment', sub: '12 Aug',         amount: '−1,200', out: true },
    { label: 'Contribution',   sub: '01 Aug',         amount: '+3,000' },
  ];
  return (
    <div
      aria-hidden="true"
      className={cn(
        'w-[228px] overflow-hidden rounded-[1.9rem] border-[7px] border-brand-blue-900 bg-white',
        SHADOW,
        className,
      )}
    >
      <div className="relative bg-brand-blue-900 px-4 pb-5 pt-6">
        <span className="absolute left-1/2 top-1.5 h-1 w-14 -translate-x-1/2 rounded-full bg-white/25" />
        <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-brand-blue-100/50">
          My passbook
        </p>
        <p className="mt-1 font-display text-2xl font-normal tabular-nums text-white">
          KSh 24,600
        </p>
        <p className="mt-1 flex items-center gap-1 font-mono text-[10px] text-brand-orange-400">
          <ArrowUpRight className="h-3 w-3" />
          KSh 3,000 this month
        </p>
      </div>

      <ul className="divide-y divide-brand-blue-900/[0.06] px-4">
        {rows.map((row, i) => (
          <li key={`${row.label}-${i}`} className="flex items-center justify-between gap-2 py-2.5">
            <span>
              <span className="block text-[11px] font-medium text-brand-blue-900">{row.label}</span>
              <span className="block font-mono text-[9px] text-brand-blue-900/40">{row.sub}</span>
            </span>
            <span
              className={cn(
                'font-mono text-[11px] font-medium tabular-nums',
                row.out ? 'text-brand-orange-600' : 'text-brand-orange-700',
              )}
            >
              {row.amount}
            </span>
          </li>
        ))}
      </ul>

      <div className="m-4 rounded-lg bg-brand-orange-600 py-2.5 text-center">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-white">
          Pay with M-Pesa
        </span>
      </div>
    </div>
  );
}

/** The share ledger's summary tiles and top-holders list — the real /shares
 *  page, at mockup scale. Labels match GroupSummary/Holding from
 *  app/(dashboard)/shares/page.tsx exactly: "Share capital", "Shares issued",
 *  "Shareholders", "Top holders", "Invested", "Appreciation". Deliberately
 *  never shows a percentage stake — the real page only ever renders KES
 *  amounts, so the mockup doesn't either. */
const SHARE_TILES = [
  { label: 'Share capital', value: '1,240,000', unit: 'KSh ', tone: 'brand' as const },
  { label: 'Shares issued', value: '9,860',      unit: '',     tone: 'plain' as const },
];

const TOP_HOLDERS = [
  { name: 'Achieng M.', detail: '620 shares · KSh 62,000 invested', appreciation: '+4,800' },
  { name: 'Otieno D.',  detail: '540 shares · KSh 54,000 invested', appreciation: '+3,100' },
  { name: 'Wanjiku N.', detail: '410 shares · KSh 41,000 invested', appreciation: '+2,050' },
];

export function SharesMockup({ className }: { className?: string }) {
  return (
    <AppWindow title="Share capital" className={className}>
      <div className="p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-2.5">
          {SHARE_TILES.map((tile) => (
            <div
              key={tile.label}
              className={cn(
                'rounded-lg p-3',
                tile.tone === 'brand'
                  ? 'bg-brand-orange-50 ring-1 ring-brand-orange-500/15'
                  : 'bg-brand-blue-900/[0.035]',
              )}
            >
              <p className="font-mono text-[8.5px] uppercase leading-tight tracking-[0.1em] text-brand-blue-900/45">
                {tile.label}
              </p>
              <p className="mt-1.5 font-mono text-[13px] font-medium tabular-nums text-brand-blue-900">
                <span className="text-[9px] text-brand-blue-900/45">{tile.unit}</span>
                {tile.value}
              </p>
            </div>
          ))}
        </div>

        <p className="mt-5 font-mono text-[9px] uppercase tracking-[0.16em] text-brand-blue-900/40">
          Top holders
        </p>
        <ul className="mt-2 divide-y divide-brand-blue-900/[0.05]">
          {TOP_HOLDERS.map((holder) => (
            <li key={holder.name} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0">
                <span className="block truncate text-[11px] font-medium text-brand-blue-900/85">
                  {holder.name}
                </span>
                <span className="block truncate font-mono text-[9px] text-brand-blue-900/40">
                  {holder.detail}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[11px] font-medium tabular-nums text-brand-orange-700">
                {holder.appreciation}
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-4 flex items-center gap-2 border-t border-brand-blue-900/[0.07] pt-4 font-mono text-[9.5px] uppercase tracking-[0.18em] text-brand-blue-900/35">
          <FileCheck className="h-3 w-3" />
          PDF certificate issued on every transaction
        </p>
      </div>
    </AppWindow>
  );
}

/** SMS + statement — what the member receives without signing in. */
export function MessagesMockup({ className }: { className?: string }) {
  return (
    <AppWindow title="Messages" className={className}>
      <div className="space-y-3 p-5">
        {[
          {
            tag: 'Confirmation · sent',
            body: 'KITABU YETU: Received KSh 3,000 from WANJIKU N. Ref SKE3X9QW12. Savings 2,000 · Welfare 500 · Loan 500. Balance KSh 24,600.',
          },
          {
            tag: 'Reminder · scheduled',
            body: 'KITABU YETU: Umoja Women’s Chama monthly contribution of KSh 3,000 is due on 30 Aug. Pay via PayBill, account BG 10253 4.',
          },
          {
            tag: 'Announcement · sent',
            body: 'KITABU YETU: Meeting this Saturday, 2pm at the community hall. Agenda: loan approvals and the half-year report.',
          },
        ].map((msg) => (
          <div key={msg.tag} className="rounded-lg bg-brand-blue-900/[0.03] p-3.5">
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-brand-orange-600">
              {msg.tag}
            </p>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-brand-blue-900/75">
              {msg.body}
            </p>
          </div>
        ))}
        <p className="flex items-center gap-2 pt-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-brand-blue-900/40">
          <BookOpen className="h-3 w-3" />
          Statements and receipts also go out as PDF
        </p>
      </div>
    </AppWindow>
  );
}
