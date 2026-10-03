/**
 * Shared helpers for the Platform Monitoring page.
 * All dashboard data is live — served by /api/admin/dashboard?widget=monitoring_dashboard
 * (see lib/services/admin.service.ts → getMonitoringDashboardData).
 */

export function relativeTime(at: number): string {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}
