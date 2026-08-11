/**
 * The reminder path must send exactly once per occurrence. These tests pin the
 * orchestration that guarantees it: a schedule is only sent when its occurrence
 * is claimed (advanced under a row lock), and the send is enqueued on the *same*
 * transaction client as the claim, so the two commit together.
 */
import { processDueSmsSchedules, processDueScheduledCampaigns } from '@/lib/services/sms-scheduler.service';
import { enqueueJob } from '@/lib/jobs';
import { resolveSmsRecipients } from '@/lib/services/sms.service';

jest.mock('@/lib/jobs', () => ({ enqueueJob: jest.fn() }));
jest.mock('@/lib/services/sms.service', () => ({ resolveSmsRecipients: jest.fn() }));
jest.mock('@/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// Every withAdminDb call gets a fresh fake client; we branch the SQL to serve
// the outer schedule SELECT and the per-row claim, and record each client so a
// test can assert the enqueue ran on the claim's client.
type FakeClient = { query: jest.Mock };
let clients: FakeClient[] = [];
let claimResult: Array<{ occurrence: string }>;
let campaignRows: Array<Record<string, unknown>>;
const SCHEDULE = {
  id: 'sched-1',
  group_id: 'grp-1',
  group_name: 'Umoja Chama',
  schedule_type: 'daily',
  message: 'Meeting reminder',
  template_body: null,
  recipient_type: 'all_members',
  raw_recipients: null,
  next_run_at: '2026-07-11T08:00:00.000Z',
  created_by: 'user-1',
};

jest.mock('@/lib/db', () => ({
  withAdminDb: (fn: (client: FakeClient) => unknown) => {
    const client: FakeClient = {
      query: jest.fn((sql: string) => {
        if (/FROM\s+sms_schedules s/i.test(sql)) return Promise.resolve({ rows: [SCHEDULE] });
        if (/WITH claimed/i.test(sql)) return Promise.resolve({ rows: claimResult });
        if (/FROM\s+sms_campaigns c/i.test(sql)) return Promise.resolve({ rows: campaignRows });
        return Promise.resolve({ rows: [] });
      }),
    };
    clients.push(client);
    return Promise.resolve(fn(client));
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  clients = [];
  claimResult = [{ occurrence: '2026-07-11T08:00:00.000Z' }];
  campaignRows = [];
  SCHEDULE.message = 'Meeting reminder'; // tests mutate this; reset each run
  (resolveSmsRecipients as jest.Mock).mockResolvedValue(['254712345678']);
});

describe('processDueSmsSchedules', () => {
  it('enqueues exactly one send for a claimed occurrence', async () => {
    const res = await processDueSmsSchedules();

    expect(res).toEqual({ processed: 1, skipped: 0 });
    expect(enqueueJob).toHaveBeenCalledTimes(1);
    expect(enqueueJob).toHaveBeenCalledWith(
      'sms_bulk_send',
      expect.objectContaining({ groupId: 'grp-1', referenceType: 'schedule', referenceId: 'sched-1' }),
      expect.objectContaining({ dedup_key: 'sms_bulk_send:schedule:sched-1:2026-07-11T08:00:00.000Z' }),
      expect.anything(),
    );
  });

  it('enqueues the send on the same transaction client that claimed the occurrence', async () => {
    await processDueSmsSchedules();

    // clients[0] served the outer SELECT; clients[1] is the per-row claim tx.
    const claimClient = clients[1];
    const passedClient = (enqueueJob as jest.Mock).mock.calls[0][3];
    expect(passedClient).toBe(claimClient);
  });

  it('sends nothing when the occurrence was already claimed by another tick', async () => {
    claimResult = []; // FOR UPDATE SKIP LOCKED found nothing to advance

    const res = await processDueSmsSchedules();

    expect(res).toEqual({ processed: 0, skipped: 0 });
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('claims but does not enqueue when the schedule resolves to no recipients', async () => {
    (resolveSmsRecipients as jest.Mock).mockResolvedValue([]);

    const res = await processDueSmsSchedules();

    expect(res).toEqual({ processed: 0, skipped: 1 });
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it('pre-renders {{group_name}} but leaves per-recipient placeholders for the dispatch job', async () => {
    SCHEDULE.message = 'Hi {{first_name}}, {{group_name}} meets tomorrow.';

    await processDueSmsSchedules();

    // {{first_name}} survives the enqueue on purpose — handleSmsBulkSend
    // renders it per recipient against resolveRecipientVars()'s phone→member
    // map, and strips whatever is still unresolved after that. Stripping it
    // here would delete it before that step could ever resolve it.
    expect(enqueueJob).toHaveBeenCalledWith(
      'sms_bulk_send',
      expect.objectContaining({ message: 'Hi {{first_name}}, Umoja Chama meets tomorrow.' }),
      expect.anything(),
      expect.anything(),
    );
  });
});

describe('processDueScheduledCampaigns', () => {
  const CAMPAIGN = {
    id: 'camp-1',
    group_id: 'grp-1',
    group_name: 'Umoja Chama',
    message: 'Reminder {{first_name}}: {{group_name}} dues are due.',
    recipient_type: 'all_members',
    raw_recipients: null,
    created_by: 'user-1',
    payer_type: 'group',
    payer_organization_id: null,
  };

  it('pre-renders group_name but leaves per-recipient placeholders for the dispatch job', async () => {
    campaignRows = [{ ...CAMPAIGN }];

    const res = await processDueScheduledCampaigns();

    expect(res).toEqual({ processed: 1 });
    expect(enqueueJob).toHaveBeenCalledWith(
      'sms_bulk_send',
      expect.objectContaining({
        campaignId: 'camp-1',
        message:    'Reminder {{first_name}}: Umoja Chama dues are due.',
      }),
      expect.objectContaining({ dedup_key: 'sms_bulk_send:camp-1' }),
    );
  });

  it('completes the campaign with zero counts when it resolves to no recipients', async () => {
    campaignRows = [{ ...CAMPAIGN }];
    (resolveSmsRecipients as jest.Mock).mockResolvedValue([]);

    const res = await processDueScheduledCampaigns();

    expect(res).toEqual({ processed: 0 });
    expect(enqueueJob).not.toHaveBeenCalled();
  });
});
