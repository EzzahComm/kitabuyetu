// PDF generation service
// Puppeteer/Chromium not installed (disk space constraint).
// Returns HTML that can be printed to PDF by the browser, or null when a
// Buffer is required and Puppeteer is unavailable.
// To activate: npm install puppeteer-core @sparticuz/chromium

import { BRAND, getBrandLogoUrl, brandFooterLine } from '@/lib/brand';

export interface InvoicePdfData {
  invoiceNumber:  string;
  recipientName:  string;
  recipientEmail: string;
  invoiceDate:    string;
  dueDate:        string;
  lineItems:      { description: string; quantity: number; unitPrice: number; total: number }[];
  subtotal:       number;
  taxAmount:      number;
  amountDue:      number;
  amountPaid:     number;
  notes?:         string;
  groupName:      string;
  shortcode:      string;
}

export interface ReceiptPdfData {
  receiptNumber:  string;
  invoiceNumber:  string;
  recipientName:  string;
  amountPaid:     number;
  paymentDate:    string;
  paymentMethod:  string;
  balance:        number;
  groupName:      string;
}

// ─── Shared shell ────────────────────────────────────────────────────────────

/**
 * Wraps document content in a print-ready HTML shell with a branded header
 * (logo + group name) and footer (tagline + generated stamp).
 */
function pdfShell(opts: { title: string; groupName: string; documentLabel: string; body: string }): string {
  const { title, groupName, documentLabel, body } = opts;
  const logoUrl     = getBrandLogoUrl();
  const generatedAt = new Date().toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' });
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<style>
  @page { size: A4; margin: 18mm 16mm 22mm; }
  body {
    font-family: ${BRAND.fontFamily};
    font-size: 13px;
    color: ${BRAND.colors.text};
    margin: 0;
    padding: 0;
    background: ${BRAND.colors.surface};
  }
  table { width: 100%; border-collapse: collapse; }
  .brand-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 16px;
    margin-bottom: 24px;
    border-bottom: 2px solid ${BRAND.colors.green};
  }
  .brand-header .logo { display: flex; align-items: center; gap: 12px; }
  .brand-header img { height: 48px; width: 48px; object-fit: contain; }
  .brand-header .group-name { font-size: 20px; font-weight: 700; color: ${BRAND.colors.blue}; }
  .brand-header .platform   { font-size: 10px; color: ${BRAND.colors.textMuted}; letter-spacing: 0.04em; text-transform: uppercase; margin-top: 2px; }
  .brand-header .doc-label  { text-align: right; font-size: 22px; font-weight: 700; color: ${BRAND.colors.blue}; letter-spacing: 0.02em; }
  .brand-footer {
    margin-top: 32px;
    padding-top: 12px;
    border-top: 1px solid ${BRAND.colors.border};
    font-size: 11px;
    color: ${BRAND.colors.textMuted};
    display: flex;
    justify-content: space-between;
  }
  .brand-footer strong { color: ${BRAND.colors.blue}; }
  .paid-stamp {
    color: ${BRAND.colors.green};
    border: 3px solid ${BRAND.colors.green};
    display: inline-block;
    padding: 4px 16px;
    font-size: 20px;
    font-weight: 700;
    border-radius: 4px;
    transform: rotate(-15deg);
  }
  .amount-due { font-size: 18px; font-weight: 700; color: ${BRAND.colors.danger}; }
</style>
</head>
<body>
  <header class="brand-header">
    <div class="logo">
      <img src="${logoUrl}" alt="${BRAND.name}" />
      <div>
        <div class="group-name">${groupName}</div>
        <div class="platform">${BRAND.name} · ${BRAND.tagline}</div>
      </div>
    </div>
    <div class="doc-label">${documentLabel}</div>
  </header>

  ${body}

  <footer class="brand-footer">
    <span><strong>${brandFooterLine()}</strong></span>
    <span>Generated ${generatedAt}</span>
  </footer>
</body>
</html>`;
}

// ─── Invoice ──────────────────────────────────────────────────────────────────

export function renderInvoiceHtml(data: InvoicePdfData): string {
  const C = BRAND.colors;
  const rows = data.lineItems
    .map(
      (item) => `
      <tr>
        <td style="padding:8px;border-bottom:1px solid ${C.border};">${item.description}</td>
        <td style="padding:8px;border-bottom:1px solid ${C.border};text-align:right;">${item.quantity}</td>
        <td style="padding:8px;border-bottom:1px solid ${C.border};text-align:right;">KES ${fmt(item.unitPrice)}</td>
        <td style="padding:8px;border-bottom:1px solid ${C.border};text-align:right;font-weight:600;">KES ${fmt(item.total)}</td>
      </tr>`,
    )
    .join('');

  const body = `
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px;">
    <div>
      <div style="color:${C.textMuted};font-size:11px;letter-spacing:0.04em;text-transform:uppercase;margin-bottom:4px;">Invoice Number</div>
      <div style="font-weight:700;font-size:16px;color:${C.blue};">${data.invoiceNumber}</div>
      ${data.amountPaid >= data.amountDue ? '<div class="paid-stamp" style="margin-top:12px;">PAID</div>' : ''}
    </div>
    <div style="text-align:right;">
      <div style="font-weight:600;margin-bottom:4px;">Billed To</div>
      <div>${data.recipientName}</div>
      <div style="color:${C.textMuted};font-size:12px;">${data.recipientEmail}</div>
    </div>
  </div>

  <table style="margin-bottom:16px;width:auto;margin-left:auto;">
    <tr><td style="padding:2px 8px;color:${C.textMuted};">Invoice Date:</td><td style="padding:2px 8px;font-weight:600;">${data.invoiceDate}</td></tr>
    <tr><td style="padding:2px 8px;color:${C.textMuted};">Due Date:</td><td style="padding:2px 8px;font-weight:600;color:${C.danger};">${data.dueDate}</td></tr>
  </table>

  <table>
    <thead>
      <tr>
        <th style="background:${C.greenLight};padding:10px 8px;text-align:left;font-weight:600;color:${C.blue};">Description</th>
        <th style="background:${C.greenLight};padding:10px 8px;text-align:right;font-weight:600;color:${C.blue};">Qty</th>
        <th style="background:${C.greenLight};padding:10px 8px;text-align:right;font-weight:600;color:${C.blue};">Unit Price</th>
        <th style="background:${C.greenLight};padding:10px 8px;text-align:right;font-weight:600;color:${C.blue};">Total</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <table style="width:300px;margin-left:auto;margin-top:16px;">
    <tr><td style="padding:6px 8px;color:${C.textMuted};">Subtotal</td><td style="padding:6px 8px;text-align:right;">KES ${fmt(data.subtotal)}</td></tr>
    ${data.taxAmount > 0 ? `<tr><td style="padding:6px 8px;color:${C.textMuted};">Tax (16% VAT)</td><td style="padding:6px 8px;text-align:right;">KES ${fmt(data.taxAmount)}</td></tr>` : ''}
    <tr style="border-top:2px solid ${C.blue};"><td style="padding:6px 8px;font-weight:700;font-size:15px;">Total Due</td><td style="padding:6px 8px;text-align:right;" class="amount-due">KES ${fmt(data.amountDue)}</td></tr>
    ${data.amountPaid > 0 ? `<tr><td style="padding:6px 8px;color:${C.green};">Amount Paid</td><td style="padding:6px 8px;text-align:right;color:${C.green};">KES ${fmt(data.amountPaid)}</td></tr>` : ''}
    ${data.amountPaid > 0 && data.amountPaid < data.amountDue ? `<tr><td style="padding:6px 8px;font-weight:700;color:${C.warning};">Balance</td><td style="padding:6px 8px;text-align:right;color:${C.warning};font-weight:700;">KES ${fmt(data.amountDue - data.amountPaid)}</td></tr>` : ''}
  </table>

  ${data.notes ? `<div style="margin-top:24px;padding:12px;background:${C.neutralBg};border-radius:4px;color:${C.textMuted};font-size:12px;">${data.notes}</div>` : ''}

  <div style="margin-top:32px;padding:16px;background:${C.greenLight};border-left:4px solid ${C.green};border-radius:6px;">
    <div style="font-weight:600;margin-bottom:4px;color:${C.blue};">Payment Instructions</div>
    <div>M-Pesa Paybill: <strong>${data.shortcode}</strong></div>
    <div>Account Number: <strong>${data.invoiceNumber}</strong></div>
  </div>`;

  return pdfShell({
    title:         `Invoice ${data.invoiceNumber}`,
    groupName:     data.groupName,
    documentLabel: 'INVOICE',
    body,
  });
}

// ─── Receipt ──────────────────────────────────────────────────────────────────

export function renderReceiptHtml(data: ReceiptPdfData): string {
  const C = BRAND.colors;
  const body = `
  <div style="text-align:center;margin-bottom:24px;">
    <div class="paid-stamp" style="font-size:28px;padding:6px 24px;border-width:4px;transform:rotate(-10deg);">PAID</div>
  </div>

  <table style="margin-bottom:16px;">
    <tr><td style="padding:8px;border:1px solid ${C.border};background:${C.neutralBg};font-weight:600;">Receipt Number</td><td style="padding:8px;border:1px solid ${C.border};font-weight:700;color:${C.blue};">${data.receiptNumber}</td></tr>
    <tr><td style="padding:8px;border:1px solid ${C.border};background:${C.neutralBg};font-weight:600;">Invoice Reference</td><td style="padding:8px;border:1px solid ${C.border};">${data.invoiceNumber}</td></tr>
    <tr><td style="padding:8px;border:1px solid ${C.border};background:${C.neutralBg};font-weight:600;">Received From</td><td style="padding:8px;border:1px solid ${C.border};">${data.recipientName}</td></tr>
    <tr><td style="padding:8px;border:1px solid ${C.border};background:${C.neutralBg};font-weight:600;">Payment Date</td><td style="padding:8px;border:1px solid ${C.border};">${data.paymentDate}</td></tr>
    <tr><td style="padding:8px;border:1px solid ${C.border};background:${C.neutralBg};font-weight:600;">Payment Method</td><td style="padding:8px;border:1px solid ${C.border};">${data.paymentMethod}</td></tr>
    <tr><td style="padding:8px;border:1px solid ${C.border};background:${C.neutralBg};font-weight:600;font-size:15px;">Amount Paid</td><td style="padding:8px;border:1px solid ${C.border};color:${C.green};font-weight:700;font-size:15px;">KES ${fmt(data.amountPaid)}</td></tr>
    ${data.balance > 0 ? `<tr><td style="padding:8px;border:1px solid ${C.border};background:#FFF7ED;font-weight:600;color:${C.warning};">Balance Remaining</td><td style="padding:8px;border:1px solid ${C.border};color:${C.warning};font-weight:700;">KES ${fmt(data.balance)}</td></tr>` : ''}
  </table>

  <div style="text-align:center;margin-top:24px;font-size:11px;color:${C.textMuted};">
    This is an official receipt generated digitally by ${BRAND.name}.
  </div>`;

  return pdfShell({
    title:         `Receipt ${data.receiptNumber}`,
    groupName:     data.groupName,
    documentLabel: 'RECEIPT',
    body,
  });
}

// ─── Buffer stubs (Puppeteer not installed) ──────────────────────────────────

export async function generateInvoicePdf(_data: InvoicePdfData): Promise<Buffer | null> {
  return null;
}

export async function generateReceiptPdf(_data: ReceiptPdfData): Promise<Buffer | null> {
  return null;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return Number(n).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
