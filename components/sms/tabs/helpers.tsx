import { StatusPill } from '@/components/shared/status-pill';
import { Send, BarChart2, LayoutTemplate, Clock, MessageSquare, AlertTriangle, History, BellOff } from 'lucide-react';

export function StatusBadge({ status }: { status: string }) {
  return <StatusPill status={status} size="sm" />;
}

export function CategoryBadge({ category }: { category: string }) {
  const cls: Record<string, string> = {
    transaction: 'bg-blue-50 text-blue-700',
    loan: 'bg-amber-50 text-amber-700',
    reminder: 'bg-orange-50 text-orange-700',
    birthday: 'bg-pink-50 text-pink-700',
    onboarding: 'bg-teal-50 text-teal-700',
    auth: 'bg-violet-50 text-violet-700',
    announcement: 'bg-indigo-50 text-indigo-700',
    custom: 'bg-muted/50 text-muted-foreground',
  };
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs ${cls[category] ?? 'bg-muted/50 text-muted-foreground'}`}
    >
      {category}
    </span>
  );
}

export const TABS = [
  { key: 'compose', label: 'Compose', icon: Send },
  { key: 'campaigns', label: 'Campaigns', icon: BarChart2 },
  { key: 'templates', label: 'Templates', icon: LayoutTemplate },
  { key: 'schedules', label: 'Schedules', icon: Clock },
  { key: 'logs', label: 'SMS Logs', icon: MessageSquare },
  { key: 'failures', label: 'Failed', icon: AlertTriangle },
  { key: 'history', label: 'Automations', icon: History },
  { key: 'optouts', label: 'Opt-outs', icon: BellOff },
] as const;

export type TabKey = (typeof TABS)[number]['key'];
