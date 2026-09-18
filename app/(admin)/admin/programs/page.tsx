export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { Container } from '@/components/Container';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Program Review — Admin',
  description: 'Review and approve pending programs.',
};

async function AdminProgramsPage() {
  const supabase = await createClient();

  // Fetch pending programs
  const { data: programs } = await supabase
    .from('programs')
    .select('*, organizations(name)')
    .eq('status', 'pending_review')
    .order('created_at', { ascending: true });

  const pendingPrograms = programs || [];

  return (
    <Container>
      <div className="py-12">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Program Review Queue</h1>
          <p className="text-gray-600">{pendingPrograms.length} program(s) pending approval</p>
        </div>

        {pendingPrograms.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-gray-500">
              No pending programs. All caught up!
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {pendingPrograms.map(program => (
              <Card key={program.id} className="hover:shadow-md transition">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-lg">{program.name}</CardTitle>
                      <p className="text-sm text-gray-500 mt-1">
                        {program.organizations?.name} · Created {new Date(program.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <Badge variant="secondary">Pending</Badge>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  {program.description && (
                    <div>
                      <h3 className="font-medium text-sm text-gray-700 mb-1">Description</h3>
                      <p className="text-sm text-gray-600">{program.description}</p>
                    </div>
                  )}

                  {program.target_amount && (
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-gray-500">Target Amount</p>
                        <p className="font-medium text-gray-900">
                          KES {program.target_amount.toLocaleString()}
                        </p>
                      </div>
                      {program.impact_metric_name && (
                        <div>
                          <p className="text-gray-500">Impact Metric</p>
                          <p className="font-medium text-gray-900">
                            {program.impact_metric_name} (target: {program.impact_metric_target})
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2 pt-2">
                    <button
                      formAction={async () => {
                        'use server';
                        await fetch(`/api/admin/programs/${program.id}/approve`, { method: 'POST' });
                      }}
                      className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded font-medium transition"
                    >
                      Approve
                    </button>
                    <button
                      formAction={async () => {
                        'use server';
                        const reason = prompt('Rejection reason:');
                        if (reason) {
                          await fetch(`/api/admin/programs/${program.id}/reject`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ reason }),
                          });
                        }
                      }}
                      className="flex-1 px-4 py-2 border border-gray-300 hover:bg-gray-50 rounded font-medium transition"
                    >
                      Reject
                    </button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </Container>
  );
}

export default AdminProgramsPage;
