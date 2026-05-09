// PDF generation service
// Puppeteer/Chromium not installed (disk space constraint).
// Returns HTML that can be printed to PDF by the browser, or null when a
// Buffer is required and Puppeteer is unavailable.
// To activate: npm install puppeteer-core @sparticuz/chromium

export interface InvoicePdfData {
  invoiceNumber: string;
  recipientName: string;
  recipientEmail: string;
  invoiceDate: string;
  dueDate: string;
  lineItems: { description: string; quantity: number; unitPrice: number; total: number }[];
  subtotal: number;
  taxAmount: number;
  amountDue: number;
  amountPaid: number;
  notes?: string;
  groupName: string;
  shortcode: string;
}

export interface ReceiptPdfData {
  receiptNumber: string;
  invoiceNumber: string;
  recipientName: string;
  amountPaid: number;
  paymentDate: string;
  paymentMethod: string;
  balance: number;
  groupName: string;
}

export function renderInvoiceHtml(data: InvoicePdfData): string {
  const rows = data.lineItems
    .map(
      (item) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;">${item.description}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">${item.quantity}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;">KES ${fmt(item.unitPrice)}</td>
        <td style="padding:8px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:600;">KES ${fmt(item.total)}</td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Invoice ${data.invoiceNumber}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 13px; color: #111827; margin: 0; padding: 32px; }
  .header { display: flex; justify-content: space-between; margin-bottom: 32px; }
  .brand { font-size: 24px; font-weight: 700; color: #16a34a; }
  .invoice-title { font-size: 18px; font-weight: 700; color: #374151; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th { background: #f3f4f6; padding: 8px; text-align: left; font-weight: 600; }
  .totals td { padding: 6px 8px; }
  .amount-due { font-size: 18px; font-weight: 700; color: #dc2626; }
  .paid-stamp { color: #16a34a; border: 3px solid #16a34a; display: inline-block; padding: 4px 16px; font-size: 20px; font-weight: 700; border-radius: 4px; transform: rotate(-15deg); }
</style>
</head>
<body>
  <div class="header">
    <div><div class="brand">${data.groupName}</div><div style="color:#6b7280;margin-top:4px;">Kitabu Yetu Platform</div></div>
    <div style="text-align:right;">
      <div class="invoice-title">INVOICE</div>
      <div style="color:#6b7280;">${data.invoiceNumber}</div>
      ${data.amountPaid >= data.amountDue ? '<div class="paid-stamp">PAID</div>' : ''}
    </div>
  </div>

  <div style="display:flex;justify-content:space-between;margin-bottom:24px;">
    <div>
      <div style="font-weight:600;margin-bottom:4px;">Billed To:</div>
      <div>${data.recipientName}</div>
      <div style="color:#6b7280;">${data.recipientEmail}</div>
    </div>
    <div style="text-align:right;">
      <table style="width:auto;">
        <tr><td style="padding:2px 8px;color:#6b7280;">Invoice Date:</td><td style="padding:2px 8px;font-weight:600;">${data.invoiceDate}</td></tr>
        <tr><td style="padding:2px 8px;color:#6b7280;">Due Date:</td><td style="padding:2px 8px;font-weight:600;color:#dc2626;">${data.dueDate}</td></tr>
      </table>
    </div>
  </div>

  <table>
    <thead><tr><th>Description</th><th style="text-align:right;">Qty</th><th style="text-align:right;">Unit Price</th><th style="text-align:right;">Total</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <table class="totals" style="width:300px;margin-left:auto;">
    <tr><td style="color:#6b7280;">Subtotal</td><td style="text-align:right;">KES ${fmt(data.subtotal)}</td></tr>
    ${data.taxAmount > 0 ? `<tr><td style="color:#6b7280;">Tax (16% VAT)</td><td style="text-align:right;">KES ${fmt(data.taxAmount)}</td></tr>` : ''}
    <tr style="border-top:2px solid #111827;"><td style="font-weight:700;font-size:15px;">Total Due</td><td style="text-align:right;" class="amount-due">KES ${fmt(data.amountDue)}</td></tr>
    ${data.amountPaid > 0 ? `<tr><td style="color:#16a34a;">Amount Paid</td><td style="text-align:right;color:#16a34a;">KES ${fmt(data.amountPaid)}</td></tr>` : ''}
    ${data.amountPaid > 0 && data.amountPaid < data.amountDue ? `<tr><td style="font-weight:700;color:#d97706;">Balance</td><td style="text-align:right;color:#d97706;font-weight:700;">KES ${fmt(data.amountDue - data.amountPaid)}</td></tr>` : ''}
  </table>

  ${data.notes ? `<div style="margin-top:24px;padding:12px;background:#f9fafb;border-radius:4px;color:#6b7280;font-size:12px;">${data.notes}</div>` : ''}

  <div style="margin-top:32px;padding:16px;background:#f0fdf4;border-radius:6px;">
    <div style="font-weight:600;margin-bottom:4px;">Payment Instructions</div>
    <div>M-Pesa Paybill: <strong>${data.shortcode}</strong></div>
    <div>Account Number: <strong>${data.invoiceNumber}</strong></div>
  </div>
</body>
</html>`;
}

export function renderReceiptHtml(data: ReceiptPdfData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Receipt ${data.receiptNumber}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 13px; color: #111827; margin: 0; padding: 32px; }
  .paid-stamp { color: #16a34a; border: 4px solid #16a34a; display: inline-block; padding: 6px 20px; font-size: 28px; font-weight: 700; border-radius: 4px; transform: rotate(-10deg); margin: 16px 0; }
</style>
</head>
<body>
  <div style="text-align:center;margin-bottom:24px;">
    <div style="font-size:22px;font-weight:700;color:#16a34a;">${data.groupName}</div>
    <div style="font-size:18px;font-weight:700;margin-top:8px;">PAYMENT RECEIPT</div>
    <div class="paid-stamp">PAID</div>
  </div>

  <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
    <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;">Receipt Number</td><td style="padding:8px;border:1px solid #e5e7eb;font-weight:700;">${data.receiptNumber}</td></tr>
    <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;">Invoice Reference</td><td style="padding:8px;border:1px solid #e5e7eb;">${data.invoiceNumber}</td></tr>
    <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;">Received From</td><td style="padding:8px;border:1px solid #e5e7eb;">${data.recipientName}</td></tr>
    <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;">Payment Date</td><td style="padding:8px;border:1px solid #e5e7eb;">${data.paymentDate}</td></tr>
    <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;">Payment Method</td><td style="padding:8px;border:1px solid #e5e7eb;">${data.paymentMethod}</td></tr>
    <tr><td style="padding:8px;border:1px solid #e5e7eb;background:#f9fafb;font-weight:600;font-size:15px;">Amount Paid</td><td style="padding:8px;border:1px solid #e5e7eb;color:#16a34a;font-weight:700;font-size:15px;">KES ${fmt(data.amountPaid)}</td></tr>
    ${data.balance > 0 ? `<tr><td style="padding:8px;border:1px solid #e5e7eb;background:#fff7ed;font-weight:600;color:#d97706;">Balance Remaining</td><td style="padding:8px;border:1px solid #e5e7eb;color:#d97706;font-weight:700;">KES ${fmt(data.balance)}</td></tr>` : ''}
  </table>

  <div style="text-align:center;margin-top:32px;font-size:11px;color:#6b7280;">
    This is an official receipt generated by Kitabu Yetu.
  </div>
</body>
</html>`;
}

// Stub: returns null until Puppeteer is installed
export async function generateInvoicePdf(_data: InvoicePdfData): Promise<Buffer | null> {
  return null;
}

export async function generateReceiptPdf(_data: ReceiptPdfData): Promise<Buffer | null> {
  return null;
}

function fmt(n: number): string {
  return Number(n).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
