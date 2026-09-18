'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';

interface ProgramProgressCardProps {
  program: {
    id: string;
    name: string;
    status: string;
    target_amount?: number;
    current_amount: number;
    impact_metric_name?: string;
    impact_metric_target?: number;
    impact_metric_current?: number;
  };
  showCta?: boolean;
  onDonate?: () => void;
}

export function ProgramProgressCard({
  program,
  showCta = true,
  onDonate,
}: ProgramProgressCardProps) {
  const fundingProgress = program.target_amount
    ? Math.min(100, Math.round((program.current_amount / program.target_amount) * 100))
    : 0;

  const impactProgress = program.impact_metric_target
    ? Math.min(100, Math.round((program.impact_metric_current || 0) / program.impact_metric_target) * 100)
    : 0;

  const statusColors = {
    draft: 'secondary',
    active: 'default',
    paused: 'outline',
    completed: 'outline',
    archived: 'secondary',
  } as const;

  return (
    <Card className="hover:shadow-lg transition">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="text-lg">{program.name}</CardTitle>
          </div>
          <Badge variant={statusColors[program.status as keyof typeof statusColors]}>
            {program.status}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Funding Progress */}
        {program.target_amount && (
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">Funding</span>
              <span className="text-lg font-bold text-green-600">
                KES {program.current_amount.toLocaleString()}
              </span>
            </div>
            <Progress value={fundingProgress} className="h-2 mb-1" />
            <div className="flex justify-between text-xs text-gray-500">
              <span>{fundingProgress}% funded</span>
              <span>KES {program.target_amount.toLocaleString()} target</span>
            </div>
          </div>
        )}

        {/* Impact Progress */}
        {program.impact_metric_name && program.impact_metric_target && (
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">{program.impact_metric_name}</span>
              <span className="text-lg font-bold text-blue-600">
                {program.impact_metric_current || 0} / {program.impact_metric_target}
              </span>
            </div>
            <Progress value={impactProgress} className="h-2 mb-1" />
            <div className="flex justify-between text-xs text-gray-500">
              <span>{impactProgress}% complete</span>
            </div>
          </div>
        )}

        {/* CTA Button */}
        {showCta && program.status === 'active' && (
          <button
            onClick={onDonate}
            className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-medium py-2 px-4 rounded-lg transition"
          >
            Support This Program
          </button>
        )}
      </CardContent>
    </Card>
  );
}
