import { z } from 'zod';

export const ComposeNewsletterDigestSchema = z.object({
  templateKey: z.enum(['feature_highlight', 'changisha_spotlight', 'pricing_nudge']),
});

export type ComposeNewsletterDigestInput = z.infer<typeof ComposeNewsletterDigestSchema>;

export const UpdateNewsletterDigestSchema = z.object({
  subject: z.string().trim().min(3).max(200),
  htmlBody: z.string().trim().min(10).max(50_000),
});

export type UpdateNewsletterDigestInput = z.infer<typeof UpdateNewsletterDigestSchema>;
