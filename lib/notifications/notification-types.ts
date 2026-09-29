/** Shared types for the platform activity + admin notification system. */

export type NotificationSeverity = 'INFO' | 'WARNING' | 'HIGH' | 'CRITICAL';
export const SEVERITY_RANK: Record<NotificationSeverity, number> = { INFO: 0, WARNING: 1, HIGH: 2, CRITICAL: 3 };

export type NotificationChannel = 'sms' | 'email';

export type DeliveryStatus = 'PENDING' | 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED' | 'RETRYING' | 'CANCELLED';

/** The standardized event. Extensible via `metadata`. */
export interface PlatformActivityEvent<T extends string = string> {
  id: string;
  type: T;
  severity: NotificationSeverity;
  title: string;
  description?: string;
  actor?: { userId?: string; name?: string; email?: string; phone?: string; role?: string };
  organization?: { id: string; name: string };
  group?: { id: string; name: string };
  transaction?: {
    id?: string;
    reference?: string;
    type?: string;
    amount?: number;
    currency?: string;
    status?: string;
  };
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
  occurredAt: string;
  notificationRequired: boolean;
  /** Human-readable id, e.g. ACT-20260929-000123 (set once persisted). */
  activityRef?: string;
}

/** What a caller passes to emitActivity(). */
export interface EmitActivityInput<T extends string = string> {
  type: T;
  /** Overrides the registry default (e.g. escalate a big transaction). */
  severity?: NotificationSeverity;
  description?: string;
  actor?: PlatformActivityEvent['actor'];
  organization?: PlatformActivityEvent['organization'];
  group?: PlatformActivityEvent['group'];
  transaction?: PlatformActivityEvent['transaction'];
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
  occurredAt?: string | Date;
  /**
   * Natural idempotency key, e.g. `withdrawal:<id>:requested` or an M-Pesa
   * receipt. A second emit with the same key does nothing.
   */
  dedupKey?: string;
  /** Force-skip notification (audit only). */
  notify?: boolean;
  /** Path (not URL) of the admin screen to review, e.g. /admin/campaigns. */
  adminPath?: string;
}

export interface EmitResult {
  recorded: boolean;
  duplicate: boolean;
  activityId?: string;
  activityRef?: string;
  queued: number;
}
