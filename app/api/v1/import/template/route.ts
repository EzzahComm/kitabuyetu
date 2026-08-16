export const dynamic = 'force-dynamic';
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth/middleware';
import {
  MEMBER_CSV_COLUMNS, CONTRIBUTION_CSV_COLUMNS, LOAN_CSV_COLUMNS,
  IMPORT_KINDS, type ImportKind,
} from '@/lib/validators/import.schema';
import { errorResponse } from '@/lib/utils/response';

/**
 * GET /api/v1/import/template?type=members|contributions|loans
 * Returns a downloadable CSV template with the canonical column headers
 * and a single illustrative sample row.
 */
export async function GET(req: NextRequest): Promise<Response> {
  return withAuth(req, async () => {
    const type = (req.nextUrl.searchParams.get('type') ?? 'members') as ImportKind;
    if (!IMPORT_KINDS.includes(type)) {
      return errorResponse(`Unsupported template type: ${type}. Supported: ${IMPORT_KINDS.join(', ')}.`, 'VALIDATION_ERROR', 422);
    }

    const today = new Date().toISOString().slice(0, 10);

    const built = type === 'members'       ? buildMembersCsv(today)
                : type === 'contributions' ? buildContributionsCsv(today)
                : /* loans */                buildLoansCsv(today);

    return new Response(built.csv, {
      status: 200,
      headers: {
        'Content-Type':        'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${built.filename}"`,
        'Cache-Control':       'no-store',
      },
    });
  });
}

function buildMembersCsv(today: string): { csv: string; filename: string } {
  const headers = [...MEMBER_CSV_COLUMNS];
  const sample: Record<typeof MEMBER_CSV_COLUMNS[number], string> = {
    phone:             '+254712345678',
    first_name:        'Wanjiku',
    middle_name:       'Achieng',
    last_name:         'Mwangi',
    email:             'wanjiku@example.com',
    national_id:       '12345678',
    date_of_birth:     '1990-05-12',
    gender:            'female',
    address:           'Westlands, Nairobi',
    alternative_phone: '+254700000000',
    county_name:       'Nairobi',
    occupation:        'Teacher',
    role:              'member',
    joined_at:         today,
  };
  return {
    csv: [headers.join(','), headers.map((h) => csvEscape(sample[h])).join(',')].join('\n') + '\n',
    filename: 'kitabuyetu-members-template.csv',
  };
}

function buildContributionsCsv(today: string): { csv: string; filename: string } {
  const headers = [...CONTRIBUTION_CSV_COLUMNS];
  const sample: Record<typeof CONTRIBUTION_CSV_COLUMNS[number], string> = {
    member_phone:      '+254712345678',
    amount:            '2000.00',
    contribution_date: today,
    payment_method:    'mpesa',
    mpesa_receipt:     'PJK1A2B3CD',
    notes:             'June monthly contribution',
  };
  return {
    csv: [headers.join(','), headers.map((h) => csvEscape(sample[h])).join(',')].join('\n') + '\n',
    filename: 'kitabuyetu-contributions-template.csv',
  };
}

function buildLoansCsv(today: string): { csv: string; filename: string } {
  const headers = [...LOAN_CSV_COLUMNS];
  const sample: Record<typeof LOAN_CSV_COLUMNS[number], string> = {
    member_phone:      '+254712345678',
    principal_amount:  '50000.00',
    // PER MONTH, not annual (migration 148). The sample used to read '12',
    // which invited a treasurer to enter an annual rate and get a loan
    // twelve times more expensive than they meant.
    interest_rate:     '10',
    term_months:       '6',
    disbursement_date: today,
    status:            'active',
    // Blank is the useful default — the loan then takes the group's own loan
    // policy. Shown filled in only so the accepted values are discoverable.
    interest_method:   'flat',
    purpose:           'School fees',
    notes:             'Imported from 2025 ledger',
  };
  return {
    csv: [headers.join(','), headers.map((h) => csvEscape(sample[h])).join(',')].join('\n') + '\n',
    filename: 'kitabuyetu-loans-template.csv',
  };
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
