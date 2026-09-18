export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { PageShell } from '@/components/marketing/page-shell';
import { ProgramProgressCard } from '@/components/ecosystem/program-progress-card';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Programs — Ecosystem',
  description: 'Browse active programs and support causes that matter to you.',
};

async function EcosystemProgramsPage() {
  const supabase = await createClient();
  const { data: programs } = await supabase
    .from('programs')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  const activePrograms = programs || [];

  return (
    <PageShell
      title="Support Programs"
      description="Browse active programs and support causes that matter to you."
    >
      {activePrograms.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-600 mb-4">No active programs yet.</p>
          <p className="text-sm text-gray-500">Check back soon for new opportunities to make an impact.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {activePrograms.map(program => (
            <Link key={program.id} href={`/ecosystem/programs/${program.slug}`}>
              <div className="cursor-pointer">
                <ProgramProgressCard program={program} showCta={true} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </PageShell>
  );
}

export default EcosystemProgramsPage;
