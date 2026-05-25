import { z } from 'zod';

// Kinds supported by the two-phase importer. Add new strings here AND in the
// import_jobs.kind CHECK constraint (mig 024 onwards).
export const IMPORT_KINDS = ['members', 'contributions', 'loans'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export const ImportQuerySchema = z.object({
  type: z.enum(IMPORT_KINDS),
});

// ── Contribution import (Phase E7 — two-phase) ────────────────────────────

export const CONTRIBUTION_CSV_COLUMNS = [
  'member_phone',       // required, lookup key
  'amount',             // required, positive
  'contribution_date',  // required, YYYY-MM-DD
  'payment_method',     // optional enum
  'mpesa_receipt',      // optional, unique in DB
  'notes',              // optional
] as const;
export type ContributionCsvColumn = (typeof CONTRIBUTION_CSV_COLUMNS)[number];

const CONTRIBUTION_HEADER_ALIASES: Record<string, ContributionCsvColumn> = {
  // member_phone
  memberphone:        'member_phone',
  phone:              'member_phone',
  phonenumber:        'member_phone',
  mobile:             'member_phone',
  msisdn:             'member_phone',
  // amount
  amount:             'amount',
  amountkes:          'amount',
  contributionamount: 'amount',
  total:              'amount',
  value:              'amount',
  // contribution_date
  contributiondate:   'contribution_date',
  date:               'contribution_date',
  paymentdate:        'contribution_date',
  paiddate:           'contribution_date',
  paymenton:          'contribution_date',
  // payment_method
  paymentmethod:      'payment_method',
  method:             'payment_method',
  channel:            'payment_method',
  paymentchannel:     'payment_method',
  // mpesa_receipt
  mpesareceipt:       'mpesa_receipt',
  mpesarefcode:       'mpesa_receipt',
  receipt:            'mpesa_receipt',
  receiptnumber:      'mpesa_receipt',
  reference:          'mpesa_receipt',
  refno:              'mpesa_receipt',
  // notes
  notes:              'notes',
  note:               'notes',
  description:        'notes',
  remarks:            'notes',
  comment:            'notes',
};

const blankableString = (max: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().max(max).optional(),
  );
const blankableDate =
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().date('Date must be YYYY-MM-DD').optional(),
  );

const PAYMENT_METHODS = ['mpesa', 'cash', 'bank_transfer', 'cheque', 'standing_order'] as const;

export const ContributionCsvRowSchema = z.object({
  member_phone:      z.string().min(1, 'member_phone is required'),
  amount:            z.coerce.number().positive('amount must be greater than zero'),
  contribution_date: z.string().date('contribution_date must be YYYY-MM-DD'),
  payment_method:    z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v?.toString().trim().toLowerCase()),
    z.enum(PAYMENT_METHODS).optional(),
  ),
  mpesa_receipt:     blankableString(50),
  notes:             blankableString(500),
});

// ── Loan import (Phase E7) ────────────────────────────────────────────────

export const LOAN_CSV_COLUMNS = [
  'member_phone',         // required
  'principal_amount',     // required, positive
  'interest_rate',        // required, annual %
  'term_months',          // required, int
  'disbursement_date',    // required, YYYY-MM-DD
  'status',               // optional: active|completed|defaulted|written_off (default active)
  'purpose',              // optional
  'notes',                // optional
] as const;
export type LoanCsvColumn = (typeof LOAN_CSV_COLUMNS)[number];

const LOAN_HEADER_ALIASES: Record<string, LoanCsvColumn> = {
  // member_phone
  memberphone:        'member_phone',
  phone:              'member_phone',
  phonenumber:        'member_phone',
  mobile:             'member_phone',
  msisdn:             'member_phone',
  // principal_amount
  principalamount:    'principal_amount',
  principal:          'principal_amount',
  amount:             'principal_amount',
  loanamount:         'principal_amount',
  // interest_rate
  interestrate:       'interest_rate',
  rate:               'interest_rate',
  annualrate:         'interest_rate',
  interest:           'interest_rate',
  // term_months
  termmonths:         'term_months',
  term:               'term_months',
  durationmonths:     'term_months',
  loantermmonths:     'term_months',
  months:             'term_months',
  // disbursement_date
  disbursementdate:   'disbursement_date',
  disburseddate:      'disbursement_date',
  date:               'disbursement_date',
  startdate:          'disbursement_date',
  // status
  status:             'status',
  loanstatus:         'status',
  state:              'status',
  // purpose
  purpose:            'purpose',
  reason:             'purpose',
  loanpurpose:        'purpose',
  // notes
  notes:              'notes',
  note:               'notes',
  description:        'notes',
  remarks:            'notes',
  comment:            'notes',
};

const LOAN_HISTORICAL_STATUSES = ['active', 'completed', 'defaulted', 'written_off'] as const;

export const LoanCsvRowSchema = z.object({
  member_phone:      z.string().min(1, 'member_phone is required'),
  principal_amount:  z.coerce.number().positive('principal_amount must be greater than zero'),
  interest_rate:     z.coerce.number().nonnegative('interest_rate must be ≥ 0').max(200, 'interest_rate is unrealistically high'),
  term_months:       z.coerce.number().int().positive('term_months must be a positive integer'),
  disbursement_date: z.string().date('disbursement_date must be YYYY-MM-DD'),
  status:            z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v?.toString().trim().toLowerCase()),
    z.enum(LOAN_HISTORICAL_STATUSES).default('active'),
  ),
  purpose:           blankableString(500),
  notes:             blankableString(1000),
});

// ── Shared header normaliser used by all kinds ────────────────────────────

export function normaliseCsvHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Per-kind header resolver. resolveCsvHeader stays exported for backwards
// compat with the member importer; callers for other kinds use resolveHeaderFor.
export function resolveHeaderFor(
  kind: ImportKind,
  header: string,
): string | null {
  const norm = normaliseCsvHeader(header);
  switch (kind) {
    case 'members':       return MEMBER_HEADER_ALIASES[norm]       ?? null;
    case 'contributions': return CONTRIBUTION_HEADER_ALIASES[norm] ?? null;
    case 'loans':         return LOAN_HEADER_ALIASES[norm]         ?? null;
  }
}

// ── Member import (Phase E3 — refactored) ─────────────────────────────────

// Canonical CSV column names. These are what the downloadable template ships
// and what the user-facing validation errors reference. The alias map below
// recognises common variations so spreadsheets exported from other tools
// (Excel-style "First Name", camelCase "firstName", etc.) just work.
export const MEMBER_CSV_COLUMNS = [
  'phone',              // required, Kenyan format (07…, +254…)
  'first_name',         // required
  'middle_name',
  'last_name',          // required
  'email',
  'national_id',
  'date_of_birth',      // YYYY-MM-DD
  'gender',              // male | female | other | prefer_not_to_say
  'address',
  'alternative_phone',
  'county_name',        // human-readable; service resolves to county_id
  'occupation',
  'role',                // group_admin | treasurer | secretary | member (default: member)
  'joined_at',           // YYYY-MM-DD, optional (defaults to today at commit)
] as const;

export type MemberCsvColumn = (typeof MEMBER_CSV_COLUMNS)[number];

// Alias map: every key is a normalised header (lowercased, non-alphanumerics
// stripped) → canonical column. Headers are normalised the same way before
// lookup so casing/punctuation differences are absorbed.
const MEMBER_HEADER_ALIASES: Record<string, MemberCsvColumn> = {
  // phone
  phone:               'phone',
  phonenumber:         'phone',
  mobile:              'phone',
  mobilenumber:        'phone',
  primaryphone:        'phone',
  // first_name
  firstname:           'first_name',
  givenname:           'first_name',
  fname:               'first_name',
  // middle_name
  middlename:          'middle_name',
  othername:           'middle_name',
  othernames:          'middle_name',
  // last_name
  lastname:            'last_name',
  surname:             'last_name',
  familyname:          'last_name',
  lname:               'last_name',
  // email
  email:               'email',
  emailaddress:        'email',
  // national_id
  nationalid:          'national_id',
  idnumber:            'national_id',
  id:                  'national_id',
  passportnumber:      'national_id',
  passport:            'national_id',
  // date_of_birth
  dateofbirth:         'date_of_birth',
  dob:                 'date_of_birth',
  birthdate:           'date_of_birth',
  birthday:            'date_of_birth',
  // gender
  gender:              'gender',
  sex:                 'gender',
  // address
  address:             'address',
  physicaladdress:     'address',
  residentialaddress:  'address',
  // alternative_phone
  alternativephone:    'alternative_phone',
  altphone:            'alternative_phone',
  secondaryphone:      'alternative_phone',
  otherphone:          'alternative_phone',
  // county_name
  county:              'county_name',
  countyname:          'county_name',
  region:              'county_name',
  // occupation
  occupation:          'occupation',
  job:                 'occupation',
  profession:          'occupation',
  employer:            'occupation',
  // role
  role:                'role',
  memberrole:          'role',
  position:            'role',
  // joined_at
  joinedat:            'joined_at',
  joindate:            'joined_at',
  dateofjoining:       'joined_at',
  joindateymd:         'joined_at',
};

/**
 * Backwards-compatible alias for members callers. Prefer resolveHeaderFor()
 * for new code that already knows the kind.
 */
export function resolveCsvHeader(header: string): MemberCsvColumn | null {
  return (MEMBER_HEADER_ALIASES[normaliseCsvHeader(header)] ?? null) as MemberCsvColumn | null;
}

// Gender accepts a few common spellings; the schema below normalises them.
// Kept separate so the row schema stays terse.
const genderEnum = z.enum(['male', 'female', 'other', 'prefer_not_to_say']);
const looseGender = z
  .string()
  .transform((v) => {
    const k = v.trim().toLowerCase();
    if (k === '' || k === 'n/a' || k === 'na')        return undefined;
    if (k === 'm' || k === 'male')                    return 'male';
    if (k === 'f' || k === 'female')                  return 'female';
    if (k === 'o' || k === 'other')                   return 'other';
    if (k.startsWith('prefer'))                       return 'prefer_not_to_say';
    return v.trim().toLowerCase();
  })
  .pipe(genderEnum.optional());

// blankableEmail used by members. blankableString + blankableDate are
// declared once at the top of the file and reused across kinds.
const blankableEmail =
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
               z.string().email('Invalid email format').optional());

export const MemberCsvRowSchema = z.object({
  phone:             z.string().min(1, 'phone is required'),
  first_name:        z.string().min(1, 'first_name is required'),
  middle_name:       blankableString(100),
  last_name:         z.string().min(1, 'last_name is required'),
  email:             blankableEmail,
  national_id:       blankableString(32),
  date_of_birth:     blankableDate,
  gender:            z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), looseGender.optional()),
  address:           blankableString(500),
  alternative_phone: blankableString(20),
  county_name:       blankableString(60),
  occupation:        blankableString(150),
  role:              z
    .preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v?.toString().trim().toLowerCase()),
                z.enum(['group_admin', 'treasurer', 'secretary', 'member']).default('member')),
  joined_at:         blankableDate,
});

export type ContributionCsvRow = z.infer<typeof ContributionCsvRowSchema>;
export type LoanCsvRow         = z.infer<typeof LoanCsvRowSchema>;
export type MemberCsvRow       = z.infer<typeof MemberCsvRowSchema>;
export type ImportQueryInput   = z.infer<typeof ImportQuerySchema>;

// ── Two-phase preview/commit/rollback API contracts ────────────────────────

export const ImportPreviewRowError = z.object({
  row:     z.number().int().positive(),
  message: z.string(),
  raw:     z.record(z.string(), z.string()).optional(),
});

export const ImportJobStatus = z.enum([
  'previewed', 'committed', 'cancelled', 'rolled_back', 'failed',
]);

export const RollbackBodySchema = z.object({
  reason: z.string().min(3).max(500).optional(),
});

export type ImportJobStatusType = z.infer<typeof ImportJobStatus>;
