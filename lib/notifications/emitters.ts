/**
 * Domain emitters: thin helpers that load just enough context for one kind of
 * event and hand it to emitActivity(). Keeping them here (not in each service)
 * means call sites are one line and the event shape stays consistent.
 *
 * Every helper is best-effort and never throws.
 */
import { withAdminDb } from '@/lib/db';
import { ActivityEventType } from './activity-events';
import { emitActivity } from './activity-notifier';

export interface WithdrawalNotifyExtra {
  actorUserId?: string;
  actorRole?: string;
  /** Kitabu Yetu admin who acted (platform approve/decline). */
  adminUserId?: string;
  reason?: string;
  receipt?: string | null;
  stage?: string;
}

const wdRef = (id: string) => `WD-${id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

/** Changi$ha campaign withdrawal lifecycle events. */
export async function emitWithdrawalEvent(
  withdrawalId: string,
  type: ActivityEventType,
  extra: WithdrawalNotifyExtra = {},
): Promise<void> {
  try {
    const row = await withAdminDb(async (db) => {
      const { rows } = await db.query<{
        id: string;
        group_id: string;
        gross_amount: string;
        net_amount: string;
        status: string;
        requested_by: string | null;
        campaign_id: string;
        campaign_title: string;
      }>(
        `SELECT w.id, w.group_id, w.gross_amount, w.net_amount, w.status, w.requested_by, w.campaign_id,
                c.title AS campaign_title
         FROM   campaign_withdrawals w JOIN campaigns c ON c.id = w.campaign_id
         WHERE  w.id = $1`,
        [withdrawalId],
      );
      let adminName: string | undefined;
      if (extra.adminUserId) {
        const r = await db.query<{ name: string | null; email: string | null }>(
          `SELECT COALESCE(NULLIF(TRIM(CONCAT(first_name,' ',last_name)),''), email) AS name, email
           FROM members WHERE id = $1`,
          [extra.adminUserId],
        );
        adminName = r.rows[0]?.name ?? r.rows[0]?.email ?? undefined;
      }
      return rows[0] ? { ...rows[0], adminName } : null;
    });
    if (!row) return;

    const isPlatformAction = !!extra.adminUserId;
    await emitActivity({
      type,
      dedupKey: `withdrawal:${row.id}:${type}`,
      group: { id: row.group_id, name: '' },
      actor: isPlatformAction
        ? { userId: extra.adminUserId, name: row.adminName, role: 'Kitabu Yetu admin' }
        : { userId: extra.actorUserId ?? row.requested_by ?? undefined, role: extra.actorRole },
      transaction: {
        id: row.id,
        reference: wdRef(row.id),
        type: 'Changi$ha withdrawal',
        amount: Number(row.gross_amount),
        currency: 'KES',
        status: row.status,
      },
      description: extra.reason ? `Reason: ${extra.reason}` : undefined,
      adminPath: '/admin/campaigns',
      metadata: {
        campaign: row.campaign_title,
        netToPayee: Number(row.net_amount),
        ...(extra.receipt ? { mpesaReceipt: extra.receipt } : {}),
        ...(extra.stage ? { stage: extra.stage } : {}),
        ...(extra.reason ? { reason: extra.reason } : {}),
        smsLines: [`Campaign: ${row.campaign_title}`],
      },
    });
  } catch {
    /* alerting must never break the workflow */
  }
}

export interface SmsBulkActivity {
  /** Stable per job so a retried job never re-alerts. */
  jobId: string;
  groupId: string;
  sentBy?: string;
  message: string;
  recipients: number;
  /** Known when the send finished inline; omitted when fanned out in chunks. */
  sent?: number;
  failed?: number;
  chunks?: number;
  campaignId?: string;
  kind?: 'bulk' | 'marketing' | 'campaign';
}

const preview = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * A group sent an SMS campaign / bulk message. One aggregated event per send —
 * never per recipient — with a message preview so admins can spot misuse.
 */
export async function emitSmsBulkActivity(a: SmsBulkActivity): Promise<void> {
  try {
    const finished = a.sent != null && a.failed != null;
    const type = !finished
      ? ActivityEventType.SMS_CAMPAIGN_SENT
      : a.sent === 0
        ? ActivityEventType.SMS_CAMPAIGN_FAILED
        : (a.failed ?? 0) > 0
          ? ActivityEventType.SMS_CAMPAIGN_PARTIAL
          : ActivityEventType.SMS_CAMPAIGN_SENT;
    await emitActivity({
      type,
      dedupKey: `smsbulk:${a.jobId}`,
      group: { id: a.groupId, name: '' },
      actor: a.sentBy ? { userId: a.sentBy } : undefined,
      transaction: {
        id: a.campaignId ?? a.jobId,
        reference: `SMS-${a.jobId.replace(/-/g, '').slice(0, 8).toUpperCase()}`,
        type: a.kind === 'marketing' ? 'Marketing SMS' : 'Bulk SMS',
        status: finished
          ? a.sent === 0
            ? 'failed'
            : (a.failed ?? 0) > 0
              ? 'partial'
              : 'sent'
          : `dispatching in ${a.chunks ?? 1} batch(es)`,
      },
      metadata: {
        recipients: a.recipients,
        ...(finished ? { successful: a.sent, failed: a.failed, smsCreditsUsed: a.sent } : {}),
        ...(a.chunks ? { batches: a.chunks } : {}),
        messagePreview: preview(a.message, 400),
        smsLines: [
          `Recipients: ${a.recipients}${finished ? ` (ok ${a.sent}, failed ${a.failed})` : ''}`,
          `Msg: "${preview(a.message, 90)}"`,
        ],
      },
    });
  } catch {
    /* never break the send */
  }
}

/** A single/few-recipient message sent manually by a group user. */
export async function emitSmsManualSend(a: {
  groupId: string;
  userId: string;
  message: string;
  recipients: number;
  reference: string;
}): Promise<void> {
  try {
    await emitActivity({
      type: ActivityEventType.SMS_MESSAGE_SENT,
      dedupKey: `smsmsg:${a.reference}`,
      group: { id: a.groupId, name: '' },
      actor: { userId: a.userId },
      transaction: {
        reference: `SMS-${a.reference.replace(/-/g, '').slice(0, 8).toUpperCase()}`,
        type: 'SMS',
        status: 'sent',
      },
      metadata: {
        recipients: a.recipients,
        messagePreview: preview(a.message, 400),
        smsLines: [`Recipients: ${a.recipients}`, `Msg: "${preview(a.message, 90)}"`],
      },
    });
  } catch {
    /* never break the send */
  }
}

/** Changi$ha campaign lifecycle events (created / submitted / approved / rejected / …). */
export async function emitCampaignEvent(
  campaignId: string,
  type: ActivityEventType,
  extra: { actorUserId?: string; adminUserId?: string; reason?: string } = {},
): Promise<void> {
  try {
    const c = await withAdminDb(async (db) => {
      const { rows } = await db.query<{
        id: string;
        group_id: string;
        title: string;
        status: string;
        target_amount: string;
        amount_raised: string;
        account_code: string;
      }>(
        'SELECT id, group_id, title, status, target_amount, amount_raised, account_code FROM campaigns WHERE id = $1',
        [campaignId],
      );
      return rows[0] ?? null;
    });
    if (!c) return;
    await emitActivity({
      type,
      dedupKey: `campaign:${c.id}:${type}`,
      group: { id: c.group_id, name: '' },
      actor: extra.adminUserId
        ? { userId: extra.adminUserId, role: 'Kitabu Yetu admin' }
        : extra.actorUserId
          ? { userId: extra.actorUserId }
          : undefined,
      transaction: {
        id: c.id,
        reference: c.account_code,
        type: 'Changi$ha campaign',
        amount: Number(c.target_amount),
        currency: 'KES',
        status: c.status,
      },
      description: extra.reason ? `Reason: ${extra.reason}` : undefined,
      adminPath: '/admin/campaigns',
      metadata: {
        campaign: c.title,
        target: Number(c.target_amount),
        raised: Number(c.amount_raised),
        ...(extra.reason ? { reason: extra.reason } : {}),
        smsLines: [`Campaign: ${c.title}`],
      },
    });
  } catch {
    /* alerting must never break the workflow */
  }
}
