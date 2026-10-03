import { z } from 'zod';
import { isValidKenyanPhone } from '@/lib/utils/phone';

export const CreateCampaignSchema = z
  .object({
    title: z.string().min(3).max(120),
    story: z.string().min(20).max(10_000),
    targetAmount: z.number().positive().max(50_000_000),
    beneficiaryName: z.string().max(120).optional(),
    // beneficiary_name is published on the campaign's public, indexed page -
    // naming a real person needs an explicit confirmation they agreed to
    // that, not a silent default. Required only when a name is actually set.
    beneficiaryConsentConfirmed: z.boolean().optional(),
    /** Where a withdrawal pays out to - required before submitForReview, not
     *  at creation (a draft campaign legitimately has none yet). */
    payoutPhone: z.string().refine(isValidKenyanPhone, 'Invalid Kenyan phone number').optional(),
    coverImageUrl: z.string().url().optional(),
    endsAt: z.string().datetime().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.beneficiaryName?.trim() && !data.beneficiaryConsentConfirmed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['beneficiaryConsentConfirmed'],
        message: 'Confirm the beneficiary has agreed to be named publicly before adding a beneficiary name',
      });
    }
  });

const SHORTCODE_RE = /^\d{5,7}$/;
// Paybill account numbers are institution-issued (patient/admission/invoice
// numbers), so allow the separators they use - but never truncate: a cut-off
// account reference credits the payment to the wrong account at the business.
const PAYBILL_ACCOUNT_RE = /^[A-Za-z0-9 ._/#-]+$/;
const payeeName = z.string().trim().min(2, 'Enter the business name').max(120);

/** Setting/changing the payout destination - kept separate from
 *  CreateCampaignSchema so the campaigns.service.ts guard that locks it once
 *  a campaign leaves 'draft' has one clear call site to gate. Mirrors
 *  lib/campaigns/payout-destination.ts's PayoutDestination and the CHECKs in
 *  migration 202. */
export const SetPayoutDestinationSchema = z.discriminatedUnion('method', [
  z.object({
    method: z.literal('phone'),
    phone: z.string().refine(isValidKenyanPhone, 'Invalid Kenyan phone number'),
  }),
  z.object({
    method: z.literal('paybill'),
    shortcode: z.string().trim().regex(SHORTCODE_RE, 'A paybill number is 5-7 digits'),
    account: z
      .string()
      .trim()
      .min(1, 'Enter the account number')
      .max(20, 'The account number can be at most 20 characters')
      .regex(PAYBILL_ACCOUNT_RE, 'Use letters, numbers, spaces and . _ / # - only'),
    payeeName,
  }),
  z.object({
    method: z.literal('till'),
    shortcode: z.string().trim().regex(SHORTCODE_RE, 'A till number is 5-7 digits'),
    payeeName,
  }),
]);

export const RejectCampaignSchema = z.object({
  reason: z.string().min(3).max(500),
});

/** Server-side cap regardless of what the client sends - see
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

/**
 * Public, self-serve campaign creation - register_campaign() creates a new
 * group (the caller becomes its sole chairperson) and the campaign together,
 * already submitted for review. Combines CreateCampaignSchema's campaign
 * fields with the creator's own identity (mirrors RegisterOrganizationSchema)
 * and requires the payout destination up front (SetPayoutDestinationSchema is
 * optional-at-creation in the authenticated flow; a one-shot public form has
 * no later step to set it in).
 */
export const RegisterCampaignSchema = z
  .object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    phone: z.string().refine(isValidKenyanPhone, 'Invalid Kenyan phone number'),
    password: z.string().min(8).max(100),
    title: z.string().min(3).max(120),
    story: z.string().min(20).max(10_000),
    targetAmount: z.number().positive().max(50_000_000),
    beneficiaryName: z.string().max(120).optional(),
    beneficiaryConsentConfirmed: z.boolean().optional(),
    coverImageUrl: z.string().url().optional(),
    endsAt: z.string().datetime().optional(),
    payout: SetPayoutDestinationSchema,
  })
  .superRefine((data, ctx) => {
    if (data.beneficiaryName?.trim() && !data.beneficiaryConsentConfirmed) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['beneficiaryConsentConfirmed'],
        message: 'Confirm the beneficiary has agreed to be named publicly before adding a beneficiary name',
      });
    }
  });

export type RegisterCampaignInput = z.infer<typeof RegisterCampaignSchema>;
