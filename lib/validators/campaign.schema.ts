import { z } from 'zod';
import { isValidKenyanPhone } from '@/lib/utils/phone';

export const CreateCampaignSchema = z.object({
  title: z.string().min(3).max(120),
  story: z.string().min(20).max(10_000),
  targetAmount: z.number().positive().max(50_000_000),
  beneficiaryName: z.string().max(120).optional(),
  /** Where a withdrawal pays out to — required before submitForReview, not
   *  at creation (a draft campaign legitimately has none yet). */
  payoutPhone: z.string().refine(isValidKenyanPhone, 'Invalid Kenyan phone number').optional(),
  coverImageUrl: z.string().url().optional(),
  endsAt: z.string().datetime().optional(),
});

/** Setting/changing the payout destination — kept separate from
 *  CreateCampaignSchema so the campaigns.service.ts guard that locks this
 *  field once a campaign leaves 'draft' has one clear call site to gate. */
export const SetPayoutPhoneSchema = z.object({
  payoutPhone: z.string().refine(isValidKenyanPhone, 'Invalid Kenyan phone number'),
});

export const RejectCampaignSchema = z.object({
  reason: z.string().min(3).max(500),
});

/** Server-side cap regardless of what the client sends — see
 *  app/api/v1/campaigns/[id]/donate/route.ts's own note on why a public,
 *  unauthenticated endpoint that can trigger a real STK push needs one. */
export const MAX_DONATION_AMOUNT = 250_000;

export const DonateSchema = z.object({
  phone: z.string().refine(isValidKenyanPhone, 'Invalid Kenyan phone number'),
  amount: z.number().positive().max(MAX_DONATION_AMOUNT),
  donorName: z.string().max(120).optional(),
  message: z.string().max(500).optional(),
  isAnonymous: z.boolean().optional(),
});
