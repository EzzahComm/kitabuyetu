import {
  assertChangishaPlanActive,
  ChangishaPlanRequiredError,
  hasActiveChangishaPlan,
} from '@/lib/services/campaign-plan.service';
import { PLAN_MONTHLY_FEES } from '@/types/enums';

const query = jest.fn();
const db = { query } as unknown as Parameters<typeof hasActiveChangishaPlan>[0];

beforeEach(() => query.mockReset());

it('is active when the group holds an active changisha subscription', async () => {
  query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
  await expect(hasActiveChangishaPlan(db, 'grp-1')).resolves.toBe(true);
  expect(query.mock.calls[0][0]).toContain("product = 'changisha'");
  expect(query.mock.calls[0][1]).toEqual(['grp-1']);
});

it('refuses a group with no changisha plan, and says what it costs', async () => {
  query.mockResolvedValueOnce({ rows: [] });
  const err = await assertChangishaPlanActive(db, 'grp-1').catch((e) => e);
  expect(err).toBeInstanceOf(ChangishaPlanRequiredError);
  expect(err.statusCode ?? err.status).toBe(402);
  expect(err.message).toContain('KES 100');
});

it('prices Changi$ha plans from KES 100, matching Kumbusha', () => {
  expect(PLAN_MONTHLY_FEES.changisha).toEqual(PLAN_MONTHLY_FEES.chama_reminder);
  expect(PLAN_MONTHLY_FEES.changisha.starter).toBe(100);
});
