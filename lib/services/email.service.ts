import { sendEmailWithFallback } from '@/lib/email/provider';
import { renderTemplate, interpolate, wrapWithBranding, loadBranding } from '@/lib/email/templates/engine';
import { DEFAULT_TEMPLATES } from '@/lib/email/templates/defaults';
import { enqueue } from '@/lib/queue';
import { withAdminDb } from '@/lib/db';
import type { EmailPayload, EmailResult } from '@/lib/email/provider';

export interface SendTemplatedOptions {
  templateKey: string;
  to: string | string[];
  vars: Record<string, string | number | boolean | null | undefined>;
  groupId?: string | null;
  userId?: string;
  locale?: string;
  attachments?: EmailPayload['attachments'];
  referenceId?: string;
  referenceType?: string;
  from?: string;
  replyTo?: string;
}

// Send using a named template (DB first, inline fallback)
export async function sendTemplatedEmail(opts: SendTemplatedOptions): Promise<EmailResult> {
  const fallbackTpl = DEFAULT_TEMPLATES[opts.templateKey];

  const { subject, html } = await renderTemplate(
    opts.templateKey,
    opts.vars,
    opts.groupId ?? null,
    opts.locale ?? 'en',
    fallbackTpl?.body,
  ).catch(async () => {
    // If no DB template AND no inline fallback, build a minimal email
    const branding = await loadBranding(opts.groupId ?? null);
    const body = `<p>${JSON.stringify(opts.vars)}</p>`;
    return { subject: String(opts.vars.subject ?? 'Kitabu Yetu'), html: wrapWithBranding(body, branding) };
  });

  return sendEmailWithFallback({
    to: opts.to,
    subject,
    html,
    from: opts.from,
    replyTo: opts.replyTo,
    attachments: opts.attachments,
    groupId: opts.groupId ?? undefined,
    userId: opts.userId,
    templateKey: opts.templateKey,
    category: categorize(opts.templateKey),
    referenceId: opts.referenceId,
    referenceType: opts.referenceType,
  });
}

// Queue an email for async delivery (via cron dequeue)
export async function queueEmail(
  opts: SendTemplatedOptions & { delayMs?: number; priority?: 'high' | 'normal' | 'low' },
): Promise<string> {
  const queueName = opts.priority === 'high' ? 'email:high' : opts.priority === 'low' ? 'email:low' : 'email:send';
  return enqueue(queueName, { type: 'templated', ...opts }, { delayMs: opts.delayMs, maxAttempts: 5 });
}

// Schedule an email at a specific time (writes to email_schedules table)
export async function scheduleEmail(opts: {
  templateKey: string;
  to: string | string[];
  vars: Record<string, string | number | boolean | null | undefined>;
  groupId?: string | null;
  userId?: string;
  sendAt: Date;
  name?: string;
  referenceId?: string;
  referenceType?: string;
}): Promise<string> {
  const { rows } = await withAdminDb((db) =>
    db.query(
      `INSERT INTO email_schedules
         (group_id, name, template_key, recipient_email, variables,
          schedule_type, next_run_at, is_active, created_by, reference_id, reference_type)
       VALUES ($1,$2,$3,$4,$5,'once',$6,true,$7,$8,$9) RETURNING id`,
      [
        opts.groupId ?? null,
        opts.name ?? opts.templateKey,
        opts.templateKey,
        Array.isArray(opts.to) ? opts.to[0] : opts.to,
        JSON.stringify(opts.vars),
        opts.sendAt.toISOString(),
        opts.userId ?? null,
        opts.referenceId ?? null,
        opts.referenceType ?? null,
      ],
    ),
  );
  return rows[0].id;
}

// Send a financial report — restricted to treasurer / group_admin roles
export async function sendFinancialReport(opts: {
  to: string;
  subject: string;
  html: string;
  groupId: string;
  userId: string;
  requesterRole: string;
  attachments?: EmailPayload['attachments'];
}): Promise<EmailResult> {
  const allowed = ['treasurer', 'group_admin', 'superadmin', 'ngo_coordinator'];
  if (!allowed.includes(opts.requesterRole)) {
    return { success: false, provider: 'denied', error: 'Insufficient role to send financial reports' };
  }

  return sendEmailWithFallback({
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    attachments: opts.attachments,
    groupId: opts.groupId,
    userId: opts.userId,
    category: 'financial_report',
  });
}

// Bulk announcement to all members (queued, not direct)
export async function queueAnnouncement(opts: {
  groupId: string;
  subject: string;
  body: string;
  senderName: string;
  memberEmails: string[];
  memberNames: Record<string, string>;
  userId: string;
}): Promise<void> {
  for (const email of opts.memberEmails) {
    await queueEmail({
      templateKey: 'announcement',
      to: email,
      vars: {
        subject: opts.subject,
        body: opts.body,
        senderName: opts.senderName,
        memberName: opts.memberNames[email] ?? email,
        groupName: opts.groupId,
      },
      groupId: opts.groupId,
      userId: opts.userId,
      priority: 'low',
    });
  }
}

// Categorize template for email_logs.category
function categorize(key: string): string {
  if (key.startsWith('invoice') || key.startsWith('payment') || key.startsWith('receipt')) return 'billing';
  if (key.startsWith('loan')) return 'loan';
  if (key.startsWith('contribution')) return 'contribution';
  if (key.startsWith('newsletter')) return 'newsletter';
  if (key.startsWith('contact')) return 'contact';
  if (key === 'welcome' || key === 'otp' || key === 'password_reset') return 'auth';
  return 'transactional';
}
