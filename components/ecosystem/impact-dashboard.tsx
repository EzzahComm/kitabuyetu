'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Stat } from '@/components/ui/stat';
import { formatCurrency } from '@/lib/utils';

interface ImpactMetric {
  metric_name: string;
  metric_type: string;
  current_value: number;
  target_value?: number;
  unit_name?: string;
}

interface ImpactDashboardProps {
  organizationId: string;
}

export function ImpactDashboard({ organizationId }: ImpactDashboardProps) {
  const [impact, setImpact] = useState<{
    metrics: ImpactMetric[];
    totalDonated: number;
    totalDonors: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchImpact = async () => {
      try {
        const response = await fetch(`/api/v1/impact-metrics?orgId=${organizationId}`);
        if (response.ok) {
          const data = await response.json();
          setImpact(data);
        }
      } catch (error) {
        console.error('Failed to fetch impact:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchImpact();
  }, [organizationId]);

  if (loading) {
    return <div className="text-center py-8">Loading impact data...</div>;
  }

  if (!impact) {
    return <div className="text-center py-8 text-gray-500">No impact data available</div>;
  }

  return (
    <div className="space-y-6">
      {/* Key Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <Stat
              label="Total Donated"
              value={formatCurrency(impact.totalDonated, 'KES')}
              icon="💰"
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <Stat
              label="Supporters"
              value={impact.totalDonors.toString()}
              icon="👥"
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <Stat
              label="Impact Metrics"
              value={impact.metrics.length.toString()}
              icon="📊"
            />
          </CardContent>
        </Card>
      </div>

      {/* Detailed Metrics */}
      {impact.metrics.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Impact Metrics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {impact.metrics.map((metric, index) => {
                const progress = metric.target_value
                  ? Math.min(100, Math.round((metric.current_value / metric.target_value) * 100))
                  : 0;

                return (
                  <div key={index} className="border-b pb-4 last:border-b-0">
                    <div className="flex items-baseline justify-between mb-2">
                      <h4 className="font-medium text-gray-900">{metric.metric_name}</h4>
                      <span className="text-lg font-bold text-blue-600">
                        {metric.current_value} {metric.unit_name ? `${metric.unit_name}` : ''}
                      </span>
                    </div>

                    {metric.target_value && (
                      <>
                        <div className="w-full bg-gray-200 rounded-full h-2 mb-1">
                          <div
                            className="bg-gradient-to-r from-blue-500 to-purple-600 h-2 rounded-full transition"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                        <div className="flex justify-between text-xs text-gray-500">
                          <span>{progress}% of {metric.target_value} target</span>
                        </div>
                      </>
                    )}

                    {metric.metric_type && (
                      <p className="text-xs text-gray-500 mt-1">Type: {metric.metric_type}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
