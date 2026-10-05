/**
 * Effective routing for an event: registry defaults overridden by
 * admin_notification_preferences rows (NULL column = keep default). Cached
 * briefly; a database failure falls back to the defaults so alerting never
 * depends on the preferences table being readable.
 */
import { withAdminDb } from '@/lib/db';
import { getEventDefinition, type EventDefinition } from './activity-events';

interface PrefRow {
  event_type: string;
  sms_enabled: boolean | null;
  email_enabled: boolean | null;
  aggregate: boolean | null;
}

const TTL_MS = 60_000;
let cache: { at: number; rows: Map<string, PrefRow> } | null = null;

async function loadPrefs(): Promise<Map<string, PrefRow>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  try {
    const { rows } = await withAdminDb((db) =>
      db.query<PrefRow>('SELECT event_type, sms_enabled, email_enabled, aggregate FROM admin_notification_preferences'),
    );
    cache = { at: Date.now(), rows: new Map(rows.map((r) => [r.event_type, r])) };
  } catch {
    cache = { at: Date.now(), rows: new Map() };
  }
  return cache.rows;
}

export async function resolveRouting(type: string): Promise<EventDefinition> {
  const def = getEventDefinition(type);
  const pref = (await loadPrefs()).get(type);
  if (!pref) return def;
  return {
    ...def,
    sms: pref.sms_enabled ?? def.sms,
    email: pref.email_enabled ?? def.email,
    aggregate: pref.aggregate ?? def.aggregate,
  };
}

export function resetPreferenceCache(): void {
  cache = null;
}
