import { createHash } from 'node:crypto';
import { POST } from '@/app/api/v1/import/historical-balances/check/route';
import { authHeaders, buildRequest } from './helpers/request';
import { createTestGroup, addGroupOfficer } from './helpers/fixtures';
import { rawQuery } from './helpers/db';
import { resetDatabase } from './helpers/cleanup';

const path = '/api/v1/import/historical-balances/check';
const cutoff = '2020-02-29';
const prefix = 'group_id,as_of,currency,';
const proposalHeader = prefix + 'membership_no,category,amount';
const scheduleHeader = proposalHeader + ',source_ref';
const controlHeader = prefix + 'category,amount,source_ref';
let groupId: string, officerId: string, first: string, second: string, external: string;

async function membership(group: string, memberId: string) {
  const [row] = await rawQuery<{ membership_no: string }>(
    'SELECT membership_no FROM group_members WHERE group_id = $1 AND member_id = $2',
    [group, memberId],
  );
  return row.membership_no;
}

beforeAll(async () => {
  await resetDatabase();
  ({ groupId, officerId } = await createTestGroup('treasurer'));
  first = await membership(groupId, officerId);
  second = await membership(groupId, await addGroupOfficer(groupId, officerId, 'member'));
  const other = await createTestGroup('treasurer');
  external = await membership(other.groupId, other.officerId);
});
afterAll(resetDatabase);

function closingFiles() {
  const scope = [groupId, cutoff, 'KES'].join(',') + ',';
  const a = scope + first + ',savings,0.10';
  const b = scope + second + ',savings,0.20';
  return {
    balances: [proposalHeader, a, b].join('\n'),
    member_close: [scheduleHeader, b + ',register-p2', a + ',register-p1'].join('\n'),
    controls: [
      controlHeader,
      ...['savings,0.30', 'share_capital,0', 'loan_principal,0', 'loan_interest,0', 'member_welfare,0'].map(
        (r, i) => scope + r + ',tb-' + i,
      ),
    ].join('\n'),
  };
}
type Files = ReturnType<typeof closingFiles>;
function formFor(files: Files, asOf = cutoff) {
  const form = new FormData();
  form.set('as_of', asOf);
  for (const [key, csv] of Object.entries(files)) form.set(key, new File([csv], key + '.csv'));
  return form;
}
async function check(form: FormData, allowed = true) {
  return POST(
    buildRequest(path, {
      method: 'POST',
      headers: authHeaders({
        userId: officerId,
        groupId,
        role: allowed ? 'treasurer' : 'member',
        permissions: allowed ? ['import.start'] : [],
      }),
      body: form,
    }),
  );
}
function financialState() {
  return rawQuery(
    `SELECT
    (SELECT jsonb_agg(jsonb_build_array(id, balance, reserved_amount) ORDER BY id) FROM accounts WHERE group_id = $1) AS accounts,
    (SELECT count(*) FROM import_jobs WHERE group_id = $1) AS jobs,
    (SELECT count(*) FROM journal_entries WHERE group_id = $1) AS journals,
    (SELECT count(*) FROM disbursement_requests WHERE group_id = $1) AS payouts,
    (SELECT count(*) FROM contributions WHERE group_id = $1) AS contributions,
    (SELECT count(*) FROM loans WHERE group_id = $1) AS loans`,
    [groupId],
  );
}

it('matches independent rows and exact category totals repeatedly without creating a financial record or reservation', async () => {
  const before = await financialState();
  const files = closingFiles();
  for (let i = 0; i < 2; i++) {
    const response = await check(formFor(files));
    const json = await response.json();
    expect(json).toMatchObject({
      success: true,
      data: {
        status: 'matched_for_review',
        rows: 2,
        members: 2,
        asOf: cutoff,
        groupId,
        totalsKES: { savings: '0.30', loan_principal: '0.00' },
        sha256: { balances: createHash('sha256').update(files.balances).digest('hex') },
      },
    });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  }
  expect(await financialState()).toEqual(before);
});

const lastRow = (csv: string) => csv.slice(csv.lastIndexOf('\n'));
const failures: [string, (files: Files) => void, RegExp][] = [
  [
    'offsetting errors across two members',
    (f) => {
      f.balances = f.balances.replace('0.10', '0.11').replace('0.20', '0.19');
    },
    /member balance is missing or differs/,
  ],
  [
    'one-cent control discrepancy',
    (f) => {
      f.controls = f.controls.replace('0.30', '0.31');
    },
    /closing control/,
  ],
  [
    'foreign membership even when both files agree',
    (f) => {
      f.balances = f.balances.replace(first, external);
      f.member_close = f.member_close.replace(first, external);
    },
    /unavailable in this group/,
  ],
  [
    'foreign attested group',
    (f) => {
      f.controls = f.controls.replace(groupId, 'another-group');
    },
    /review scope/,
  ],
  [
    'different cutoff in member schedule',
    (f) => {
      f.member_close = f.member_close.replace(cutoff, '2020-02-28');
    },
    /review scope/,
  ],
  [
    'wrong currency',
    (f) => {
      f.balances = f.balances.replace('KES', 'USD');
    },
    /review scope/,
  ],
  [
    'unknown category',
    (f) => {
      f.balances = f.balances.replace('savings', 'cash');
    },
    /category/,
  ],
  [
    'malformed amount',
    (f) => {
      f.balances = f.balances.replace('0.10', '1e2');
    },
    /KES amount/,
  ],
  [
    'negative balance requiring review',
    (f) => {
      f.balances = f.balances.replace('0.10', '-0.10');
    },
    /KES amount/,
  ],
  [
    'fractional cent',
    (f) => {
      f.balances = f.balances.replace('0.10', '0.105');
    },
    /KES amount/,
  ],
  [
    'invalid membership check digit',
    (f) => {
      f.balances = f.balances.replace(first, first.slice(0, 7) + ((Number(first[7]) + 1) % 10));
    },
    /invalid membership/,
  ],
  [
    'duplicate member and category',
    (f) => {
      f.balances += lastRow(f.balances);
    },
    /duplicate member/,
  ],
  [
    'omitted member schedule row',
    (f) => {
      f.member_close = f.member_close.split('\n').slice(0, -1).join('\n');
    },
    /missing independent member balance/,
  ],
  [
    'extra schedule row for valid member',
    (f) => {
      f.member_close += lastRow(f.member_close)
        .replace('savings', 'loan_interest')
        .replace('register-p1', 'register-p3');
    },
    /missing or differs/,
  ],
  [
    'missing source reference',
    (f) => {
      f.controls = f.controls.replace('tb-0', '');
    },
    /source document/,
  ],
  [
    'reused evidence locator',
    (f) => {
      f.member_close = f.member_close.replace('register-p2', 'register-p1');
    },
    /source document/,
  ],
  [
    'duplicate control',
    (f) => {
      f.controls += lastRow(f.controls).replace('tb-4', 'tb-5');
    },
    /duplicate category/,
  ],
  [
    'missing explicit zero control',
    (f) => {
      f.controls = f.controls.split('\n').slice(0, -1).join('\n');
    },
    /missing closing control/,
  ],
  [
    'duplicate header',
    (f) => {
      f.balances = f.balances.replace('currency', 'as_of');
    },
    /CSV columns/,
  ],
  [
    'malformed quoting',
    (f) => {
      f.balances += '"';
    },
    /valid UTF-8 CSV/,
  ],
  [
    'empty schedule',
    (f) => {
      f.member_close = scheduleHeader;
    },
    /data rows/,
  ],
  [
    'excess record count',
    (f) => {
      f.balances = proposalHeader + lastRow(f.balances).repeat(5001);
    },
    /data rows/,
  ],
];
it.each(failures)('blocks %s', async (_name, change, message) => {
  const files = closingFiles();
  change(files);
  const res = await check(formFor(files));
  expect(res.status).toBe(422);
  expect((await res.json()).error).toMatch(message);
});
it.each(['2021-02-29', '2999-01-01'])('rejects an invalid or unclosed day %s', async (asOf) => {
  const res = await check(formFor(closingFiles(), asOf));
  expect(res.status).toBe(422);
  expect((await res.json()).error).toMatch(/completed Nairobi calendar day/);
});
it('checks a closing total at the NUMERIC(15,2) upper bound to the cent', async () => {
  const files = closingFiles();
  files.balances = files.balances.replace('0.10', '9999999999999.79');
  files.member_close = files.member_close.replace('0.10', '9999999999999.79');
  files.controls = files.controls.replace('0.30', '9999999999999.99');
  const response = await check(formFor(files));
  expect((await response.json()).data.totalsKES.savings).toBe('9999999999999.99');
});
it('holds the current Nairobi day open even after local midnight', async () => {
  const mockedClock = jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'performance'] });
  try {
    mockedClock.setSystemTime(new Date('2026-06-14T21:30:00Z'));
    const files = closingFiles();
    for (const key of ['balances', 'member_close', 'controls'] as const) {
      files[key] = files[key].replaceAll(cutoff, '2026-06-14');
    }
    expect((await check(formFor(files, '2026-06-14'))).status).toBe(200);
    expect((await check(formFor(files, '2026-06-15'))).status).toBe(422);
  } finally {
    jest.useRealTimers();
  }
});
it('requires the financial import permission', async () => {
  expect((await check(formFor(closingFiles()), false)).status).toBe(403);
});
it('requires all three distinct upload fields', async () => {
  const form = formFor(closingFiles());
  form.delete('controls');
  expect((await check(form)).status).toBe(422);
});
it('rejects oversized files before CSV processing', async () => {
  const form = formFor(closingFiles());
  form.set('balances', new File(['a'.repeat(1024 * 1024 + 1)], 'large.csv'));
  expect((await check(form)).status).toBe(413);
});
