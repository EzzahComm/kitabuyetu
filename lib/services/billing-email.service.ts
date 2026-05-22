import { sendTemplatedEmail, queueEmail } from './email.service';
import { withAdminDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { EmailResult } from '@/lib/email/provider';

const SHORTCODE   = process.env.MPESA_SHORTCODE ?? '';
const ADMIN_EMAIL = process.env.EMAIL_ADMIN    ?? 'admin@kitabuyetu.com';

// ---------------------------------------------------------------------------
// Internal row shapes returned by the queries below
// ---------------------------------------------------------------------------

interface InvoiceRow {
  id:                  string;
  group_id:            string;
  billing_account_id:  string;
  invoice_number:      string;
  invoice_date:        string;
  due_date:            string;
  status:              string;
  total_amount:        string;
  paid_amount:         string;
  notes:               string | null;
  // computed / joined columns
  recipient_email:     string | null;
  recipient_name:      string;
  group_name:          string;
}

interface ReceiptRow {
  id:                        string;
  receipt_number:            string;
  group_id:                  string;
  invoice_id:                string;
  amount_paid:               string;
  payment_date:              string;
  payment_method:            string;
  // joined
  invoice_number:            string;
  invoice_amount_due:        string;
  invoice_amount_paid_total: string;
  recipient_email:           string | null;
  recipient_name:            string;
}

// ---------------------------------------------------------------------------
// Re-usable CTE: resolves recipient email+name for an invoice.
//
// Priority: group_admin member with email → treasurer with email → group.email
// ---------------------------------------------------------------------------
const INVOICE_RECIPIENT_CTE = `
  WITH admin_contact AS (
    SELECT gm.group_id,
           m.first_name || ' ' || m.last_name AS full_name,
           m.email
    FROM group_members gm
    JOIN members m ON m.id = gm.member_id
    WHERE gm.is_active = true
      AND gm.role IN ('group_admin','treasurer')
      AND m.email IS NOT NULL
    ORDER BY
      CASE gm.role WHEN 'group_admin' THEN 0 ELSE 1 END,
      gm.joined_at ASC
  )
`;

// ─── Invoice Dispatch ─────────────────────────────────────────────────────────

export async function sendInvoiceEmail(
  invoiceId: string,
  pdfBuffer?: Buffer,
): Promise<EmailResult> {
  const { rows } = await withAdminDb((db) =>
    db.query(
      `${INVOICE_RECIPIENT_CTE}
       SELECT i.*,
              g.name AS group_name,
              COALESCE(ac.full_name, g.name)  AS recipient_name,
              COALESCE(ac.email,    g.email)  AS recipient_email
       FROM invoices i
       JOIN groups g ON g.id = i.group_id
       LEFT JOIN LATERAL (
         SELECT full_name, email FROM admin_contact
         WHERE group_id = i.group_id LIMIT 1
       ) ac ON true
       WHERE i.id = $1`,
      [invoiceId],
    ),
  );
  if (!rows.length) return { success: false, provider: 'none', error: 'Invoice not found' };

  const inv = rows[0] as InvoiceRow;
  if (!inv.recipient_email) {
    return { success: false, provider: 'none', error: 'No recipient email found for this group' };
  }

  const amountDue = parseFloat(inv.total_amount) - parseFloat(inv.paid_amount);

  const attachments = pdfBuffer
    ? [{ filename: `Invoice-${inv.invoice_number}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }]
    : undefined;

  const result = await sendTemplatedEmail({
    templateKey: 'invoice',
    to: inv.recipient_email,
    vars: {
      invoiceNumber: inv.invoice_number,
      recipientName: inv.recipient_name,
      groupName:     inv.group_name,
      invoiceDate:   formatDate(inv.invoice_date),
      dueDate:       formatDate(inv.due_date),
      amountDue:     formatMoney(amountDue),
      shortcode:     SHORTCODE,
      notes:         inv.notes ?? '',
    },
    groupId:       inv.group_id,
    attachments,
    referenceId:   invoiceId,
    referenceType: 'invoice',
  });

  if (result.success) {
    await withAdminDb((db) =>
      db.query(`UPDATE invoices SET emailed_at = NOW() WHERE id = $1`, [invoiceId]),
    ).catch(() => {});
  }

  return result;
}

// ─── Overdue Reminders (3 escalation levels + admin CC at level 2+) ──────────

export async function sendOverdueInvoiceReminders(): Promise<void> {
  const { rows } = await withAdminDb((db) =>
    db.query(
      `${INVOICE_RECIPIENT_CTE}
       SELECT i.*,
              g.name AS group_name,
              COALESCE(ac.full_name, g.name)  AS recipient_name,
              COALESCE(ac.email,    g.email)  AS recipient_email,
              EXTRACT(DAY FROM NOW() - i.due_date)::int AS days_overdue
       FROM invoices i
       JOIN groups g ON g.id = i.group_id
       LEFT JOIN LATERAL (
         SELECT full_name, email FROM admin_contact
         WHERE group_id = i.group_id LIMIT 1
       ) ac ON true
       WHERE i.status = 'pending'
         AND i.paid_amount < i.total_amount
         AND i.due_date < CURRENT_DATE
         AND (i.overdue_notice_level < 3 OR i.overdue_notice_level IS NULL)
       ORDER BY i.due_date ASC`,
      [],
    ),
  );

  for (const inv of rows) {
    const days:  number = inv.days_overdue ?? 0;
    const level: number = inv.overdue_notice_level ?? 0;

    // Level 1: 3–7 days overdue | Level 2: 8–14 days | Level 3: 15+ days
    const targetLevel = days >= 15 ? 3 : days >= 8 ? 2 : days >= 3 ? 1 : 0;
    if (targetLevel === 0 || targetLevel <= level) continue;
    if (!inv.recipient_email) continue;

    const amountDue = parseFloat(inv.total_amount) - parseFloat(inv.paid_amount);
    const templateKey = `invoice_overdue_${targetLevel}` as
      'invoice_overdue_1' | 'invoice_overdue_2' | 'invoice_overdue_3';

    const vars = {
      invoiceNumber: inv.invoice_number,
      recipientName: inv.recipient_name,
      groupName:     inv.group_name,
      dueDate:       formatDate(inv.due_date),
      amountDue:     formatMoney(amountDue),
      daysOverdue:   String(days),
      shortcode:     SHORTCODE,
      adminEmail:    ADMIN_EMAIL,
    };

    await sendTemplatedEmail({
      templateKey,
      to:            inv.recipient_email,
      vars,
      groupId:       inv.group_id,
      referenceId:   inv.id,
      referenceType: 'invoice',
    }).catch(() => {});

    // CC admin at level 2 and beyond
    if (targetLevel >= 2) {
      await sendTemplatedEmail({
        templateKey,
        to:   ADMIN_EMAIL,
        vars: { ...vars, recipientName: `[ADMIN CC] ${inv.recipient_name} <${inv.recipient_email}>` },
        groupId:       inv.group_id,
        referenceId:   inv.id,
        referenceType: 'invoice',
      }).catch(() => {});
    }

    await withAdminDb((db) =>
      db.query(
        `UPDATE invoices
         SET overdue_notice_level = $1, last_reminder_sent_at = NOW()
         WHERE id = $2`,
        [targetLevel, inv.id],
      ),
    ).catch(() => {});
  }
}

// ─── Payment Receipt ───────────────────────────────────────────────────────────

export async function sendReceiptEmail(
  receiptId: string,
  pdfBuffer?: Buffer,
): Promise<EmailResult> {
  const { rows } = await withAdminDb((db) =>
    db.query(
      // payer_user_id references members.id directly (no group_members join needed)
      `SELECT pr.*,
              i.invoice_number,
              i.total_amount  AS invoice_amount_due,
              i.paid_amount   AS invoice_amount_paid_total,
              g.name          AS group_name,
              COALESCE(
                m.first_name || ' ' || m.last_name,
                g.name
              ) AS recipient_name,
              COALESCE(m.email, g.email) AS recipient_email
       FROM payment_receipts pr
       JOIN invoices i ON i.id = pr.invoice_id
       JOIN groups   g ON g.id = pr.group_id
       LEFT JOIN members m ON m.id = pr.payer_user_id
       WHERE pr.id = $1`,
      [receiptId],
    ),
  );
  if (!rows.length) return { success: false, provider: 'none', error: 'Receipt not found' };

  const r = rows[0] as ReceiptRow;
  if (!r.recipient_email) {
    return { success: false, provider: 'none', error: 'No recipient email found for this receipt' };
  }

  const invoiceDue   = parseFloat(r.invoice_amount_due);
  const invoicePaid  = parseFloat(r.invoice_amount_paid_total);
  const balance      = Math.max(0, invoiceDue - invoicePaid);

  const attachments = pdfBuffer
    ? [{ filename: `Receipt-${r.receipt_number}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }]
    : undefined;

  return sendTemplatedEmail({
    templateKey: 'payment_receipt',
    to:          r.recipient_email,
    vars: {
      receiptNumber:    r.receipt_number,
      recipientName:    r.recipient_name,
      invoiceNumber:    r.invoice_number,
      amountPaid:       formatMoney(parseFloat(r.amount_paid)),
      paymentDate:      formatDate(r.payment_date),
      paymentMethod:    r.payment_method ?? 'M-Pesa',
      balanceRemaining: balance > 0 ? formatMoney(balance) : '',
    },
    groupId:       r.group_id,
    attachments,
    referenceId:   receiptId,
    referenceType: 'receipt',
  });
}

// ─── Recurring Invoice Processing ─────────────────────────────────────────────

export async function processRecurringInvoices(): Promise<void> {
  const { rows: schedules } = await withAdminDb((db) =>
    db.query(
      `SELECT s.*,
              m.email AS recipient_email,
              m.first_name || ' ' || m.last_name AS recipient_name
       FROM invoice_schedules s
       LEFT JOIN members m ON m.id = s.recipient_user_id
       WHERE s.is_active = true AND s.next_run_at <= NOW()`,
      [],
    ),
  );

  for (const sched of schedules) {
    try {
      // Resolve billing_account_id for this group (required by invoices FK)
      const { rows: baRows } = await withAdminDb((db) =>
        db.query(
          `SELECT id FROM billing_accounts WHERE group_id = $1 LIMIT 1`,
          [sched.group_id],
        ),
      );
      if (!baRows[0]) {
        logger.error('[billing] No billing account for group', { groupId: sched.group_id });
        continue;
      }
      const billingAccountId = baRows[0].id;

      const { rows: [inv] } = await withAdminDb((db) =>
        db.query(
          `INSERT INTO invoices
             (group_id, billing_account_id, invoice_number,
              invoice_date, due_date,
              subtotal, tax_amount, total_amount, status, notes)
           VALUES (
             $1, $2,
             'INV-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || SUBSTR(gen_random_uuid()::text, 1, 6),
             CURRENT_DATE,
             (CURRENT_DATE + INTERVAL '30 days')::date,
             $3, 0, $3, 'pending', $4
           )
           RETURNING id`,
          [sched.group_id, billingAccountId, sched.amount, sched.description ?? null],
        ),
      );

      // Queue the invoice email if a recipient email is known
      if (sched.recipient_email) {
        await queueEmail({
          templateKey:   'invoice',
          to:             sched.recipient_email,
          vars: {
            invoiceNumber: inv.id,
            recipientName: sched.recipient_name ?? '',
            amountDue:     formatMoney(sched.amount),
            shortcode:     SHORTCODE,
            notes:         sched.description ?? '',
          },
          groupId:       sched.group_id,
          referenceId:   inv.id,
          referenceType: 'invoice',
        });
      }

      // Advance next_run_at by the configured frequency
      await withAdminDb((db) =>
        db.query(
          `UPDATE invoice_schedules
           SET next_run_at = next_run_at + (frequency_days || ' days')::interval,
               last_run_at = NOW()
           WHERE id = $1`,
          [sched.id],
        ),
      );
    } catch (err) {
      logger.error('[billing] Failed to process invoice schedule', { schedId: sched.id, error: err });
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(d: string | Date | null | undefined): string {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-KE', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

function formatMoney(n: number): string {
  return Number(n).toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
