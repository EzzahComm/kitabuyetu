import { Metadata } from 'next';
import { withAuth } from '@/lib/auth/middleware';
import { Container } from '@/components/Container';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import Link from 'next/link';
import { ProgramForm } from '@/components/ecosystem/program-form';
import { ProgramProgressCard } from '@/components/ecosystem/program-progress-card';
import * as ecosystemService from '@/lib/services/ecosystem.service';

export const metadata: Metadata = {
  title: 'Programs — Kitabu Yetu',
  description: 'Manage and track your organization programs.',
};

async function ProgramsPage({ searchParams }: { searchParams: { tab?: string } }) {
  const ctx = await withAuth(async (req, ctx) => ctx)(new Request(''), {} as any);
  const tab = searchParams.tab || 'active';

  // Fetch programs
  const programsResult = await ecosystemService.listProgramsByOrg(ctx, {
    status: tab === 'all' ? undefined : tab,
  });

  const programs = programsResult.data || [];

  return (
    <Container>
      <div className="py-12">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Programs</h1>
          <p className="text-gray-600">Create and manage your organization's programs.</p>
        </div>

        <Tabs value={tab} className="w-full">
          <TabsList>
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="draft">Draft</TabsTrigger>
            <TabsTrigger value="completed">Completed</TabsTrigger>
            <TabsTrigger value="all">All</TabsTrigger>
          </TabsList>

          <TabsContent value={tab} className="space-y-8">
            {/* Programs Grid */}
            {programs.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {programs.map(program => (
                  <div key={program.id}>
                    <ProgramProgressCard
                      program={program}
                      showCta={false}
                    />
                    <Link
                      href={`/programs/${program.id}`}
                      className="block mt-2 text-sm text-blue-600 hover:text-blue-700 font-medium"
                    >
                      View Details →
                    </Link>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 bg-gray-50 rounded-lg">
                <p className="text-gray-600 mb-4">No programs yet.</p>
                <Button asChild>
                  <Link href="#create">Create your first program</Link>
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Create Program Section */}
        <div id="create" className="mt-16 border-t pt-12">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Create New Program</h2>
          <div className="max-w-2xl">
            <ProgramForm organizationId={ctx.organization_id} />
          </div>
        </div>
      </div>
    </Container>
  );
}

export default ProgramsPage;
