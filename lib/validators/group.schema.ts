import { z } from 'zod';

// groups.is_government_registered / registration_number — see
// group-registration.service.ts. Deliberately permissive: a group can flag
// itself registered without a number yet (cert upload is a separate
// multipart endpoint), and can flip the flag off at any time.
export const SetGroupRegistrationSchema = z.object({
  isGovernmentRegistered: z.boolean(),
  registrationNumber: z.string().max(100).optional().nullable(),
});

export type SetGroupRegistrationInput = z.infer<typeof SetGroupRegistrationSchema>;
export type SetGroupRegistrationPayload = z.input<typeof SetGroupRegistrationSchema>;
