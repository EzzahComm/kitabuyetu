/**
 * Shared types for the Risk & Fraud dashboard.
 * All dashboard data is live — served by /api/admin/dashboard?widget=risk_dashboard
 * (see lib/services/admin.service.ts → getRiskDashboardData).
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low';
