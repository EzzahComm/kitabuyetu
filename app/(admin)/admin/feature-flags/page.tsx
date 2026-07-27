'use client';

import { Info, Users, Layers, User, Globe } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { PageHeader } from '@/components/shared/page-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useFeatureFlags, useToggleFeatureFlag } from '@/hooks/use-admin';
import { useToast } from '@/hooks/use-toast';
import { getErrorMessage } from '@/lib/utils';

interface FeatureFlagRow {
  id:          string;
  key:         string;
  description: string | null;
  enabled:     boolean;
  rollout_pct: number;
  applies_to:  'all' | 'plan' | 'group' | 'member';
  conditions:  Record<string, unknown>;
  created_at:  string;
  updated_at:  string;
  updated_by:  string | null;
}

const APPLIES_TO_ICON: Record<string, React.ElementType> = {
  all:         Globe,
  plan:        Layers,
  group:       Users,
  member:      User,
};

const APPLIES_TO_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  all:    'default',
  plan:   'secondary',
  group:  'outline',
  member: 'outline',
};

const FLAG_CATEGORY: Record<string, { label: string; color: string }> = {
  'new_dashboard':           { label: 'UI',       color: 'text-blue-600 bg-blue-50 border-blue-200' },
  'ai_loan_recommendations': { label: 'AI',        color: 'text-purple-600 bg-purple-50 border-purple-200' },
  'welfare_module':          { label: 'Core',      color: 'text-green-600 bg-green-50 border-green-200' },
  'investment_module':       { label: 'Core',      color: 'text-green-600 bg-green-50 border-green-200' },
  'meeting_management':      { label: 'Core',      color: 'text-green-600 bg-green-50 border-green-200' },
  'mpesa_automation':        { label: 'Payments',  color: 'text-amber-600 bg-amber-50 border-amber-200' },
  'bulk_sms':                { label: 'Comms',     color: 'text-teal-600 bg-teal-50 border-teal-200' },
  'advanced_analytics':      { label: 'Analytics', color: 'text-indigo-600 bg-indigo-50 border-indigo-200' },
  'multi_currency':          { label: 'Finance',   color: 'text-orange-600 bg-orange-50 border-orange-200' },
  'api_access':              { label: 'Dev',       color: 'text-gray-600 bg-gray-50 border-gray-200' },
  'white_label':             { label: 'Enterprise',color: 'text-rose-600 bg-rose-50 border-rose-200' },
};

export default function FeatureFlagsPage() {
  const { toast } = useToast();
  const { data: flags, isLoading } = useFeatureFlags();
  const toggle = useToggleFeatureFlag();

  const items: FeatureFlagRow[] = flags ?? [];
  const enabledCount  = items.filter((f) => f.enabled).length;

  const handleToggle = async (key: string, current: boolean) => {
    try {
      await toggle.mutateAsync({ key, enabled: !current });
      toast({ title: `Feature "${key}" ${!current ? 'enabled' : 'disabled'}` });
    } catch (e) {
      toast({ variant: 'destructive', title: 'Error', description: getErrorMessage(e) });
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Feature Flags"
        description="Control feature rollouts, experiments, and platform capabilities"
        actions={
          !isLoading && (
            <div className="flex items-center gap-3">
              <div className="text-right">
                <p className="text-sm font-semibold text-gray-900">{enabledCount}/{items.length}</p>
                <p className="text-xs text-gray-500">flags enabled</p>
              </div>
              <div className="w-16 h-2 rounded-full bg-gray-200 overflow-hidden">
                <div
                  className="h-full bg-indigo-500 rounded-full transition-all"
                  style={{ width: items.length ? `${(enabledCount / items.length) * 100}%` : '0%' }}
                />
              </div>
            </div>
          )
        }
      />

      {/* Info banner */}
      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="pt-3 pb-3">
          <div className="flex items-start gap-2 text-sm text-blue-800">
            <Info size={14} className="mt-0.5 shrink-0 text-blue-500" />
            <p>
              Feature flags take effect immediately across all active sessions.
              Disabling a core module will hide it from all users in affected groups.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Flags grid */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {isLoading
          ? [...Array(9)].map((_, i) => (
              <Card key={i}>
                <CardContent className="pt-4 pb-4 space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-3/4" />
                </CardContent>
              </Card>
            ))
          : items.map((flag) => {
              const cat     = FLAG_CATEGORY[flag.key];
              const Icon    = APPLIES_TO_ICON[flag.applies_to] ?? Globe;
              const loading = toggle.isPending && toggle.variables?.key === flag.key;

              return (
                <Card
                  key={flag.key}
                  className={`transition-shadow ${flag.enabled ? 'shadow-sm' : 'opacity-75'}`}
                >
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm font-semibold text-gray-900 truncate">
                            {flag.key}
                          </span>
                          {cat && (
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${cat.color}`}>
                              {cat.label}
                            </span>
                          )}
                        </div>

                        {flag.description && (
                          <p className="text-xs text-gray-500 mt-1 leading-relaxed line-clamp-2">
                            {flag.description}
                          </p>
                        )}

                        <div className="flex items-center gap-3 mt-2.5">
                          <div className="flex items-center gap-1.5 text-xs text-gray-500">
                            <Icon size={11} />
                            <span className="capitalize">{flag.applies_to ?? 'all'}</span>
                          </div>
                          {flag.rollout_pct !== null && flag.rollout_pct < 100 && (
                            <div className="flex items-center gap-1.5">
                              <div className="w-12 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-indigo-400 rounded-full"
                                  style={{ width: `${flag.rollout_pct}%` }}
                                />
                              </div>
                              <span className="text-[10px] text-gray-400">{flag.rollout_pct}%</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <Switch
                        checked={!!flag.enabled}
                        disabled={loading}
                        onCheckedChange={() => handleToggle(flag.key, flag.enabled)}
                        className="shrink-0 mt-0.5"
                      />
                    </div>

                    {flag.conditions && Object.keys(flag.conditions).length > 0 && (
                      <div className="mt-3 pt-2.5 border-t border-gray-100">
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">Conditions</p>
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(flag.conditions).map(([k, v]) => (
                            <span key={k} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 font-mono">
                              {k}: {String(v)}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
      </div>

      {!isLoading && items.length === 0 && (
        <div className="text-center py-16 text-sm text-muted-foreground">
          No feature flags configured
        </div>
      )}
    </div>
  );
}
