import { ArrowDownToLine, Building2, HandCoins, Hourglass, Smartphone, Wallet } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { PublicCampaignStatement } from '@/lib/services/campaign-statement.service';

const kes = (n: number) => `KES ${n.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
const date = (iso: string) =>
  new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });

function Tile({ icon: Icon, label, value, hint }: { icon: LucideIcon; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-brand-100 bg-white p-4">
      <p className="flex items-center gap-2 text-sm text-finanza-text">
        <Icon aria-hidden="true" className="h-4 w-4 text-brand-500" />
        {label}
      </p>
      <p className="mt-1 font-display text-xl font-bold text-finanza-dark">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-finanza-text">{hint}</p>}
    </div>
  );
}

/**
 * The public money trail for one campaign: what came in, what was released,
 * to whom, and what is still held. Data comes from
 * getPublicCampaignStatement, which never returns phone numbers or receipts.
 */
export function CampaignStatement({ statement }: { statement: PublicCampaignStatement }) {
  const { releases, supporters } = statement;

  return (
    <section aria-labelledby="statement-heading" className="mt-12 space-y-8">
      <div>
        <h2 id="statement-heading" className="font-display text-2xl font-semibold text-finanza-dark">
          Campaign statement
        </h2>
        <p className="mt-1 text-sm text-finanza-text">
          Every donation arrives in Kitabu Yetu&apos;s M-Pesa paybill and is recorded here. Funds leave only when
          released to the campaign&apos;s payee.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          icon={HandCoins}
          label="Donated"
          value={kes(statement.totalDonated)}
          hint={`${statement.donationCount} ${statement.donationCount === 1 ? 'donation' : 'donations'}`}
        />
        <Tile icon={ArrowDownToLine} label="Released" value={kes(statement.totalReleased)} />
        <Tile icon={Hourglass} label="Being released" value={kes(statement.pendingRelease)} />
        <Tile icon={Wallet} label="Held for the campaign" value={kes(statement.heldBalance)} />
      </div>

      <div>
        <h3 className="font-display text-lg font-semibold text-finanza-dark">Funds released</h3>
        {releases.length === 0 ? (
          <p className="mt-2 text-sm text-finanza-text">No funds have been released yet.</p>
        ) : (
          <div className="mt-3 overflow-x-auto rounded-lg border border-brand-100">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead className="bg-brand-50 text-finanza-dark">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Date
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Paid to
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">
                    Received
                  </th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">
                    Fees
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-100 text-finanza-text">
                {releases.map((r, i) => (
                  <tr key={`${r.releasedAt}-${i}`}>
                    <td className="whitespace-nowrap px-4 py-2.5">{date(r.releasedAt)}</td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-2">
                        {r.method === 'phone' ? (
                          <Smartphone aria-hidden="true" className="h-4 w-4 text-brand-500" />
                        ) : (
                          <Building2 aria-hidden="true" className="h-4 w-4 text-brand-500" />
                        )}
                        {r.method === 'phone'
                          ? 'M-Pesa number'
                          : `${r.payeeName ?? 'Business'} (${r.method === 'paybill' ? 'paybill' : 'till'})`}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-medium text-finanza-dark">
                      {kes(r.netAmount)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-right">{kes(r.platformFee + r.mpesaCharge)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h3 className="font-display text-lg font-semibold text-finanza-dark">Recent supporters</h3>
        {supporters.length === 0 ? (
          <p className="mt-2 text-sm text-finanza-text">Be the first to support this campaign.</p>
        ) : (
          <ul className="mt-3 divide-y divide-brand-100 rounded-lg border border-brand-100">
            {supporters.map((s, i) => (
              <li key={`${s.givenAt}-${i}`} className="flex items-start justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-finanza-dark">{s.name ?? 'Anonymous supporter'}</p>
                  {s.message && <p className="mt-0.5 wrap-break-word text-sm text-finanza-text">{s.message}</p>}
                  <p className="mt-0.5 text-xs text-finanza-text">{date(s.givenAt)}</p>
                </div>
                <p className="shrink-0 font-semibold text-finanza-dark">{kes(s.amount)}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
