import { NextRequest } from 'next/server';
import { withPlatformRole } from '@/lib/auth/middleware';
import { ok, created } from '@/lib/utils/response';
import { smsPricingAdminService } from '@/lib/services/sms-pricing-admin.service';
import {
  TierCreateSchema, TierUpdateSchema, PackageCreateSchema, PackageUpdateSchema,
  ActivateTiersSchema, ProviderCostSchema,
} from '@/lib/validators/sms-pricing.schema';

export const dynamic = 'force-dynamic';

/**
 * SMS pricing configuration (spec §12). INTERNAL ONLY.
 *
 * super_admin alone: this sets what every customer pays and discloses what the
 * provider charges us, neither of which support staff need. Every mutation
 * writes an audit_logs row — §12 requires the changes be auditable, and a
 * price change with no record of who made it is exactly the kind you want
 * traceable.
 */
export function GET(req: NextRequest) {
  return withPlatformRole(req, 'super_admin', async () => {
    return ok(await smsPricingAdminService.getPricingConfig());
  });
}

export function POST(req: NextRequest) {
  return withPlatformRole(req, 'super_admin', async (ctx) => {
    const body = await req.json();
    switch (body?.kind) {
      case 'tier':
        return created(await smsPricingAdminService.createTier(ctx.userId, TierCreateSchema.parse(body)));
      case 'package':
        return created(await smsPricingAdminService.createPackage(ctx.userId, PackageCreateSchema.parse(body)));
      case 'provider_cost': {
        const input = ProviderCostSchema.parse(body);
        return created(await smsPricingAdminService.setProviderCost(ctx.userId, input.unitCost, input.notes));
      }
      case 'activate_tiers': {
        const input = ActivateTiersSchema.parse(body);
        return ok(await smsPricingAdminService.setActiveTiers(ctx.userId, input.tierIds));
      }
      default:
        // Zod would report a confusing per-branch error, so the discriminator
        // is checked first and named explicitly.
        return ok({ error: 'Unknown kind' }, 400);
    }
  });
}

export function PATCH(req: NextRequest) {
  return withPlatformRole(req, 'super_admin', async (ctx) => {
    const body = await req.json();
    const id   = new URL(req.url).searchParams.get('id');
    if (!id) return ok({ error: 'id is required' }, 400);

    if (body?.kind === 'package') {
      return ok(await smsPricingAdminService.updatePackage(ctx.userId, id, PackageUpdateSchema.parse(body)));
    }
    return ok(await smsPricingAdminService.updateTier(ctx.userId, id, TierUpdateSchema.parse(body)));
  });
}
