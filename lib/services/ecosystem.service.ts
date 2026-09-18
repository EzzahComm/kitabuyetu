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

    // Audit log
    await db.query(
      `INSERT INTO audit_logs (organization_id, user_id, action, resource_type, resource_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        ctx.organizationId,
        ctx.userId,
        'partner_created',
        'ecosystem_partner',
        result.rows[0].id,
        JSON.stringify({ partner_name: data.name, partner_type: data.type }),
        ctx.ipAddress || null,
      ],
    );

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

    const setClause = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');
    const values = keys.map((k) => updates[k as keyof Partner]);

    const result = await db.query<Partner>(
      `UPDATE ecosystem_partners SET ${setClause}, updated_at = NOW() WHERE id = $1 AND organization_id = $2 RETURNING *`,
      [partnerId, ctx.organizationId, ...values],
    );

    if (!result.rows.length) throw new NotFoundError('Partner not found');
    return result.rows[0];
  });
}

export async function getPartnerById(
  ctx: TenantContext,
  partnerId: string,
): Promise<Partner | null> {
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
  db: SupabaseClient,
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
  const { data: opportunity, error } = await db
    .from('ecosystem_opportunities')
    .insert({
      partner_id: partnerId,
      title: data.title,
      description: data.description,
      opportunity_type: data.opportunity_type,
      category: data.category,
      amount_min: data.amount_min,
      amount_max: data.amount_max,
      currency: data.currency || 'KES',
      terms_summary: data.terms_summary,
      eligibility_rules: data.eligibility_rules,
      application_url: data.application_url,
      featured: data.featured || false,
      status: 'draft',
    })
    .select()
    .single();

  if (error) throw error;
  return opportunity;
}

export async function updateOpportunity(
  db: SupabaseClient,
  opportunityId: string,
  updates: Partial<Opportunity>,
) {
  const { data: opportunity, error } = await db
    .from('ecosystem_opportunities')
    .update({ ...updates, updated_at: new Date() })
    .eq('id', opportunityId)
    .select()
    .single();

  if (error) throw error;
  return opportunity;
}

export async function publishOpportunity(
  db: SupabaseClient,
  opportunityId: string,
) {
  return updateOpportunity(db, opportunityId, {
    status: 'published',
    published_at: new Date(),
  });
}

export async function closeOpportunity(
  db: SupabaseClient,
  opportunityId: string,
) {
  return updateOpportunity(db, opportunityId, {
    status: 'closed',
    closed_at: new Date(),
  });
}

export async function getOpportunityById(
  db: SupabaseClient,
  opportunityId: string,
): Promise<Opportunity | null> {
  const { data, error } = await db
    .from('ecosystem_opportunities')
    .select('*, ecosystem_partners!inner(name, type, website_url, contact_email)')
    .eq('id', opportunityId)
    .single();

  if (error && error.code === 'PGRST116') return null;
  if (error) throw error;
  return data;
}

export async function listPublishedOpportunities(
  db: SupabaseClient,
  filters?: {
    type?: string;
    category?: string;
    amount_min?: number;
    amount_max?: number;
    featured_only?: boolean;
  },
) {
  let query = db
    .from('ecosystem_opportunities')
    .select('*, ecosystem_partners(name, type, website_url)')
    .eq('status', 'published');

  if (filters?.type) query = query.eq('opportunity_type', filters.type);
  if (filters?.category) query = query.eq('category', filters.category);
  if (filters?.featured_only) query = query.eq('featured', true);
  if (filters?.amount_min) query = query.gte('amount_min', filters.amount_min);
  if (filters?.amount_max) query = query.lte('amount_max', filters.amount_max);

  const { data, error } = await query.order('featured', { ascending: false }).order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ============================================================================
// ELIGIBILITY MATCHING
// ============================================================================

export async function evaluateEligibility(
  db: SupabaseClient,
  opportunity: Opportunity,
  groupData: {
    id: string;
    type: string;
    created_at: string;
    cash_balance?: number;
    member_count?: number;
    county?: string;
  },
): Promise<EligibilityResult> {
  const rules = (opportunity.eligibility_rules as EligibilityRules)?.rules || [];
  const failedRules: string[] = [];

  for (const rule of rules) {
    try {
      const passes = await evaluateRule(db, rule, groupData, opportunity.partner_id);
      if (!passes) {
        failedRules.push(rule.id);
      }
    } catch (err) {
      // If rule evaluation fails, consider it a failed rule (safety-first)
      failedRules.push(rule.id);
      console.error(`Error evaluating rule ${rule.id}:`, err);
    }
  }

  return {
    matches: failedRules.length === 0,
    failed_rules: failedRules,
  };
}

async function evaluateRule(
  db: SupabaseClient,
  rule: EligibilityRule,
  groupData: any,
  partnerId: string,
): Promise<boolean> {
  switch (rule.type) {
    case 'range': {
      // Check if a date field is before/after a threshold
      if (!rule.field || !rule.operator || rule.value === undefined) return false;

      const fieldValue = getNestedValue(groupData, rule.field);
      if (!fieldValue) return false;

      const timestamp = new Date(fieldValue).getTime();
      const threshold = new Date(rule.value).getTime();

      if (rule.operator === 'before_or_equal') {
        return timestamp <= threshold;
      }
      if (rule.operator === 'after') {
        return timestamp > threshold;
      }
      return false;
    }

    case 'enum_whitelist': {
      // Check if a field is in a whitelist of values
      if (!rule.field || !rule.values) return false;

      const fieldValue = getNestedValue(groupData, rule.field);
      return rule.values.includes(fieldValue);
    }

    case 'geo': {
      // Check if group is in allowed regions
      if (!rule.field || !rule.values) return false;

      const fieldValue = getNestedValue(groupData, rule.field);
      return rule.values.includes(fieldValue);
    }

    case 'financial': {
      // Check financial thresholds
      if (!rule.field || !rule.operator || rule.value === undefined) return false;

      const fieldValue = getNestedValue(groupData, rule.field);
      if (typeof fieldValue !== 'number') return false;

      if (rule.operator === '>=') return fieldValue >= rule.value;
      if (rule.operator === '<=') return fieldValue <= rule.value;
      if (rule.operator === '>') return fieldValue > rule.value;
      if (rule.operator === '<') return fieldValue < rule.value;
      return false;
    }

    case 'external_check': {
      // Deferred to Phase 8.2 — stub returns true for now
      // Example: checkNoActiveLoansWith(partner_id, group_id)
      return true;
    }

    default:
      return false;
  }
}

function getNestedValue(obj: any, path: string): any {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

export async function listMatchingOpportunities(
  db: SupabaseClient,
  groupId: string,
): Promise<(Opportunity & { matches: boolean; failed_rules: string[] })[]> {
  // Fetch group data
  const { data: group, error: groupError } = await db
    .from('groups')
    .select('id, type, created_at, cash_balance:account_balance, member_count')
    .eq('id', groupId)
    .single();

  if (groupError) throw groupError;

  // Fetch all published opportunities
  const opportunities = await listPublishedOpportunities(db);

  // Evaluate eligibility for each
  const results = await Promise.all(
    opportunities.map(async (opp) => {
      const eligibility = await evaluateEligibility(db, opp, group);
      return {
        ...opp,
        matches: eligibility.matches,
        failed_rules: eligibility.failed_rules,
      };
    }),
  );

  return results;
}

export async function invalidateEligibilityCache(
  db: SupabaseClient,
  groupId: string,
) {
  // Delete all eligibility checks for this group (will be re-evaluated on next view)
  const { error } = await db
    .from('ecosystem_opportunity_eligibility_checks')
    .delete()
    .eq('group_id', groupId);

  if (error) throw error;
}

// ============================================================================
// APPLICATION MANAGEMENT
// ============================================================================

export async function submitApplication(
  db: SupabaseClient,
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
  const { data: application, error } = await db
    .from('ecosystem_opportunity_applications')
    .insert({
      opportunity_id: opportunityId,
      group_id: groupId,
      group_name: data.group_name,
      group_member_count: data.group_member_count,
      group_registration_number: data.group_registration_number,
      contact_member_name: data.contact_member_name,
      contact_member_phone: data.contact_member_phone,
      contact_member_email: data.contact_member_email,
      message: data.message,
      application_status: 'submitted',
    })
    .select()
    .single();

  if (error) throw error;

  // Audit log
  await db.from('audit_logs').insert({
    organization_id: null, // May need adjustment based on context
    user_id: null,
    action: 'application_submitted',
    resource_type: 'ecosystem_opportunity_application',
    resource_id: application.id,
    details: {
      opportunity_id: opportunityId,
      group_id: groupId,
    },
    ip_address: null,
    created_at: new Date(),
  });

  return application;
}

export async function listGroupApplications(
  db: SupabaseClient,
  groupId: string,
): Promise<(Application & { opportunity: Opportunity })[]> {
  const { data, error } = await db
    .from('ecosystem_opportunity_applications')
    .select('*, ecosystem_opportunities!inner(*)')
    .eq('group_id', groupId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function listApplicationsForOpportunity(
  db: SupabaseClient,
  opportunityId: string,
) {
  const { data, error } = await db
    .from('ecosystem_opportunity_applications')
    .select()
    .eq('opportunity_id', opportunityId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data || [];
}

export async function updateApplicationStatus(
  db: SupabaseClient,
  applicationId: string,
  status: 'submitted' | 'shortlisted' | 'accepted' | 'rejected' | 'withdrawn',
  responseMessage?: string,
) {
  const { data: application, error } = await db
    .from('ecosystem_opportunity_applications')
    .update({
      application_status: status,
      response_message: responseMessage,
      responded_at: new Date(),
    })
    .eq('id', applicationId)
    .select()
    .single();

  if (error) throw error;

  // Audit log
  await db.from('audit_logs').insert({
    organization_id: null,
    user_id: null,
    action: 'application_status_updated',
    resource_type: 'ecosystem_opportunity_application',
    resource_id: applicationId,
    details: {
      new_status: status,
      response_message: responseMessage,
    },
    ip_address: null,
    created_at: new Date(),
  });

  return application;
}

// ============================================================================
// CATEGORIES
// ============================================================================

export async function listFeaturedCategories(db: SupabaseClient) {
  const { data, error } = await db
    .from('ecosystem_featured_categories')
    .select()
    .eq('is_active', true)
    .order('sort_order');

  if (error) throw error;
  return data || [];
}
