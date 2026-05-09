import { z } from 'zod';

export const ImportQuerySchema = z.object({
  type: z.enum(['contributions', 'members']),
});

// Expected CSV columns for bulk contribution import
export const ContributionCsvRowSchema = z.object({
  member_phone:       z.string().min(1),
  amount:             z.coerce.number().positive(),
  contribution_date:  z.string().date(),
  payment_method:     z.enum(['mpesa', 'cash', 'bank_transfer', 'cheque', 'standing_order']).optional(),
  mpesa_receipt:      z.string().max(50).optional(),
  notes:              z.string().max(500).optional(),
});

// Expected CSV columns for bulk member import
export const MemberCsvRowSchema = z.object({
  phone:       z.string().min(1),
  first_name:  z.string().min(1),
  last_name:   z.string().min(1),
  email:       z.string().email().optional(),
  national_id: z.string().optional(),
  role:        z.enum(['group_admin','treasurer','secretary','member']).default('member'),
  joined_at:   z.string().date().optional(),
});

export type ImportQueryInput       = z.infer<typeof ImportQuerySchema>;
export type ContributionCsvRow     = z.infer<typeof ContributionCsvRowSchema>;
export type MemberCsvRow           = z.infer<typeof MemberCsvRowSchema>;
