import { z } from 'zod';

const httpsUrl = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash;
  });
const client = z.object({
  organizationId: z.string().uuid(),
  issuer: httpsUrl,
  audience: z.string().min(1),
  jwksUrl: httpsUrl,
  clientId: z.string().min(1).max(200),
  subject: z.string().min(1).max(200),
  scopes: z.array(z.enum(['billing.read', 'products.read'])).min(1),
  products: z.array(z.enum(['kitabu_yetu', 'chama_reminder', 'changisha'])).default([]),
});
const schema = z
  .object({
    clients: z.array(client).max(100).default([]),
    webhooks: z
      .array(
        z.object({
          organizationId: z.string().uuid(),
          endpointId: z.string().uuid(),
          url: httpsUrl,
          secret: z.string().regex(/^[a-f0-9]{64}$/i),
        }),
      )
      .max(100)
      .default([]),
  })
  .superRefine(({ clients, webhooks }, ctx) => {
    const keys = clients.map((entry) => JSON.stringify([entry.issuer, entry.audience, entry.clientId]));
    if (
      new Set(keys).size !== keys.length ||
      new Set(webhooks.map((hook) => hook.endpointId)).size !== webhooks.length
    ) {
      ctx.addIssue({ code: 'custom', message: 'Integration identifiers must be unique.' });
    }
  });

let cached: z.output<typeof schema> | undefined;

export function getEnterpriseIntegrations() {
  if (cached) return cached;
  if (!process.env.ENTERPRISE_INTEGRATIONS) return { clients: [], webhooks: [] };
  try {
    cached = schema.parse(JSON.parse(process.env.ENTERPRISE_INTEGRATIONS));
    return cached;
  } catch {
    throw new Error('Invalid Enterprise integration configuration.');
  }
}

export type EnterpriseIntegrationClient = z.output<typeof client>;
export type EnterpriseScope = EnterpriseIntegrationClient['scopes'][number];
