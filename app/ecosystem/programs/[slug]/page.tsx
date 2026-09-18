import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageShell } from '@/components/marketing/page-shell';
import { ProgramProgressCard } from '@/components/ecosystem/program-progress-card';
import { DonorLeaderboard } from '@/components/ecosystem/donor-leaderboard';
import { db } from '@/lib/db';

interface ProgramDetailPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: ProgramDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  const program = await db.from('programs').select('*').eq('slug', slug).single();

  if (program.error || !program.data) {
    return { title: 'Program not found' };
  }

  return {
    title: `${program.data.name} — Support`,
    description: program.data.description || 'Support this program and make an impact.',
  };
}

async function ProgramDetailPage({ params }: ProgramDetailPageProps) {
  const { slug } = await params;

  const program = await db
    .from('programs')
    .select('*')
    .eq('slug', slug)
    .eq('status', 'active')
    .single();

  if (program.error || !program.data) {
    notFound();
  }

  return (
    <PageShell title={program.data.name} description={program.data.description || ''}>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          {program.data.description && (
            <div className="prose prose-sm max-w-none mb-8">
              <p>{program.data.description}</p>
            </div>
          )}

          <div className="mt-8">
            <h2 className="text-2xl font-bold mb-4">Impact</h2>
            {program.data.impact_metric_name ? (
              <div className="bg-blue-50 rounded-lg p-6">
                <p className="text-sm text-gray-600 mb-2">{program.data.impact_metric_name}</p>
                <p className="text-3xl font-bold text-blue-600">
                  {program.data.impact_metric_current || 0} / {program.data.impact_metric_target}
                </p>
                <div className="w-full bg-gray-200 rounded-full h-2 mt-4">
                  <div
                    className="bg-blue-600 h-2 rounded-full"
                    style={{
                      width: `${Math.min(100, ((program.data.impact_metric_current || 0) / (program.data.impact_metric_target || 1)) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            ) : (
              <p className="text-gray-600">Impact metrics coming soon.</p>
            )}
          </div>
        </div>

        <div className="lg:col-span-1">
          <div className="sticky top-4 space-y-6">
            <ProgramProgressCard program={program.data} showCta={true} />
            <DonorLeaderboard organizationId={program.data.organization_id} limit={5} />
          </div>
        </div>
      </div>
    </PageShell>
  );
}

export default ProgramDetailPage;
