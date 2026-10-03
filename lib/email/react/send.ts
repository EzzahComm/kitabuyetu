import * as React from 'react';
import { renderReactEmail } from './render';
import { sendEmailWithFallback, type EmailPayload, type EmailResult } from '@/lib/email/provider';

export interface SendReactEmailOptions {
  to: string | string[];
  subject: string;
  /** A React Email element, e.g. <ContributionReceipt {...props} />. */
  element: React.ReactElement;
  from?: string;
  replyTo?: string;
  attachments?: EmailPayload['attachments'];
  // Metadata written to email_logs (same as the rest of the pipeline)
  groupId?: string;
  userId?: string;
  templateKey?: string;
  category?: string;
  referenceId?: string;
  referenceType?: string;
}

/**
 * Render a React Email template and send it through the EXISTING delivery
 * pipeline — so multi-provider fallback, dry-run, and email_logs all apply
 * unchanged. This is the supported way to send a React Email template; it does
 * not bypass `sendEmailWithFallback`.
 *
 * @example
 *   import ContributionReceipt from '@/emails/contribution-receipt';
 *   await sendReactEmail({
 *     to: member.email,
 *     subject: `Receipt — ${formatKES(amount)} contribution`,
 *     element: <ContributionReceipt {...props} />,
 *     groupId, userId, templateKey: 'contribution_receipt',
 *     category: 'contribution', referenceId: contributionId, referenceType: 'contribution',
 *   });
 */
export async function sendReactEmail(opts: SendReactEmailOptions): Promise<EmailResult> {
  const { html, text } = await renderReactEmail(opts.element);
  return sendEmailWithFallback({
    to: opts.to,
    subject: opts.subject,
    html,
    text,
    from: opts.from,
    replyTo: opts.replyTo,
    attachments: opts.attachments,
    groupId: opts.groupId,
    userId: opts.userId,
    templateKey: opts.templateKey,
    category: opts.category,
    referenceId: opts.referenceId,
    referenceType: opts.referenceType,
  });
}
