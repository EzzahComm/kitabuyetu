import { z } from 'zod';

/**
 * One split rule on the `group_contribution_splits` table. Exactly one of
 * `percentage` / `fixedAmount` must be set — the DB CHECK enforces it too,
 * but Zod gives a friendlier error before we hit the wire.
 */
const baseRuleShape = z.object({
  accountCode: z.string().min(1).max(10),
  percentage:  z.number().positive().max(100).optional().nullable(),
  fixedAmount: z.number().positive().optional().nullable(),
  priority:    z.number().int().min(0).max(1000).default(100),
});

const exclusiveAmountCheck = (
  val: { percentage?: number | null; fixedAmount?: number | null },
  ctx: z.RefinementCtx,
): void => {
  const hasPct   = val.percentage   != null;
  const hasFixed = val.fixedAmount != null;
  if (hasPct === hasFixed) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Exactly one of percentage or fixedAmount must be set',
      path: ['percentage'],
    });
  }
};

export const CreateContributionSplitSchema = baseRuleShape.superRefine(exclusiveAmountCheck);

export const UpdateContributionSplitSchema = z.object({
  accountCode: z.string().min(1).max(10).optional(),
  percentage:  z.number().positive().max(100).nullable().optional(),
  fixedAmount: z.number().positive().nullable().optional(),
  priority:    z.number().int().min(0).max(1000).optional(),
  isActive:    z.boolean().optional(),
});

/**
 * Replace the entire rule set for a group atomically. Used by the
 * "Save all" treasurer UI. Validates that the rule set is internally
 * consistent (no duplicate account codes; percentages sum to <= 100).
 */
export const ReplaceContributionSplitsSchema = z.object({
  rules: z.array(baseRuleShape.superRefine(exclusiveAmountCheck)).max(20),
}).superRefine((data, ctx) => {
  const seen = new Set<string>();
  let totalPct = 0;
  for (const r of data.rules) {
    if (seen.has(r.accountCode)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate account code ${r.accountCode}`,
        path: ['rules'],
      });
    }
    seen.add(r.accountCode);
    if (r.percentage != null) totalPct += r.percentage;
  }
  if (totalPct > 100.01) { // 0.01 fuzz for float accumulation
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Percentages sum to ${totalPct.toFixed(2)}; must be <= 100`,
      path: ['rules'],
    });
  }
});

export type CreateContributionSplitInput  = z.infer<typeof CreateContributionSplitSchema>;
export type UpdateContributionSplitInput  = z.infer<typeof UpdateContributionSplitSchema>;
export type ReplaceContributionSplitsInput = z.infer<typeof ReplaceContributionSplitsSchema>;
