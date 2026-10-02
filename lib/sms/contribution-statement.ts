/**
 * The monthly contribution/welfare statement SMS sent by the
 * notify_contribution_reminders job (lib/jobs/handlers.ts) to each member who
 * is in arrears under their group's contribution plan.
 *
 * Plain ASCII on purpose. One character outside the GSM-7 alphabet (an em dash
 * is enough) switches the whole message to UCS-2, which fits 70 characters per
 * segment instead of 160 and multiplies what every member's reminder costs.
 */

export interface ContributionStatementRow {
  membership_id: string;
  group_id: string;
  member_id: string;
  phone: string;
  first_name: string;
  membership_no: string | null;
  group_name: string;
  /** Numeric text from Postgres (SUM(...)::text). */
  outstanding_contribution: string;
  contribution_months: number;
  outstanding_welfare: string;
  welfare_months: number;
}

function kes(amount: number): string {
  return amount.toLocaleString('en-KE', { maximumFractionDigits: 2 });
}

/**
 * What the member owes and exactly where to pay it. Contributions are paid to the
 * member's plain membership number and welfare to the same number with a `-W`
 * suffix (lib/utils/membership-no.ts, product suffixes), both on the one platform
 * paybill, so the payment line is written once.
 */
export function buildStatementMessage(r: ContributionStatementRow, paybill: string): string {
  const contributionDue = parseFloat(r.outstanding_contribution);
  const welfareDue = parseFloat(r.outstanding_welfare);
  const account = r.membership_no?.trim() || null;

  let text = `Dear ${r.first_name}, ${r.group_name} balance update:`;
  if (contributionDue > 0) {
    text += ` Contribution arrears KES ${kes(contributionDue)} (${r.contribution_months} mo).`;
  }
  if (welfareDue > 0) {
    text += ` Welfare arrears KES ${kes(welfareDue)} (${r.welfare_months} mo).`;
  }

  text += ` Pay via M-Pesa Paybill ${paybill}`;
  if (!account) return `${text}.`;
  if (contributionDue > 0 && welfareDue > 0) return `${text}, Acc ${account} (contribution) or ${account}-W (welfare).`;
  return welfareDue > 0 ? `${text}, Acc ${account}-W.` : `${text}, Acc ${account}.`;
}
