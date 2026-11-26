import { withAdminDb } from '@/lib/db';
import { logger } from '@/lib/logger';
import { sendTemplatedEmail } from '@/lib/services/email.service';
import { processDueSchedules } from '@/lib/services/scheduler.service';

jest.mock('@/lib/db', () => ({ withAdminDb: jest.fn() }));
jest.mock('@/lib/logger', () => ({ logger: { error: jest.fn() } }));
jest.mock('@/lib/services/email.service', () => ({ sendTemplatedEmail: jest.fn() }));

it('keeps a one-time email due when the provider rejects delivery', async () => {
  jest.mocked(withAdminDb).mockResolvedValueOnce({
    rows: [
      {
        id: 'schedule-1',
        template_key: 'invoice',
        recipient_email: 'customer@example.com',
        variables: { invoiceNumber: 'INV-001' },
        schedule_type: 'once',
      },
    ],
  });
  jest.mocked(sendTemplatedEmail).mockResolvedValueOnce({
    success: false,
    provider: 'smtp',
    error: 'Temporary SMTP failure',
  });

  await expect(processDueSchedules()).resolves.toEqual({ processed: 0, failed: 1 });
  expect(withAdminDb).toHaveBeenCalledTimes(1);
  expect(logger.error).toHaveBeenCalled();
});
