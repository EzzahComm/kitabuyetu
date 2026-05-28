/**
 * Daily M-Pesa reconciliation report.
 *
 * Fired by the cron (~23:00 EAT) — for each active group it aggregates the
 * day's M-Pesa activity and emails the treasurer + group admins a summary so
 * they can eyeball collections vs disbursements vs failures before close of
 * business. Day boundaries are computed in Africa/Nairobi (EAT) regardless of
 * server timezone.
 */
import { withAdminDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { sendFinancialReport } from './email.service';

interface GroupDailyStats {
  inbound_count:   number;
  inbound_total:   number;
  outbound_count:  number;
  outbound_total:  number;
  failed_count:    number;
  unrouted_count:  number;
}

const kes = (n: number) =>
  'KES ' + n.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export async function sendDailyMpesaReconReports(): Promise<{ groups: number; emailed: number }> {
  const groups = await withAdminDb((db) =>
    db.query<{ id: string; name: string }>(
      `SELECT id, name FROM groups WHERE is_active = true`,
    ).then((r) => r.rows),
  );

  const dayLabel = new Date().toLocaleDateString('en-KE', {
    day: '2-digit', month: 'short', year: 'numeric',
  });

  let emailed = 0;

  for (const group of groups) {
    const stats = await withAdminDb((db) =>
      db.query<GroupDailyStats>(
        `WITH day_start AS (
           SELECT date_trunc('day', now() AT TIME ZONE 'Africa/Nairobi')
                  AT TIME ZONE 'Africa/Nairobi' AS ts
         )
         SELECT
           COUNT(*) FILTER (WHERE direction='inbound'  AND status='completed')              AS inbound_count,
           COALESCE(SUM(amount) FILTER (WHERE direction='inbound'  AND status='completed'),0) AS inbound_total,
           COUNT(*) FILTER (WHERE direction='outbound' AND status='completed')              AS outbound_count,
           COALESCE(SUM(amount) FILTER (WHERE direction='outbound' AND status='completed'),0) AS outbound_total,
           COUNT(*) FILTER (WHERE status='failed')                                          AS failed_count,
           0 AS unrouted_count
         FROM mpesa_transactions, day_start
         WHERE group_id = $1 AND created_at >= day_start.ts`,
        [group.id],
      ).then((r) => r.rows[0]),
    );

    const unrouted = await withAdminDb((db) =>
      db.query<{ c: string }>(
        `SELECT COUNT(*) AS c FROM mpesa_unrouted
         WHERE candidate_group_id = $1 AND resolved = false`,
        [group.id],
      ).then((r) => Number(r.rows[0]?.c ?? 0)),
    );

    const inboundCount  = Number(stats?.inbound_count ?? 0);
    const outboundCount = Number(stats?.outbound_count ?? 0);
    const failedCount   = Number(stats?.failed_count ?? 0);

    // Skip groups with no activity AND nothing to action — avoids inbox noise.
    if (inboundCount === 0 && outboundCount === 0 && failedCount === 0 && unrouted === 0) {
      continue;
    }

    const officers = await withAdminDb((db) =>
      db.query<{ email: string }>(
        `SELECT m.email FROM members m
         JOIN group_members gm ON gm.member_id = m.id AND gm.group_id = $1
         WHERE m.email IS NOT NULL AND m.email <> ''
           AND gm.role IN ('group_admin','treasurer')
           AND gm.is_active = true`,
        [group.id],
      ).then((r) => r.rows.map((x) => x.email)),
    );
    if (officers.length === 0) continue;

    const html = buildReportHtml({
      groupName:     group.name,
      dayLabel,
      inboundCount,
      inboundTotal:  Number(stats?.inbound_total ?? 0),
      outboundCount,
      outboundTotal: Number(stats?.outbound_total ?? 0),
      failedCount,
      unroutedCount: unrouted,
    });

    for (const email of officers) {
      const res = await sendFinancialReport({
        to:            email,
        subject:       `M-Pesa daily summary — ${group.name} — ${dayLabel}`,
        html,
        groupId:       group.id,
        userId:        'system',
        requesterRole: 'group_admin',
      }).catch((err) => {
        logger.error('[mpesa-reports] email send failed', { groupId: group.id, err: String(err) });
        return { success: false } as { success: boolean };
      });
      if (res.success) emailed++;
    }
  }

  return { groups: groups.length, emailed };
}

function buildReportHtml(d: {
  groupName: string; dayLabel: string;
  inboundCount: number; inboundTotal: number;
  outboundCount: number; outboundTotal: number;
  failedCount: number; unroutedCount: number;
}): string {
  const net = d.inboundTotal - d.outboundTotal;
  const row = (label: string, value: string, emphasis = false) =>
    `<tr>
       <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#555;">${label}</td>
       <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;${emphasis ? 'font-weight:700;' : ''}">${value}</td>
     </tr>`;

  const alerts: string[] = [];
  if (d.failedCount > 0)   alerts.push(`${d.failedCount} failed transaction(s)`);
  if (d.unroutedCount > 0) alerts.push(`${d.unroutedCount} unrouted receipt(s) awaiting allocation`);

  return `
    <h2 style="margin:0 0 4px;">M-Pesa daily summary</h2>
    <p style="color:#777;margin:0 0 16px;">${d.groupName} · ${d.dayLabel}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      ${row('Money in (completed)',  `${d.inboundCount} · ${kes(d.inboundTotal)}`)}
      ${row('Money out (completed)', `${d.outboundCount} · ${kes(d.outboundTotal)}`)}
      ${row('Net movement', kes(net), true)}
      ${row('Failed transactions', String(d.failedCount))}
      ${row('Unrouted receipts', String(d.unroutedCount))}
    </table>
    ${alerts.length
      ? `<p style="margin-top:16px;padding:10px 12px;background:#fff3cd;border-radius:6px;color:#7a5b00;">
           ⚠ Needs attention: ${alerts.join('; ')}.
         </p>`
      : `<p style="margin-top:16px;color:#1a7f4b;">✓ No exceptions today.</p>`}
    <p style="margin-top:16px;font-size:12px;color:#999;">
      Generated automatically by Kitabu Yetu. Figures are for the EAT calendar day.
    </p>`;
}
