import { authenticateEnterpriseClient } from '@/lib/enterprise-integration/auth';
import { readEnterprisePlan } from '@/lib/enterprise-integration/reads';
import { enterpriseResponse } from '@/lib/enterprise-integration/response';

export function GET(request: Request): Promise<Response> {
  return enterpriseResponse(async () =>
    readEnterprisePlan(await authenticateEnterpriseClient(request, 'billing.read')),
  );
}
