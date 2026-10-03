/**
 * The weekly savings-update SMS sent by the notify_weekly_savings_update job
 * (lib/jobs/handlers.ts) to EVERY active member of EVERY active group -
 * unlike contribution-statement.ts's monthly arrears statement, this is not
 * limited to members who are behind or groups with a configured
 * contribution-plan.service.ts plan.
 *
 * Plain ASCII on purpose - see contribution-statement.ts's own header on why.
 */

export interface WeeklySavingsUpdateRow {
  membership_id: string;
  group_id: string;
  member_id: string;
  phone: string;
  first_name: string;
  membership_no: string | null;
  group_name: string;
  /** Numeric text from Postgres (SUM(...)::text). Lifetime, gross - see migration 207's header on why this is never netted against SMS/subscription costs. */
  total_contributed: string;
  /** The group's own lifetime total, across every member. */
  group_total_saved: string;
  /** This member's own arrears against the effective weekly target (their own override, or the platform default - weekly-contribution-default.service.ts), since the later of their join date and the group's onboarding. */
  outstanding: string;
}

function kes(amount: number): string {
  return amount.toLocaleString('en-KE', { maximumFractionDigits: 2 });
}

export function buildWeeklySavingsUpdateMessage(r: WeeklySavingsUpdateRow, paybill: string): string {
  const totalContributed = parseFloat(r.total_contributed);
  const groupTotalSaved = parseFloat(r.group_total_saved);
  const outstanding = parseFloat(r.outstanding);
  const account = r.membership_no?.trim() || null;

  let text =
    `Dear ${r.first_name}, weekly update from ${r.group_name}: ` +
    `Your total contribution to date is KES ${kes(totalContributed)}. ` +
    `${r.group_name} has saved KES ${kes(groupTotalSaved)} in total.`;

  if (outstanding > 0) {
    text += ` You have KES ${kes(outstanding)} outstanding.`;
    text += ` Pay via M-Pesa Paybill ${paybill}`;
    text += account ? `, Acc ${account}.` : '.';
  } else {
    text += " You're fully paid up - thank you!";
  }

  return text;
}
