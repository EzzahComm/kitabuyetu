import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/page-header';

export default function EnterpriseIntegrationPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="API & Webhooks" description="Connect your organization’s website or backend to Kitabu Yetu." />
      <Card>
        <CardHeader>
          <CardTitle>Managed integration pilot</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p>
            Request a scoped pilot connection for plan reporting, linked-group product access and subscription updates.
          </p>
          <dl className="space-y-3">
            <div>
              <dt className="font-medium">Enterprise plan</dt>
              <dd>
                <code>GET /api/partner/v1/plan</code>
              </dd>
            </div>
            <div>
              <dt className="font-medium">Approved group products</dt>
              <dd>
                <code>GET /api/partner/v1/groups/&#123;groupId&#125;/products</code>
              </dd>
            </div>
            <div>
              <dt className="font-medium">Signed billing event</dt>
              <dd>
                <code>subscription.updated</code>
              </dd>
            </div>
          </dl>
          <Link className="font-medium underline underline-offset-4" href="/contact">
            Request integration setup
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
