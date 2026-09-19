/**
 * CRM service layer — external relationship records (Phase 9.1).
 *
 * Distinct from lib/services/ecosystem.service.ts (the platform marketplace)
 * and lib/services/campaigns.service.ts (Changi$ha fundraising). A
 * crm_contacts row is a tenant's own relationship record — donor, lender,
 * insurer, trainer, professional, partner rep, lead — never the platform's.
 */

import { PoolClient } from 'pg';
import { withDb, type TenantContext } from '@/lib/db';
import { NotFoundError, ValidationError } from '@/lib/utils/errors';

export type ContactType =
  | 'donor' | 'lender' | 'insurer' | 'trainer' | 'service_provider'
  | 'professional' | 'partner_rep' | 'lead' | 'media' | 'government' | 'other';

export interface Contact {
  id: string;
  group_id?: string;
  organization_id?: string;
  contact_type: ContactType;
  name: string;
  email?: string;
  phone?: string;
  notes?: string;
  donor_id?: string;
  ecosystem_partner_id?: string;
  marketing_opt_in: boolean;
  opted_in_at?: Date;
  opted_in_by?: string;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export type OpportunityStage = 'draft' | 'qualified' | 'proposal' | 'won' | 'lost';

export interface Opportunity {
  id: string;
  contact_id: string;
  title: string;
  stage: OpportunityStage;
  amount?: number;
  notes?: string;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export type ActivityType = 'call' | 'email' | 'sms' | 'meeting' | 'note' | 'task';

export interface Activity {
  id: string;
  contact_id?: string;
  opportunity_id?: string;
  activity_type: ActivityType;
  body?: string;
  actor_id: string;
  occurred_at: Date;
  created_at: Date;
}

// ============================================================================
// CONTACTS
// ============================================================================

export async function createContact(
  ctx: TenantContext,
  data: {
    contact_type: ContactType;
    name: string;
    email?: string;
    phone?: string;
    notes?: string;
    donor_id?: string;
    ecosystem_partner_id?: string;
    marketing_opt_in?: boolean;
  },
): Promise<Contact> {
  if (!data.name.trim()) throw new ValidationError('Contact name is required');

  return withDb(ctx, async (db) => {
    const optIn = data.marketing_opt_in === true;

    const result = await db.query<Contact>(
      `INSERT INTO crm_contacts
        (group_id, organization_id, contact_type, name, email, phone, notes,
         donor_id, ecosystem_partner_id, marketing_opt_in, opted_in_at, opted_in_by, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        ctx.groupId || null,
        ctx.groupId ? null : ctx.organizationId,
        data.contact_type,
        data.name,
        data.email,
        data.phone,
        data.notes,
        data.donor_id,
        data.ecosystem_partner_id,
        optIn,
        optIn ? new Date() : null,
        optIn ? ctx.userId : null,
        ctx.userId,
      ],
    );

    if (!result.rows.length) throw new Error('Failed to create contact');

    await logActivity(ctx, db, {
      contact_id: result.rows[0].id,
      activity_type: 'note',
      body: `Contact created${optIn ? ' (opted in to marketing at creation)' : ''}`,
    });

    return result.rows[0];
  });
}

export async function listContacts(
  ctx: TenantContext,
  filters?: { contact_type?: ContactType; marketing_opt_in?: boolean },
): Promise<Contact[]> {
  return withDb(ctx, async (db) => {
    let query = `SELECT * FROM crm_contacts WHERE 1=1`;
    const params: any[] = [];

    if (filters?.contact_type) {
      params.push(filters.contact_type);
      query += ` AND contact_type = $${params.length}`;
    }
    if (filters?.marketing_opt_in !== undefined) {
      params.push(filters.marketing_opt_in);
      query += ` AND marketing_opt_in = $${params.length}`;
    }

    query += ` ORDER BY name`;

    const result = await db.query<Contact>(query, params);
    return result.rows;
  });
}

export async function getContactById(ctx: TenantContext, contactId: string): Promise<Contact | null> {
  return withDb(ctx, async (db) => {
    const result = await db.query<Contact>(`SELECT * FROM crm_contacts WHERE id = $1`, [contactId]);
    return result.rows.length ? result.rows[0] : null;
  });
}

export async function updateContact(
  ctx: TenantContext,
  contactId: string,
  updates: Partial<Pick<Contact, 'name' | 'email' | 'phone' | 'notes' | 'contact_type'>>,
): Promise<Contact> {
  const keys = Object.keys(updates);
  if (!keys.length) throw new ValidationError('No fields to update');

  return withDb(ctx, async (db) => {
    const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const values = keys.map((k) => (updates as any)[k]);

    const result = await db.query<Contact>(
      `UPDATE crm_contacts SET ${setClause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [contactId, ...values],
    );

    if (!result.rows.length) throw new NotFoundError('Contact not found');
    return result.rows[0];
  });
}

/** Explicit opt-in — the only way marketing_opt_in becomes true (consent-first). */
export async function recordOptIn(ctx: TenantContext, contactId: string): Promise<Contact> {
  return withDb(ctx, async (db) => {
    const result = await db.query<Contact>(
      `UPDATE crm_contacts
       SET marketing_opt_in = true, opted_in_at = NOW(), opted_in_by = $2, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [contactId, ctx.userId],
    );

    if (!result.rows.length) throw new NotFoundError('Contact not found');

    await logActivity(ctx, db, { contact_id: contactId, activity_type: 'note', body: 'Opted in to marketing' });

    return result.rows[0];
  });
}

export async function recordOptOut(ctx: TenantContext, contactId: string): Promise<Contact> {
  return withDb(ctx, async (db) => {
    const result = await db.query<Contact>(
      `UPDATE crm_contacts
       SET marketing_opt_in = false, updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [contactId],
    );

    if (!result.rows.length) throw new NotFoundError('Contact not found');

    await logActivity(ctx, db, { contact_id: contactId, activity_type: 'note', body: 'Opted out of marketing' });

    return result.rows[0];
  });
}

// ============================================================================
// OPPORTUNITIES
// ============================================================================

export async function createOpportunity(
  ctx: TenantContext,
  data: { contact_id: string; title: string; stage?: OpportunityStage; amount?: number; notes?: string },
): Promise<Opportunity> {
  if (!data.title.trim()) throw new ValidationError('Opportunity title is required');

  return withDb(ctx, async (db) => {
    const result = await db.query<Opportunity>(
      `INSERT INTO crm_opportunities (contact_id, title, stage, amount, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [data.contact_id, data.title, data.stage || 'draft', data.amount, data.notes, ctx.userId],
    );

    if (!result.rows.length) throw new Error('Failed to create opportunity');
    return result.rows[0];
  });
}

/**
 * Partial update, including a stage move — the core "workflow" action a
 * pipeline board performs. Any stage is reachable from any other (a card can
 * move backward, e.g. 'proposal' back to 'qualified'); nothing in this schema
 * enforces a one-way funnel, and CRM boards conventionally don't either.
 */
export async function updateOpportunity(
  ctx: TenantContext,
  opportunityId: string,
  updates: Partial<Pick<Opportunity, 'title' | 'stage' | 'amount' | 'notes'>>,
): Promise<Opportunity> {
  const keys = Object.keys(updates) as (keyof typeof updates)[];
  if (!keys.length) throw new ValidationError('No fields to update');
  if (updates.title !== undefined && !updates.title.trim()) throw new ValidationError('Opportunity title cannot be blank');

  return withDb(ctx, async (db) => {
    const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const values = keys.map((k) => updates[k]);

    const result = await db.query<Opportunity>(
      `UPDATE crm_opportunities SET ${setClause}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [opportunityId, ...values],
    );

    if (!result.rows.length) throw new NotFoundError('Opportunity not found');

    if (updates.stage !== undefined) {
      await logActivity(ctx, db, {
        opportunity_id: opportunityId,
        activity_type: 'note',
        body: `Stage changed to ${updates.stage}`,
      });
    }

    return result.rows[0];
  });
}

export async function listOpportunitiesForContact(ctx: TenantContext, contactId: string): Promise<Opportunity[]> {
  return withDb(ctx, async (db) => {
    const result = await db.query<Opportunity>(
      `SELECT * FROM crm_opportunities WHERE contact_id = $1 ORDER BY created_at DESC`,
      [contactId],
    );
    return result.rows;
  });
}

export interface OpportunityWithContact extends Opportunity {
  contact_name: string;
  contact_type: ContactType;
}

/**
 * Every opportunity in scope, joined with its contact — the pipeline board's
 * data source. RLS on crm_opportunities already scopes rows to contacts this
 * caller can see (migration 192), so no explicit group/org filter is needed
 * here beyond the JOIN itself.
 */
export async function listOpportunities(
  ctx: TenantContext,
  filters?: { stage?: OpportunityStage },
): Promise<OpportunityWithContact[]> {
  return withDb(ctx, async (db) => {
    const params: unknown[] = [];
    let query = `
      SELECT o.*, c.name AS contact_name, c.contact_type AS contact_type
      FROM crm_opportunities o
      JOIN crm_contacts c ON c.id = o.contact_id
      WHERE 1=1`;

    if (filters?.stage) {
      params.push(filters.stage);
      query += ` AND o.stage = $${params.length}`;
    }

    query += ` ORDER BY o.stage, o.updated_at DESC`;

    const result = await db.query<OpportunityWithContact>(query, params);
    return result.rows;
  });
}

// ============================================================================
// ACTIVITIES
// ============================================================================

export async function logActivityForContact(
  ctx: TenantContext,
  data: { contact_id?: string; opportunity_id?: string; activity_type: ActivityType; body?: string },
): Promise<Activity> {
  return withDb(ctx, (db) => logActivity(ctx, db, data));
}

async function logActivity(
  ctx: TenantContext,
  db: PoolClient,
  data: { contact_id?: string; opportunity_id?: string; activity_type: ActivityType; body?: string },
): Promise<Activity> {
  if (!data.contact_id && !data.opportunity_id) {
    throw new ValidationError('An activity needs a contact_id or opportunity_id');
  }

  const result = await db.query<Activity>(
    `INSERT INTO crm_activities (contact_id, opportunity_id, activity_type, body, actor_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [data.contact_id, data.opportunity_id, data.activity_type, data.body, ctx.userId],
  );

  return result.rows[0];
}

/**
 * A contact's full relationship timeline: activities logged directly against
 * it, PLUS activities logged against any of its opportunities (e.g. the
 * "Stage changed to X" entries updateOpportunity() writes with only an
 * opportunity_id, no contact_id) — otherwise a stage move would be invisible
 * on the contact page that motivated it.
 */
export async function listActivitiesForContact(ctx: TenantContext, contactId: string): Promise<Activity[]> {
  return withDb(ctx, async (db) => {
    const result = await db.query<Activity>(
      `SELECT * FROM crm_activities
       WHERE contact_id = $1
          OR opportunity_id IN (SELECT id FROM crm_opportunities WHERE contact_id = $1)
       ORDER BY occurred_at DESC`,
      [contactId],
    );
    return result.rows;
  });
}

export interface ActivityWithSubject extends Activity {
  contact_name: string | null;
  opportunity_title: string | null;
}

/**
 * The CRM-wide activity feed — every call/email/meeting/note/stage-change
 * across every contact and opportunity in scope, newest first. RLS on
 * crm_activities already restricts rows to this caller's contacts/
 * opportunities (migration 192).
 */
export async function listRecentActivity(ctx: TenantContext, limit = 30): Promise<ActivityWithSubject[]> {
  const cappedLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 30;

  return withDb(ctx, async (db) => {
    const result = await db.query<ActivityWithSubject>(
      `SELECT a.*,
              COALESCE(c.name, oc.name) AS contact_name,
              o.title AS opportunity_title
       FROM crm_activities a
       LEFT JOIN crm_contacts      c  ON c.id = a.contact_id
       LEFT JOIN crm_opportunities o  ON o.id = a.opportunity_id
       LEFT JOIN crm_contacts      oc ON oc.id = o.contact_id
       ORDER BY a.occurred_at DESC
       LIMIT $1`,
      [cappedLimit],
    );
    return result.rows;
  });
}

// ============================================================================
// EMAIL SUPPRESSION — consumed by Phase 9.3's send wrapper
// ============================================================================

export async function isEmailSuppressed(
  db: PoolClient,
  email: string,
  scope: { groupId?: string; organizationId?: string },
): Promise<boolean> {
  const result = await db.query(
    `SELECT 1 FROM email_suppressions
     WHERE email = $1 AND (group_id = $2 OR organization_id = $3) LIMIT 1`,
    [email, scope.groupId || null, scope.organizationId || null],
  );
  return (result.rowCount ?? 0) > 0;
}
