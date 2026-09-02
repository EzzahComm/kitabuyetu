// Default inline HTML templates (used when no DB template exists)
// All use {{variable}} interpolation via engine.ts

export const DEFAULT_TEMPLATES: Record<string, { subject: string; body: string }> = {
  // ─── Auth ────────────────────────────────────────────────────────────────────
  welcome: {
    subject: 'Welcome to Kitabu Yetu, {{name}}!',
    body: `
      <h2 style="margin:0 0 16px;color:#0B3C88;">Welcome, {{name}}!</h2>
      <p style="margin:0 0 12px;color:#374151;">Your account has been created for <strong>{{groupName}}</strong>.</p>
      <p style="margin:0 0 20px;color:#374151;">You can now log in and start managing your group's finances.</p>
      <a href="{{loginUrl}}" style="display:inline-block;background:#3CB043;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Log In Now</a>
      <p style="margin:20px 0 0;font-size:13px;color:#6b7280;">Your temporary password is: <strong>{{tempPassword}}</strong><br>Please change it after first login.</p>
    `,
  },

  otp: {
    subject: 'Your Kitabu Yetu verification code: {{otp}}',
    body: `
      <h2 style="margin:0 0 16px;color:#0B3C88;">Verification Code</h2>
      <p style="margin:0 0 20px;color:#374151;">Use the code below to verify your identity. It expires in <strong>{{expiresIn}}</strong>.</p>
      <div style="background:#f3f4f6;border-radius:8px;padding:24px;text-align:center;margin:0 0 20px;">
        <span style="font-size:36px;font-weight:700;letter-spacing:8px;color:#0B3C88;">{{otp}}</span>
      </div>
      <p style="margin:0;font-size:13px;color:#6b7280;">If you did not request this code, please ignore this email.</p>
    `,
  },

  group_verification_link: {
    subject: 'Verify your Kitabu Yetu group',
    body: `
      <h2 style="margin:0 0 16px;color:#0B3C88;">Verify your group</h2>
      <p style="margin:0 0 12px;color:#374151;">Hi <strong>{{name}}</strong>,</p>
      <p style="margin:0 0 20px;color:#374151;">Click the button below to verify <strong>{{groupName}}</strong> ({{groupCode}}) and activate your Kitabu Yetu account.</p>
      <a href="{{verifyUrl}}" style="display:inline-block;background:#3CB043;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Verify group</a>
      <p style="margin:20px 0 0;font-size:13px;color:#6b7280;">This link expires in 24 hours. If you did not register a group on Kitabu Yetu, please ignore this email.</p>
    `,
  },

  org_staff_invite: {
    subject: 'You\'ve been invited to join {{organizationName}} on Kitabu Yetu',
    body: `
      <h2 style="margin:0 0 16px;color:#0B3C88;">You're invited</h2>
      <p style="margin:0 0 12px;color:#374151;">Hi <strong>{{firstName}}</strong>,</p>
      <p style="margin:0 0 20px;color:#374151;">You've been invited to join <strong>{{organizationName}}</strong> as staff on Kitabu Yetu. Click below to confirm your email and continue setup — you'll also need to verify your phone number by SMS code.</p>
      <a href="{{inviteUrl}}" style="display:inline-block;background:#3CB043;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Accept invitation</a>
      <p style="margin:20px 0 0;font-size:13px;color:#6b7280;">This link expires in 14 days. If you were not expecting this invitation, please ignore this email.</p>
    `,
  },

  password_reset: {
    subject: 'Reset your Kitabu Yetu password',
    body: `
      <h2 style="margin:0 0 16px;color:#0B3C88;">Password Reset Request</h2>
      <p style="margin:0 0 20px;color:#374151;">Click the button below to reset your password. This link expires in <strong>{{expiresIn}}</strong>.</p>
      <a href="{{resetUrl}}" style="display:inline-block;background:#3CB043;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Reset Password</a>
      <p style="margin:20px 0 0;font-size:13px;color:#6b7280;">If you did not request a password reset, please ignore this email.</p>
    `,
  },

  account_update: {
    subject: 'Your Kitabu Yetu account has been updated',
    body: `
      <h2 style="margin:0 0 16px;color:#0B3C88;">Account Updated</h2>
      <p style="margin:0 0 12px;color:#374151;">Dear <strong>{{name}}</strong>,</p>
      <p style="margin:0 0 20px;color:#374151;">Your account details have been updated: <strong>{{changeDescription}}</strong>.</p>
      <p style="margin:0 0 20px;color:#374151;">If you did not make this change, please contact your group administrator immediately.</p>
      <p style="margin:0;font-size:13px;color:#6b7280;">Change time: {{changedAt}}</p>
    `,
  },

  // ─── Contributions ───────────────────────────────────────────────────────────
  contribution_received: {
    subject: 'Contribution received — KES {{amount}}',
    body: `
      <h2 style="margin:0 0 16px;color:#0B3C88;">Contribution Confirmed</h2>
      <p style="margin:0 0 12px;color:#374151;">Dear <strong>{{memberName}}</strong>,</p>
      <p style="margin:0 0 20px;color:#374151;">We have received your contribution of <strong>KES {{amount}}</strong> for <strong>{{periodLabel}}</strong>.</p>
      <table width="100%" style="border-collapse:collapse;margin:0 0 20px;">
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;color:#374151;">Reference</td><td style="padding:8px;border:1px solid #e5e7eb;color:#0B3C88;">{{reference}}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;color:#374151;">Date</td><td style="padding:8px;border:1px solid #e5e7eb;color:#0B3C88;">{{date}}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;color:#374151;">Payment Method</td><td style="padding:8px;border:1px solid #e5e7eb;color:#0B3C88;">{{paymentMethod}}</td></tr>
      </table>
      <p style="margin:0;font-size:13px;color:#6b7280;">Your total contributions to date: <strong>KES {{totalContributions}}</strong></p>
    `,
  },

  contribution_reminder: {
    subject: 'Reminder: {{periodLabel}} contribution due {{dueDate}}',
    body: `
      <h2 style="margin:0 0 16px;color:#0B3C88;">Contribution Reminder</h2>
      <p style="margin:0 0 12px;color:#374151;">Dear <strong>{{memberName}}</strong>,</p>
      <p style="margin:0 0 20px;color:#374151;">This is a friendly reminder that your <strong>{{periodLabel}}</strong> contribution of <strong>KES {{amount}}</strong> is due on <strong>{{dueDate}}</strong>.</p>
      <p style="margin:0 0 20px;color:#374151;">Please use M-Pesa Paybill <strong>{{shortcode}}</strong>, Account Number: <strong>{{accountNumber}}</strong>.</p>
      <p style="margin:0;font-size:13px;color:#6b7280;">For any queries, contact your group secretary.</p>
    `,
  },

  // ─── Loans ───────────────────────────────────────────────────────────────────
  loan_approved: {
    subject: 'Your loan application has been approved',
    body: `
      <h2 style="margin:0 0 16px;color:#0B3C88;">Loan Approved</h2>
      <p style="margin:0 0 12px;color:#374151;">Dear <strong>{{memberName}}</strong>,</p>
      <p style="margin:0 0 20px;color:#374151;">Your loan application has been <strong style="color:#3CB043;">approved</strong>.</p>
      <table width="100%" style="border-collapse:collapse;margin:0 0 20px;">
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;color:#374151;">Principal</td><td style="padding:8px;border:1px solid #e5e7eb;color:#0B3C88;">KES {{principal}}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;color:#374151;">Interest Rate</td><td style="padding:8px;border:1px solid #e5e7eb;color:#0B3C88;">{{interestRate}}% per month</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;color:#374151;">Term</td><td style="padding:8px;border:1px solid #e5e7eb;color:#0B3C88;">{{termMonths}} months</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;color:#374151;">Monthly Repayment</td><td style="padding:8px;border:1px solid #e5e7eb;color:#0B3C88;">KES {{monthlyRepayment}}</td></tr>
      </table>
      <p style="margin:0;font-size:13px;color:#6b7280;">Disbursement will be processed shortly. You will receive an M-Pesa notification.</p>
    `,
  },

  loan_rejected: {
    subject: 'Your loan application was not approved',
    body: `
      <h2 style="margin:0 0 16px;color:#0B3C88;">Loan Application Update</h2>
      <p style="margin:0 0 12px;color:#374151;">Dear <strong>{{memberName}}</strong>,</p>
      <p style="margin:0 0 20px;color:#374151;">We regret to inform you that your loan application for <strong>KES {{principal}}</strong> has not been approved at this time.</p>
      <p style="margin:0 0 20px;color:#374151;"><strong>Reason:</strong> {{reason}}</p>
      <p style="margin:0 0 20px;color:#374151;">You may re-apply after <strong>{{reapplyDate}}</strong> or contact your group administrator for further guidance.</p>
      <p style="margin:0;font-size:13px;color:#6b7280;">We appreciate your continued membership and commitment to the group.</p>
    `,
  },

  loan_disbursed: {
    subject: 'Loan of KES {{amount}} disbursed to your M-Pesa',
    body: `
      <h2 style="margin:0 0 16px;color:#0B3C88;">Loan Disbursed</h2>
      <p style="margin:0 0 12px;color:#374151;">Dear <strong>{{memberName}}</strong>,</p>
      <p style="margin:0 0 20px;color:#374151;">KES <strong>{{amount}}</strong> has been sent to your M-Pesa number <strong>{{phone}}</strong>.</p>
      <p style="margin:0 0 20px;color:#374151;">M-Pesa Transaction ID: <strong>{{mpesaRef}}</strong></p>
      <p style="margin:0 0 20px;color:#374151;">Your first repayment of <strong>KES {{monthlyRepayment}}</strong> is due on <strong>{{firstDueDate}}</strong>.</p>
      <p style="margin:0;font-size:13px;color:#6b7280;">Please ensure timely repayments to maintain your good standing.</p>
    `,
  },

  loan_overdue: {
    subject: 'URGENT: Loan repayment {{daysOverdue}} days overdue',
    body: `
      <h2 style="margin:0 0 16px;color:#dc2626;">Overdue Loan Repayment</h2>
      <p style="margin:0 0 12px;color:#374151;">Dear <strong>{{memberName}}</strong>,</p>
      <p style="margin:0 0 20px;color:#374151;">Your loan repayment of <strong>KES {{amountDue}}</strong> is <strong style="color:#dc2626;">{{daysOverdue}} days overdue</strong>.</p>
      <table width="100%" style="border-collapse:collapse;margin:0 0 20px;">
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;color:#374151;">Outstanding Balance</td><td style="padding:8px;border:1px solid #e5e7eb;color:#dc2626;font-weight:600;">KES {{balance}}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;color:#374151;">Penalty Accrued</td><td style="padding:8px;border:1px solid #e5e7eb;color:#dc2626;">KES {{penalty}}</td></tr>
      </table>
      <p style="margin:0 0 20px;color:#374151;">Please make payment immediately via M-Pesa Paybill <strong>{{shortcode}}</strong>, Account: <strong>{{accountNumber}}</strong>.</p>
      <p style="margin:0;font-size:13px;color:#6b7280;">Failure to pay may affect your loan eligibility. Contact your secretary for payment arrangements.</p>
    `,
  },

  loan_repayment_received: {
    subject: 'Loan repayment of KES {{amount}} received',
    body: `
      <h2 style="margin:0 0 16px;color:#3CB043;">Repayment Received</h2>
      <p style="margin:0 0 12px;color:#374151;">Dear <strong>{{memberName}}</strong>,</p>
      <p style="margin:0 0 20px;color:#374151;">We have received your loan repayment of <strong>KES {{amount}}</strong>.</p>
      <table width="100%" style="border-collapse:collapse;margin:0 0 20px;">
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;color:#374151;">Payment Date</td><td style="padding:8px;border:1px solid #e5e7eb;">{{paymentDate}}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;color:#374151;">Remaining Balance</td><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600;">KES {{remainingBalance}}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;color:#374151;">Next Due Date</td><td style="padding:8px;border:1px solid #e5e7eb;">{{nextDueDate}}</td></tr>
      </table>
      <p style="margin:0;font-size:13px;color:#6b7280;">Thank you for your prompt payment.</p>
    `,
  },

  // ─── Billing / Invoices ───────────────────────────────────────────────────────
  invoice: {
    subject: 'Invoice {{invoiceNumber}} — KES {{amountDue}} due {{dueDate}}',
    body: `
      <h2 style="margin:0 0 16px;color:#0B3C88;">Invoice {{invoiceNumber}}</h2>
      <p style="margin:0 0 20px;color:#374151;">Dear <strong>{{recipientName}}</strong>,</p>
      <table width="100%" style="border-collapse:collapse;margin:0 0 20px;">
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;color:#374151;">Invoice Date</td><td style="padding:8px;border:1px solid #e5e7eb;">{{invoiceDate}}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;color:#374151;">Due Date</td><td style="padding:8px;border:1px solid #e5e7eb;color:#dc2626;font-weight:600;">{{dueDate}}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;color:#374151;">Amount Due</td><td style="padding:8px;border:1px solid #e5e7eb;font-weight:700;font-size:18px;color:#0B3C88;">KES {{amountDue}}</td></tr>
      </table>
      <p style="margin:0 0 16px;color:#374151;font-style:italic;">{{notes}}</p>
      <p style="margin:0 0 8px;color:#374151;font-weight:600;">Payment Instructions:</p>
      <p style="margin:0 0 20px;color:#374151;">M-Pesa Paybill <strong>{{shortcode}}</strong>, Account: <strong>{{invoiceNumber}}</strong></p>
      <p style="margin:0;font-size:13px;color:#6b7280;">A PDF copy of this invoice is attached.</p>
    `,
  },

  invoice_overdue_1: {
    subject: 'Invoice {{invoiceNumber}} overdue — please pay KES {{amountDue}}',
    body: `
      <h2 style="margin:0 0 16px;color:#d97706;">First Overdue Notice — Invoice {{invoiceNumber}}</h2>
      <p style="margin:0 0 12px;color:#374151;">Dear <strong>{{recipientName}}</strong>,</p>
      <p style="margin:0 0 20px;color:#374151;">Invoice {{invoiceNumber}} for <strong>KES {{amountDue}}</strong> was due on <strong>{{dueDate}}</strong> and remains unpaid.</p>
      <p style="margin:0 0 20px;color:#374151;">Please make payment at your earliest convenience via M-Pesa Paybill <strong>{{shortcode}}</strong>, Account: <strong>{{invoiceNumber}}</strong>.</p>
      <p style="margin:0;font-size:13px;color:#6b7280;">If you have already made payment, please ignore this notice.</p>
    `,
  },

  invoice_overdue_2: {
    subject: 'SECOND NOTICE: Invoice {{invoiceNumber}} — {{daysOverdue}} days past due',
    body: `
      <h2 style="margin:0 0 16px;color:#dc2626;">Second Overdue Notice — Invoice {{invoiceNumber}}</h2>
      <p style="margin:0 0 12px;color:#374151;">Dear <strong>{{recipientName}}</strong>,</p>
      <p style="margin:0 0 20px;color:#374151;">Invoice {{invoiceNumber}} for <strong>KES {{amountDue}}</strong> is now <strong style="color:#dc2626;">{{daysOverdue}} days overdue</strong>.</p>
      <p style="margin:0 0 20px;color:#374151;">Immediate payment is required. Late fees may apply. Please pay via M-Pesa Paybill <strong>{{shortcode}}</strong>, Account: <strong>{{invoiceNumber}}</strong>.</p>
      <p style="margin:0;font-size:13px;color:#6b7280;">Contact <strong>{{adminEmail}}</strong> if you need to discuss a payment arrangement.</p>
    `,
  },

  invoice_overdue_3: {
    subject: 'FINAL NOTICE: Invoice {{invoiceNumber}} — immediate action required',
    body: `
      <h2 style="margin:0 0 16px;color:#dc2626;">FINAL NOTICE — Invoice {{invoiceNumber}}</h2>
      <p style="margin:0 0 12px;color:#374151;">Dear <strong>{{recipientName}}</strong>,</p>
      <p style="margin:0 0 20px;color:#374151;">This is your <strong>final notice</strong>. Invoice {{invoiceNumber}} for <strong>KES {{amountDue}}</strong> is <strong style="color:#dc2626;">{{daysOverdue}} days past due</strong>.</p>
      <p style="margin:0 0 20px;color:#374151;">Failure to pay within 7 days may result in service suspension. Pay immediately via M-Pesa Paybill <strong>{{shortcode}}</strong>, Account: <strong>{{invoiceNumber}}</strong>.</p>
      <p style="margin:0;font-size:13px;color:#6b7280;">To resolve this urgently, contact <strong>{{adminEmail}}</strong> or call <strong>{{adminPhone}}</strong>.</p>
    `,
  },

  payment_receipt: {
    subject: 'Payment received — KES {{amountPaid}} (Receipt {{receiptNumber}})',
    body: `
      <h2 style="margin:0 0 16px;color:#3CB043;">Payment Received</h2>
      <p style="margin:0 0 12px;color:#374151;">Dear <strong>{{recipientName}}</strong>,</p>
      <p style="margin:0 0 20px;color:#374151;">Thank you! We have received your payment of <strong>KES {{amountPaid}}</strong>.</p>
      <table width="100%" style="border-collapse:collapse;margin:0 0 20px;">
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;color:#374151;">Receipt Number</td><td style="padding:8px;border:1px solid #e5e7eb;color:#0B3C88;font-weight:700;">{{receiptNumber}}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;color:#374151;">Invoice</td><td style="padding:8px;border:1px solid #e5e7eb;">{{invoiceNumber}}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;color:#374151;">Payment Date</td><td style="padding:8px;border:1px solid #e5e7eb;">{{paymentDate}}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;color:#374151;">Method</td><td style="padding:8px;border:1px solid #e5e7eb;">{{paymentMethod}}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;color:#374151;">Amount Paid</td><td style="padding:8px;border:1px solid #e5e7eb;color:#3CB043;font-weight:700;">KES {{amountPaid}}</td></tr>
      </table>
      <p style="margin:0;font-size:13px;color:#6b7280;">A PDF receipt is attached for your records.</p>
    `,
  },

  // ─── Meetings ─────────────────────────────────────────────────────────────────
  meeting_invite: {
    subject: '{{groupName}}: Meeting on {{meetingDate}}',
    body: `
      <h2 style="margin:0 0 16px;color:#0B3C88;">Meeting Invitation</h2>
      <p style="margin:0 0 12px;color:#374151;">Dear <strong>{{memberName}}</strong>,</p>
      <p style="margin:0 0 20px;color:#374151;">You are invited to the <strong>{{meetingType}}</strong> meeting for <strong>{{groupName}}</strong>.</p>
      <table width="100%" style="border-collapse:collapse;margin:0 0 20px;">
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;color:#374151;">Date</td><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600;">{{meetingDate}}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;color:#374151;">Time</td><td style="padding:8px;border:1px solid #e5e7eb;">{{meetingTime}}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;color:#374151;">Venue</td><td style="padding:8px;border:1px solid #e5e7eb;">{{venue}}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;color:#374151;">Agenda</td><td style="padding:8px;border:1px solid #e5e7eb;">{{agenda}}</td></tr>
      </table>
      <p style="margin:0;font-size:13px;color:#6b7280;">Please confirm your attendance by replying to this email. — <strong>{{organizerName}}</strong></p>
    `,
  },

  meeting_reminder: {
    subject: 'Reminder: {{groupName}} meeting tomorrow at {{meetingTime}}',
    body: `
      <h2 style="margin:0 0 16px;color:#0B3C88;">Meeting Reminder</h2>
      <p style="margin:0 0 12px;color:#374151;">Dear <strong>{{memberName}}</strong>,</p>
      <p style="margin:0 0 20px;color:#374151;">This is a reminder for tomorrow's <strong>{{meetingType}}</strong> meeting.</p>
      <table width="100%" style="border-collapse:collapse;margin:0 0 20px;">
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;color:#374151;">Date &amp; Time</td><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600;">{{meetingDate}} at {{meetingTime}}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;color:#374151;">Venue</td><td style="padding:8px;border:1px solid #e5e7eb;">{{venue}}</td></tr>
      </table>
      <p style="margin:0;font-size:13px;color:#6b7280;">We look forward to seeing you there.</p>
    `,
  },

  // ─── Reports ─────────────────────────────────────────────────────────────────
  monthly_statement: {
    subject: '{{groupName}}: Your {{month}} Statement',
    body: `
      <h2 style="margin:0 0 16px;color:#0B3C88;">Monthly Statement — {{month}}</h2>
      <p style="margin:0 0 12px;color:#374151;">Dear <strong>{{memberName}}</strong>,</p>
      <p style="margin:0 0 20px;color:#374151;">Please find your statement for <strong>{{month}}</strong> attached.</p>
      <table width="100%" style="border-collapse:collapse;margin:0 0 20px;">
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;color:#374151;">Total Contributions</td><td style="padding:8px;border:1px solid #e5e7eb;color:#3CB043;font-weight:600;">KES {{totalContributions}}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;color:#374151;">Loan Balance</td><td style="padding:8px;border:1px solid #e5e7eb;">KES {{loanBalance}}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;color:#374151;">Group Fund Share</td><td style="padding:8px;border:1px solid #e5e7eb;font-weight:600;">KES {{fundShare}}</td></tr>
      </table>
      <p style="margin:0;font-size:13px;color:#6b7280;">The full statement is attached as a PDF.</p>
    `,
  },

  financial_report: {
    subject: '{{groupName}}: {{reportType}} — {{period}}',
    body: `
      <h2 style="margin:0 0 16px;color:#0B3C88;">{{reportType}}</h2>
      <p style="margin:0 0 12px;color:#374151;">Dear <strong>{{recipientName}}</strong>,</p>
      <p style="margin:0 0 20px;color:#374151;">The <strong>{{reportType}}</strong> for <strong>{{period}}</strong> is attached.</p>
      <p style="margin:0 0 20px;color:#374151;background:#f0fdf4;padding:12px;border-radius:4px;border-left:4px solid #3CB043;">
        <strong>Confidential:</strong> This report contains sensitive financial data. Please keep it secure and do not forward to unauthorized recipients.
      </p>
      <p style="margin:0;font-size:13px;color:#6b7280;">Generated: {{generatedAt}} — {{groupName}}</p>
    `,
  },

  weekly_summary: {
    subject: '{{groupName}}: Weekly Summary — {{weekLabel}}',
    body: `
      <h2 style="margin:0 0 16px;color:#0B3C88;">Weekly Summary</h2>
      <p style="margin:0 0 12px;color:#374151;">Dear <strong>{{recipientName}}</strong>,</p>
      <p style="margin:0 0 20px;color:#374151;">Here's a quick snapshot of <strong>{{groupName}}</strong> activity for the week of <strong>{{weekLabel}}</strong>.</p>
      <table width="100%" style="border-collapse:collapse;margin:0 0 20px;">
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;color:#374151;">Contributions Collected</td><td style="padding:8px;border:1px solid #e5e7eb;color:#3CB043;font-weight:600;">KES {{weekContributions}}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;color:#374151;">Loans Disbursed</td><td style="padding:8px;border:1px solid #e5e7eb;">KES {{weekLoans}}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;color:#374151;">Repayments Received</td><td style="padding:8px;border:1px solid #e5e7eb;">KES {{weekRepayments}}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;color:#374151;">New Members</td><td style="padding:8px;border:1px solid #e5e7eb;">{{newMembers}}</td></tr>
      </table>
    `,
  },

  // ─── Birthday ────────────────────────────────────────────────────────────────
  birthday: {
    subject: 'Happy Birthday {{memberName}}! 🎉 From {{groupName}}',
    body: `
      <div style="text-align:center;margin:0 0 24px;">
        <div style="font-size:48px;">🎂</div>
        <h2 style="margin:8px 0 0;color:#0B3C88;">Happy Birthday, {{memberName}}!</h2>
      </div>
      <p style="margin:0 0 20px;color:#374151;text-align:center;">Your <strong>{{groupName}}</strong> family wishes you a wonderful birthday and a prosperous year ahead.</p>
      <p style="margin:0 0 20px;color:#374151;text-align:center;">May this new year bring you joy, health, and financial prosperity.</p>
      <p style="margin:0;font-size:13px;color:#6b7280;text-align:center;">With warm wishes from all of us at <strong>{{groupName}}</strong> 🎉</p>
    `,
  },

  // ─── Platform events ─────────────────────────────────────────────────────────
  announcement: {
    subject: '{{groupName}}: {{subject}}',
    body: `
      <h2 style="margin:0 0 16px;color:#0B3C88;">{{subject}}</h2>
      <p style="margin:0 0 12px;color:#374151;">Dear <strong>{{memberName}}</strong>,</p>
      <div style="margin:0 0 20px;color:#374151;line-height:1.6;">{{body}}</div>
      <p style="margin:0;font-size:13px;color:#6b7280;">— <strong>{{senderName}}</strong>, {{groupName}}</p>
    `,
  },

  // ─── Newsletter ───────────────────────────────────────────────────────────────
  newsletter_confirm: {
    subject: 'Confirm your subscription to Kitabu Yetu updates',
    body: `
      <h2 style="margin:0 0 16px;color:#0B3C88;">Confirm Your Subscription</h2>
      <p style="margin:0 0 20px;color:#374151;">You recently subscribed to receive updates from Kitabu Yetu. Please confirm your email address by clicking the button below.</p>
      <a href="{{confirmUrl}}" style="display:inline-block;background:#3CB043;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600;">Confirm Subscription</a>
      <p style="margin:20px 0 0;font-size:13px;color:#6b7280;">If you did not subscribe, please ignore this email. This link expires in 24 hours.</p>
    `,
  },

  newsletter_welcome: {
    subject: 'You\'re subscribed to Kitabu Yetu updates',
    body: `
      <h2 style="margin:0 0 16px;color:#0B3C88;">Welcome to Kitabu Yetu Updates!</h2>
      <p style="margin:0 0 20px;color:#374151;">Thank you for confirming your subscription. You will receive updates about new features, community finance tips, and product announcements.</p>
      <p style="margin:0;font-size:13px;color:#6b7280;">You can unsubscribe at any time by clicking the unsubscribe link in any future email.</p>
    `,
  },

  // ─── Contact ─────────────────────────────────────────────────────────────────
  contact_confirmation: {
    subject: 'We received your message — Kitabu Yetu',
    body: `
      <h2 style="margin:0 0 16px;color:#0B3C88;">Message Received</h2>
      <p style="margin:0 0 12px;color:#374151;">Dear <strong>{{name}}</strong>,</p>
      <p style="margin:0 0 20px;color:#374151;">Thank you for contacting us. We have received your message and will respond within <strong>2 business days</strong>.</p>
      <div style="background:#f3f4f6;border-radius:6px;padding:16px;margin:0 0 20px;">
        <p style="margin:0;font-size:13px;color:#374151;font-weight:600;">Your message:</p>
        <p style="margin:8px 0 0;font-size:13px;color:#374151;">{{message}}</p>
      </div>
      <p style="margin:0;font-size:13px;color:#6b7280;">Reference: <strong>{{reference}}</strong></p>
    `,
  },

  contact_admin: {
    subject: 'New contact form submission from {{name}}',
    body: `
      <h2 style="margin:0 0 16px;color:#0B3C88;">New Contact Submission</h2>
      <table width="100%" style="border-collapse:collapse;margin:0 0 20px;">
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;color:#374151;">Name</td><td style="padding:8px;border:1px solid #e5e7eb;">{{name}}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;color:#374151;">Email</td><td style="padding:8px;border:1px solid #e5e7eb;">{{email}}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;color:#374151;">Subject</td><td style="padding:8px;border:1px solid #e5e7eb;">{{contactSubject}}</td></tr>
        <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;color:#374151;">IP</td><td style="padding:8px;border:1px solid #e5e7eb;font-size:12px;color:#6b7280;">{{ip}}</td></tr>
      </table>
      <div style="background:#f3f4f6;border-radius:6px;padding:16px;">
        <p style="margin:0;font-weight:600;font-size:13px;color:#374151;">Message:</p>
        <p style="margin:8px 0 0;font-size:14px;color:#0B3C88;line-height:1.6;">{{message}}</p>
      </div>
    `,
  },

  // ─── Operational alerts (staff) ──────────────────────────────────────────────

  // SMS-AUDIT-v3 T3-4. Goes to EMAIL_ADMIN, never to a tenant, and NEVER over
  // SMS — an alert about a broken SMS channel must not depend on that channel.
  sms_provider_degraded: {
    subject: '[ALERT] SMS provider degraded — {{failureRate}} of sends failing',
    body: `
      <h2 style="margin:0 0 16px;color:#b91c1c;">SMS provider degraded</h2>
      <p style="margin:0 0 16px;color:#374151;">
        <strong>{{failed}}</strong> of <strong>{{total}}</strong> messages sent through
        <strong>{{provider}}</strong> in the last {{window}} failed ({{failureRate}}).
      </p>
      <p style="margin:0 0 16px;color:#374151;">
        Automated reminders, loan alerts and verification codes are affected. Check the
        provider account balance and credentials first — both have caused this before.
      </p>
      <p style="margin:0;font-size:13px;color:#6b7280;">
        You will not receive another alert for this provider for 6 hours, or until it
        recovers and degrades again.
      </p>
    `,
  },

  // SMS-REAUDIT-2026-09-02 F2. The generic staff notice used by
  // lib/services/staff-alerts.ts, so a background control that detects a
  // problem can actually reach a person. Deliberately plain and detail-heavy:
  // the reader is an operator deciding whether to act tonight, not a customer.
  staff_operational_alert: {
    subject: '[ALERT] {{subject}}',
    body: `
      <h2 style="margin:0 0 16px;color:#b91c1c;">{{subject}}</h2>
      <p style="margin:0 0 16px;color:#374151;">{{body}}</p>
      <pre style="background:#f3f4f6;border-radius:6px;padding:16px;font-size:12px;color:#111827;overflow-x:auto;white-space:pre-wrap;">{{details}}</pre>
      <p style="margin:16px 0 0;font-size:13px;color:#6b7280;">
        This condition will not be emailed again until it changes, or after {{window}}.
      </p>
    `,
  },

  // Was missing entirely, so every low-balance alert since it shipped rendered
  // through sendTemplatedEmail's last-resort branch — a JSON dump of its vars.
  // A DB template still wins over this if one exists.
  sms_low_balance: {
    subject: 'SMS credits exhausted',
    body: `
      <h2 style="margin:0 0 16px;color:#0B3C88;">{{title}}</h2>
      <p style="margin:0 0 16px;color:#374151;">{{body}}</p>
    `,
  },
};
