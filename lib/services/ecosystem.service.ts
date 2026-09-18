/**
 * Ecosystem service layer — partner registry, opportunity marketplace, eligibility matching
 * All business logic for Phase 8: Ecosystem Growth Opportunities
 */

import { PoolClient } from 'pg';
import { withDb, withTransaction, withAdminDb, type TenantContext } from '@/lib/db';
import { logger } from '@/lib/logger';
import { NotFoundError, ValidationError } from '@/lib/utils/errors';

export interface Partner {
  id: string;
  organization_id: string;
  name: string;
  type: 'donor' | 'lender' | 'insurer' | 'trainer' | 'service_provider' | 'investor';
  description?: string;
  logo_url?: string;
  website_url?: string;
  contact_email?: string;
  contact_phone?: string;
  is_active: boolean;
  verified_by_admin_user_id?: string;
  verified_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface Opportunity {
  id: string;
  partner_id: string;
  title: string;
  description: string;
  opportunity_type: 'grant' | 'loan' | 'insurance' | 'training' | 'service';
  category?: string;
  amount_min?: number;
  amount_max?: number;
  currency: string;
  terms_summary?: string;
  eligibility_rules: EligibilityRules;
  application_url?: string;
  featured: boolean;
  status: 'draft' | 'published' | 'closed' | 'archived';
  published_at?: Date;
  closed_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface Application {
  id: string;
  opportunity_id: string;
  group_id: string;
  group_name: string;
  group_member_count?: number;
  group_registration_number?: string;
  contact_member_name: string;
  contact_member_phone: string;
  contact_member_email?: string;
  message?: string;
  application_status: 'submitted' | 'shortlisted' | 'accepted' | 'rejected' | 'withdrawn';
  responded_at?: Date;
  response_message?: string;
  created_at: Date;
  updated_at: Date;
}

export interface EligibilityRule {
  id: string;
  name: string;
  type: 'range' | 'enum_whitelist' | 'geo' | 'financial' | 'external_check';
  field?: string;
  operator?: string;
  value?: any;
  values?: any[];
  function?: string;
  error_message: string;
}

export interface EligibilityRules {
  rules: EligibilityRule[];
}

export interface EligibilityResult {
  matches: boolean;
  failed_rules: string[];
}

// ============================================================================
// PARTNER MANAGEMENT
// ============================================================================

export async function createPartner(
  ctx: TenantContext,
  data: {
    name: string;
    type: 'donor' | 'lender' | 'insurer' | 'trainer' | 'service_provider' | 'investor';
    description?: string;
    logo_url?: string;
    website_url?: string;
    contact_email?: string;
    contact_phone?: string;
  },
) {
  return withAdminDb(async (db) => {
    const result = await db.query<Partner>(
      `INSERT INTO ecosystem_partners
        (organization_id, name, type, description, logo_url, website_url, contact_email, contact_phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [ctx.organizationId, data.name, data.type, data.description, data.logo_url, data.website_url, data.contact_email, data.contact_phone],
    );

    if (!result.rows.length) throw new Error('Failed to create partner');

    await logAudit(db, ctx, 'partner_created', 'ecosystem_partner', result.rows[0].id, {
      partner_name: data.name,
      partner_type: data.type,
    });

    return result.rows[0];
  });
}

export async function updatePartner(
  ctx: TenantContext,
  partnerId: string,
  updates: Partial<Partner>,
) {
  return withAdminDb(async (db) => {
    const keys = Object.keys(updates).filter((k) => k !== 'id');
    if (!keys.length) return null;

    const setClause = keys.map((_, i) => `${keys[i]} = $${i + 3}`).join(', ');
    const values = keys.map((k) => updates[k as keyof Partner]);

    const result = await db.query<Partner>(
      `UPDATE ecosystem_partners SET ${setClause}, updated_at = NOW() WHERE id = $1 AND organization_id = $2 RETURNING *`,
      [partnerId, ctx.organizationId, ...values],
    );

    if (!result.rows.length) throw new NotFoundError('Partner not found');
    return result.rows[0];
  });
}

export async function getPartnerById(ctx: TenantContext, partnerId: string): Promise<Partner | null> {
  return withDb(ctx, async (db) => {
    const result = await db.query<Partner>(
      `SELECT * FROM ecosystem_partners WHERE id = $1 AND organization_id = $2`,
      [partnerId, ctx.organizationId],
    );
    return result.rows.length ? result.rows[0] : null;
  });
}

export async function listPartners(
  ctx: TenantContext,
  filters?: { is_active?: boolean },
): Promise<Partner[]> {
  return withDb(ctx, async (db) => {
    let query = `SELECT * FROM ecosystem_partners WHERE organization_id = $1`;
    const params: any[] = [ctx.organizationId];

    if (filters?.is_active !== undefined) {
      query += ` AND is_active = $${params.length + 1}`;
      params.push(filters.is_active);
    }

    query += ` ORDER BY name`;

    const result = await db.query<Partner>(query, params);
    return result.rows;
  });
}

// ============================================================================
// OPPORTUNITY MANAGEMENT
// ============================================================================

export async function createOpportunity(
  ctx: TenantContext,
  partnerId: string,
  data: {
    title: string;
    description: string;
    opportunity_type: 'grant' | 'loan' | 'insurance' | 'training' | 'service';
    category?: string;
    amount_min?: number;
    amount_max?: number;
    currency?: string;
    terms_summary?: string;
    eligibility_rules: EligibilityRules;
    application_url?: string;
    featured?: boolean;
  },
) {
  return withAdminDb(async (db) => {
    const result = await db.query<Opportunity>(
      `INSERT INTO ecosystem_opportunities
        (partner_id, title, description, opportunity_type, category, amount_min, amount_max,
         currency, terms_summary, eligibility_rules, application_url, featured, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        partnerId,
        data.title,
        data.description,
        data.opportunity_type,
        data.category,
        data.amount_min,
        data.amount_max,
        data.currency || 'KES',
        data.terms_summary,
        JSON.stringify(data.eligibility_rules),
        data.application_url,
        data.featured || false,
        'draft',
      ],
    );

    if (!result.rows.length) throw new Error('Failed to create opportunity');

    await logAudit(db, ctx, 'opportunity_created', 'ecosystem_opportunity', result.rows[0].id, {
      title: data.title,
      type: data.opportunity_type,
    });

    return result.rows[0];
  });
}

export async function publishOpportunity(ctx: TenantContext, opportunityId: string) {
  return withAdminDb(async (db) => {
    const result = await db.query<Opportunity>(
      `UPDATE ecosystem_opportunities SET status = $1, published_at = NOW(), updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      ['published', opportunityId],
    );

    if (!result.rows.length) throw new NotFoundError('Opportunity not found');

    await logAudit(db, ctx, 'opportunity_published', 'ecosystem_opportunity', opportunityId, {});

    return result.rows[0];
  });
}

export async function closeOpportunity(ctx: TenantContext, opportunityId: string) {
  return withAdminDb(async (db) => {
    const result = await db.query<Opportunity>(
      `UPDATE ecosystem_opportunities SET status = $1, closed_at = NOW(), updated_at = NOW()
       WHERE id = $2 RETURNING *`,
      ['closed', opportunityId],
    );

    if (!result.rows.length) throw new NotFoundError('Opportunity not found');

    await logAudit(db, ctx, 'opportunity_closed', 'ecosystem_opportunity', opportunityId, {});

    return result.rows[0];
  });
}

export async function getOpportunityById(db: PoolClient, opportunityId: string): Promise<Opportunity | null> {
  const result = await db.query<Opportunity>(
    `SELECT * FROM ecosystem_opportunities WHERE id = $1`,
    [opportunityId],
  );

  return result.rows.length ? result.rows[0] : null;
}

export async function listPublishedOpportunities(
  db: PoolClient,
  filters?: { type?: string; category?: string; featured_only?: boolean },
): Promise<Opportunity[]> {
  let query = `SELECT * FROM ecosystem_opportunities WHERE status = $1`;
  const params: any[] = ['published'];

  if (filters?.type) {
    query += ` AND opportunity_type = $${params.length + 1}`;
    params.push(filters.type);
  }

  if (filters?.category) {
    query += ` AND category = $${params.length + 1}`;
    params.push(filters.category);
  }

  if (filters?.featured_only) {
    query += ` AND featured = $${params.length + 1}`;
    params.push(true);
  }

  query += ` ORDER BY featured DESC, created_at DESC`;

  const result = await db.query<Opportunity>(query, params);
  return result.rows;
}

// ============================================================================
// ELIGIBILITY MATCHING
// ============================================================================

export async function evaluateEligibility(
  opportunity: Opportunity,
  groupData: { type: string; created_at: Date; cash_balance?: number; county?: string },
): Promise<EligibilityResult> {
  const rules = (opportunity.eligibility_rules as EligibilityRules)?.rules || [];
  const failedRules: string[] = [];

  for (const rule of rules) {
    try {
      const passes = evaluateRule(rule, groupData);
      if (!passes) failedRules.push(rule.id);
    } catch (err) {
      failedRules.push(rule.id);
      logger.error('Eligibility rule evaluation failed', { rule: rule.id, error: err });
    }
  }

  return { matches: failedRules.length === 0, failed_rules: failedRules };
}

function evaluateRule(
  rule: EligibilityRule,
  groupData: { type: string; created_at: Date; cash_balance?: number; county?: string },
): boolean {
  switch (rule.type) {
    case 'range': {
      if (!rule.field || !rule.operator || rule.value === undefined) return false;
      const fieldValue = getNestedValue(groupData, rule.field);
      if (!fieldValue) return false;

      const timestamp = new Date(fieldValue).getTime();
      const threshold = new Date(rule.value).getTime();

      return rule.operator === 'before_or_equal' ? timestamp <= threshold : timestamp > threshold;
    }

    case 'enum_whitelist': {
      if (!rule.field || !rule.values) return false;
      const fieldValue = getNestedValue(groupData, rule.field);
      return rule.values.includes(fieldValue);
    }

    case 'geo': {
      if (!rule.field || !rule.values) return false;
      const fieldValue = getNestedValue(groupData, rule.field);
      return rule.values.includes(fieldValue);
    }

    case 'financial': {
      if (!rule.field || !rule.operator || rule.value === undefined) return false;
      const fieldValue = getNestedValue(groupData, rule.field);
      if (typeof fieldValue !== 'number') return false;

      switch (rule.operator) {
        case '>=':
          return fieldValue >= rule.value;
        case '<=':
          return fieldValue <= rule.value;
        case '>':
          return fieldValue > rule.value;
        case '<':
          return fieldValue < rule.value;
        default:
          return false;
      }
    }

    case 'external_check':
      // Phase 8.2: implement 3rd-party checks (loan databases, insurance APIs)
      return true;

    default:
      return false;
  }
}

function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

// ============================================================================
// APPLICATION MANAGEMENT
// ============================================================================

export async function submitApplication(
  ctx: TenantContext,
  opportunityId: string,
  groupId: string,
  data: {
    group_name: string;
    group_member_count?: number;
    group_registration_number?: string;
    contact_member_name: string;
    contact_member_phone: string;
    contact_member_email?: string;
    message?: string;
  },
) {
  return withDb(ctx, async (db) => {
    const result = await db.query<Application>(
      `INSERT INTO ecosystem_opportunity_applications
        (opportunity_id, group_id, group_name, group_member_count, group_registration_number,
         contact_member_name, contact_member_phone, contact_member_email, message, application_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        opportunityId,
        groupId,
        data.group_name,
        data.group_member_count,
        data.group_registration_number,
        data.contact_member_name,
        data.contact_member_phone,
        data.contact_member_email,
        data.message,
        'submitted',
      ],
    );

    if (!result.rows.length) throw new Error('Failed to submit application');

    await logAudit(db, ctx, 'application_submitted', 'ecosystem_opportunity_application', result.rows[0].id, {
      opportunity_id: opportunityId,
      group_id: groupId,
    });

    return result.rows[0];
  });
}

export async function listGroupApplications(ctx: TenantContext, groupId: string): Promise<Application[]> {
  return withDb(ctx, async (db) => {
    const result = await db.query<Application>(
      `SELECT * FROM ecosystem_opportunity_applications WHERE group_id = $1 ORDER BY created_at DESC`,
      [groupId],
    );

    return result.rows;
  });
}

export async function listApplicationsForOpportunity(
  db: PoolClient,
  opportunityId: string,
): Promise<Application[]> {
  const result = await db.query<Application>(
    `SELECT * FROM ecosystem_opportunity_applications WHERE opportunity_id = $1 ORDER BY created_at DESC`,
    [opportunityId],
  );

  return result.rows;
}

export async function updateApplicationStatus(
  ctx: TenantContext,
  applicationId: string,
  status: 'submitted' | 'shortlisted' | 'accepted' | 'rejected' | 'withdrawn',
  responseMessage?: string,
) {
  return withAdminDb(async (db) => {
    const result = await db.query<Application>(
      `UPDATE ecosystem_opportunity_applications
       SET application_status = $1, response_message = $2, responded_at = NOW(), updated_at = NOW()
       WHERE id = $3 RETURNING *`,
      [status, responseMessage, applicationId],
    );

    if (!result.rows.length) throw new NotFoundError('Application not found');

    await logAudit(db, ctx, 'application_status_updated', 'ecosystem_opportunity_application', applicationId, {
      new_status: status,
    });

    return result.rows[0];
  });
}

// ============================================================================
// HELPER: AUDIT LOGGING
// ============================================================================

async function logAudit(
  db: PoolClient,
  ctx: TenantContext,
  action: string,
  resourceType: string,
  resourceId: string,
  details: any,
) {
  try {
    await db.query(
      `INSERT INTO audit_logs (organization_id, user_id, action, resource_type, resource_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [ctx.organizationId, ctx.userId, action, resourceType, resourceId, JSON.stringify(details), null],
    );
  } catch (err) {
    logger.error('Failed to log audit', { action, error: err });
    // Don't throw — audit logging failure shouldn't block operations
  }
}
