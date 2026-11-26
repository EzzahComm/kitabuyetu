import { withAdminDb } from '@/lib/db';
import { sendDigest } from '@/lib/services/newsletter-digest.service';

jest.mock('@/lib/db', () => ({ withAdminDb: jest.fn() }));
jest.mock('@/lib/email/templates/engine', () => ({ loadBranding: jest.fn(), wrapWithBranding: jest.fn() }));

it('does not queue subscribers if the saved draft changed after confirmation', async () => {
  const query = jest.fn().mockResolvedValue({
    rows: [{ subject: 'Updated subject', html_body: '<p>Saved newsletter</p>' }],
  });
  jest
    .mocked(withAdminDb)
    .mockImplementation((callback) => callback({ query } as unknown as Parameters<typeof callback>[0]));

  await expect(
    sendDigest('digest-id', 'admin-id', {
      subject: 'Previous subject',
      htmlBody: '<p>Saved newsletter</p>',
    }),
  ).rejects.toThrow('This draft changed');
  expect(query).toHaveBeenCalledTimes(1);
  expect(query).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE'), ['digest-id']);
});
