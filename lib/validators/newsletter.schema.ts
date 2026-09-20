import { z } from 'zod';

export const NewsletterSubscribeSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  name: z.string().trim().min(1).max(200).optional(),
  source: z.string().trim().min(1).max(50).optional(),
});
export type NewsletterSubscribeInput = z.infer<typeof NewsletterSubscribeSchema>;

export const NewsletterUnsubscribeSchema = z.object({
  token: z.string().uuid('Invalid unsubscribe link'),
});
export type NewsletterUnsubscribeInput = z.infer<typeof NewsletterUnsubscribeSchema>;
