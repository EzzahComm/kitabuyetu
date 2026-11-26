import { z } from 'zod/v3';
import { authenticateEnterpriseClient } from '@/lib/enterprise-integration/auth';
import { readEnterpriseGroupProducts } from '@/lib/enterprise-integration/reads';
import { enterpriseResponse } from '@/lib/enterprise-integration/response';

export function GET(request: Request, context: { params: Promise<{ groupId: string }> }): Promise<Response> {
  return enterpriseResponse(async () => {
    const client = await authenticateEnterpriseClient(request, 'products.read');
    return readEnterpriseGroupProducts(
      client,
      z
        .string()
        .uuid()
        .parse((await context.params).groupId),
    );
  });
}
