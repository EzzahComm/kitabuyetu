import { z } from 'zod';

const copy = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((value) => !/[<>]/.test(value), 'Use plain text.');
const title = copy(150).refine((value) => value.length > 0, 'Enter a title.');
const selection = z
  .array(z.string().uuid())
  .max(24)
  .refine((ids) => new Set(ids).size === ids.length, 'Duplicate selection.');
export const siteSlug = z
  .string()
  .min(2)
  .max(70)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
export const siteFields = z
  .object({
    name: title,
    headline: title,
    accent: z
      .string()
      .regex(/^#[\da-f]{6}$/i)
      .default('#194837'),
    introduction: copy(800),
    about: copy(3000),
    contactEmail: z.union([z.literal(''), z.string().email().max(254)]),
    memberAccess: z.boolean(),
    acceptEnquiries: z.boolean().default(false),
    // Editorial descriptions are approved website copy, independent of private operational programme notes.
    stories: z.array(z.object({ title, description: copy(1000).refine((v) => v.length > 0) }).strict()).max(20),
  })
  .strict();
export const draftSchema = siteFields
  .extend({
    logoId: z.string().uuid().nullable().default(null),
    coverId: z.string().uuid().nullable().default(null),
    programIds: selection,
    campaignIds: selection,
  })
  .strict();
export type WebsiteDraft = z.infer<typeof draftSchema>;
const program = z
  .object({
    name: title,
    slug: z
      .string()
      .min(1)
      .max(240)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  })
  .strict();
const campaign = z
  .object({
    title,
    slug: z
      .string()
      .max(200)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  })
  .strict();
const picture = z
  .object({
    alt: copy(180),
    src: z
      .string()
      .max(240024)
      .regex(/^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/),
  })
  .strict()
  .nullable()
  .default(null);
export const snapshotSchema = siteFields
  .extend({
    logo: picture,
    cover: picture,
    programs: z.array(program).max(24),
    campaigns: z.array(campaign).max(24),
  })
  .strict();
export type WebsiteSnapshot = z.infer<typeof snapshotSchema>;
export function initialDraft(name: string): WebsiteDraft {
  return draftSchema.parse({
    name,
    headline: name,
    introduction: '',
    about: '',
    contactEmail: '',
    memberAccess: false,
    stories: [],
    programIds: [],
    campaignIds: [],
  });
}
export const websiteCommand = z.discriminatedUnion('action', [
  z
    .object({ action: z.literal('save'), slug: siteSlug, revision: z.number().int().positive(), draft: draftSchema })
    .strict(),
  z
    .object({
      action: z.literal('publish'),
      slug: siteSlug,
      revision: z.number().int().positive(),
      digest: z.string().regex(/^[0-9a-f]{64}$/),
    })
    .strict(),
  z.object({ action: z.literal('unpublish'), slug: siteSlug, revision: z.number().int().positive() }).strict(),
]);
export type WebsiteCommand = z.infer<typeof websiteCommand>;
