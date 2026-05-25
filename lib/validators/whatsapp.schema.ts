import { z } from 'zod';
import { isValidKenyanPhone } from '@/lib/utils/phone';

export const WHATSAPP_STATUSES = [
  'pending', 'sent', 'delivered', 'read', 'failed', 'dry_run',
] as const;

export const WHATSAPP_DIRECTIONS = ['outbound', 'inbound'] as const;

/**
 * Send-text body. Recipient can be specified as either a memberId (lookup
 * + phone resolution server-side) or a raw phone number (must be valid
 * Kenyan format). Refines that at least one is supplied.
 */
export const SendWhatsAppMessageSchema = z.object({
  memberId: z.string().uuid().optional(),
  toPhone:  z.string().optional(),
  body:     z.string().min(1).max(4096, 'Message exceeds 4096 char limit'),
})
  .refine(
    (v) => Boolean(v.memberId) || Boolean(v.toPhone),
    { path: ['memberId'], message: 'Provide either memberId or toPhone' },
  )
  .refine(
    (v) => !v.toPhone || isValidKenyanPhone(v.toPhone),
    { path: ['toPhone'], message: 'toPhone must be a valid Kenyan number' },
  );

export const WhatsAppQuerySchema = z.object({
  page:      z.coerce.number().int().min(1).default(1),
  limit:     z.coerce.number().int().min(1).max(200).default(50),
  status:    z.enum(WHATSAPP_STATUSES).optional(),
  direction: z.enum(WHATSAPP_DIRECTIONS).optional(),
  memberId:  z.string().uuid().optional(),
});

export type SendWhatsAppMessageInput = z.infer<typeof SendWhatsAppMessageSchema>;
export type WhatsAppQueryInput       = z.infer<typeof WhatsAppQuerySchema>;
export type WhatsAppMessageStatus    = (typeof WHATSAPP_STATUSES)[number];
