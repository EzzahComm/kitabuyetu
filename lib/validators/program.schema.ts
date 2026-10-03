import { z } from 'zod';

// Group-side payloads for the Programs feature (migration 206) - applying to
// or responding to an org-run program. See organization.schema.ts's "Group
// Programs" section for the org-side (create/publish/invite/review) schemas.

export const SubmitProgramApplicationSchema = z.object({
  applicationData: z.record(z.unknown()).optional(),
});

export type SubmitProgramApplicationInput = z.infer<typeof SubmitProgramApplicationSchema>;
