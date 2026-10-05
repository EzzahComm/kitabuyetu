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
  /** Lifetime totals paid to this group — uncapped, unlike the arrears figures above. */
  total_contributed: string;
  total_welfare_contributed: string;
  /**
   * Group-wide (not per-member) — contributions + welfare collected, minus
   * SMS usage cost and subscription fees paid. The same figure for every
   * member of a given group. Can be negative if the group has spent more on
   * platform costs than it has collected.
   */
  group_balance: string;
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
  const contributionPaid = parseFloat(r.total_contributed);
  const welfarePaid = parseFloat(r.total_welfare_contributed);
  const groupBalance = parseFloat(r.group_balance);
  const account = r.membership_no?.trim() || null;

  let text = `Dear ${r.first_name}, ${r.group_name} balance update:`;
  if (contributionDue > 0) {
    text += ` Contribution arrears KES ${kes(contributionDue)} (${r.contribution_months} mo, KES ${kes(contributionPaid)} paid to date).`;
  }
  if (welfareDue > 0) {
    text += ` Welfare arrears KES ${kes(welfareDue)} (${r.welfare_months} mo, KES ${kes(welfarePaid)} paid to date).`;
  }

  text += ` Pay via M-Pesa Paybill ${paybill}`;
  if (account) {
    text +=
      contributionDue > 0 && welfareDue > 0
        ? `, Acc ${account} (contribution) or ${account}-W (welfare)`
        : welfareDue > 0
          ? `, Acc ${account}-W`
          : `, Acc ${account}`;
  }
  text += `. Group balance KES ${kes(groupBalance)}.`;
  return text;
}
