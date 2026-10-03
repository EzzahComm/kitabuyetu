export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { PageShell } from '@/components/marketing/page-shell';
import { DonorLeaderboard } from '@/components/ecosystem/donor-leaderboard';
import { listPublicActiveOrganizations } from '@/lib/services/organization.service';
import { marketingMetadata } from '@/components/marketing/page-metadata';

export const metadata: Metadata = marketingMetadata({
  path: '/ecosystem/donors',
  title: 'Top Supporters — Ecosystem',
  description: 'Meet the community of supporters making an impact.',
});

async function EcosystemDonorsPage() {
  // Public, anonymous page — see listPublicActiveOrganizations's own header
  // for why this no longer reads via the Supabase anon-key client.
  const activeOrgs = await listPublicActiveOrganizations(10);

  return (
    <PageShell title="Our Supporters" description="Meet the community of supporters making a difference.">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {activeOrgs.length === 0 ? (
          <div className="text-center py-12 lg:col-span-2">
            <p className="text-gray-600 mb-4">No active organizations yet.</p>
            <p className="text-sm text-gray-500">Check back soon to see supporter leaderboards.</p>
          </div>
        ) : (
          activeOrgs.map((org) => (
            <div key={org.id}>
              <h2 className="text-xl font-bold text-gray-900 mb-4">{org.name}</h2>
              <DonorLeaderboard organizationId={org.id} limit={10} />
            </div>
          ))
        )}
      </div>
    </PageShell>
  );
}

export default EcosystemDonorsPage;
