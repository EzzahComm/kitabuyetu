import { z } from 'zod';

export const UpdateNewsletterDigestSchema = z.object({
  subject: z.string().trim().min(3).max(200),
  htmlBody: z.string().trim().min(10).max(50_000),
});

export type UpdateNewsletterDigestInput = z.infer<typeof UpdateNewsletterDigestSchema>;
