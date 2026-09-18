/**
 * Ecosystem Service (Phase 7)
 *
 * Manages:
 * - Programs (organizational funding initiatives)
 * - Donors & supporter tracking
 * - Funding sources (grants, corporate)
 * - Ecosystem partners (NGO marketplace)
 * - Impact metrics & donor segments
 */

import { db } from '@/lib/db';
import { audit } from '@/lib/audit';
import type { Database } from '@/types/database';

export type Program = Database['public']['Tables']['programs']['Row'];
export type Donor = Database['public']['Tables']['donors']['Row'];
export type Donation = Database['public']['Tables']['donations']['Row'];
export type FundingSource = Database['public']['Tables']['funding_sources']['Row'];
export type EcosystemPartner = Database['public']['Tables']['ecosystem_partners']['Row'];
export type ImpactMetric = Database['public']['Tables']['impact_metrics']['Row'];

// ============================================================================
// PROGRAMS
// ============================================================================

export async function createProgram(
  ctx: any,
  data: {
    name: string;
    slug: string;
    description?: string;
    targetAmount?: number;
    impactMetricName?: string;
    impactMetricTarget?: number;
    startDate?: string;
    endDate?: string;
  },
) {
  const orgId = ctx.organization_id;
  if (!orgId) throw new Error('Organization context required');

  const program = await db
    .from('programs')
    .insert([
      {
        organization_id: orgId,
        name: data.name,
        slug: data.slug,
        description: data.description,
        target_amount: data.targetAmount,
        impact_metric_name: data.impactMetricName,
        impact_metric_target: data.impactMetricTarget,
        start_date: data.startDate,
        end_date: data.endDate,
        status: 'draft',
        created_by: ctx.user_id,
      },
    ])
    .select()
    .single();

  if (!program.error) {
    await audit(ctx, {
      action: 'create',
      entity: 'program',
      entity_id: program.data.id,
      changes: {
        new: program.data,
      },
    });
  }

  return program;
}

export async function listProgramsByOrg(ctx: any, { status }: { status?: string } = {}) {
  let query = db.from('programs').select('*').eq('organization_id', ctx.organization_id);

  if (status) {
    query = query.eq('status', status);
  }

  return query.order('created_at', { ascending: false });
}

export async function getProgramBySlug(orgId: string, slug: string) {
  return db.from('programs').select('*').eq('organization_id', orgId).eq('slug', slug).single();
}

export async function activateProgram(ctx: any, programId: string) {
  const program = await db
    .from('programs')
    .update({ status: 'active' })
    .eq('id', programId)
    .eq('organization_id', ctx.organization_id)
    .select()
    .single();

  if (!program.error) {
    await audit(ctx, {
      action: 'update',
      entity: 'program',
      entity_id: programId,
      changes: {
        old: { status: 'draft' },
        new: { status: 'active' },
      },
    });
  }

  return program;
}

// ============================================================================
// DONORS
// ============================================================================

export async function createOrUpdateDonor(
  orgId: string,
  data: {
    name: string;
    email?: string;
    phone?: string;
    isAnonymous?: boolean;
    profileImageUrl?: string;
    bio?: string;
  },
) {
  // Try to find existing donor by email
  if (data.email) {
    const existing = await db
      .from('donors')
      .select('*')
      .eq('organization_id', orgId)
      .eq('email', data.email)
      .maybeSingle();

    if (existing.data) {
      // Update existing donor
      return db
        .from('donors')
        .update({
          name: data.name,
          phone: data.phone,
          profile_image_url: data.profileImageUrl,
          bio: data.bio,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.data.id)
        .select()
        .single();
    }
  }

  // Create new donor
  return db
    .from('donors')
    .insert([
      {
        organization_id: orgId,
        name: data.name,
        email: data.email,
        phone: data.phone,
        is_anonymous: data.isAnonymous ?? false,
        profile_image_url: data.profileImageUrl,
        bio: data.bio,
      },
    ])
    .select()
    .single();
}

export async function listPublicDonors(orgId: string, { limit = 50 } = {}) {
  return db
    .from('donors')
    .select('*')
    .eq('organization_id', orgId)
    .eq('is_anonymous', false)
    .eq('is_verified', true)
    .order('total_donated', { ascending: false })
    .limit(limit);
}

export async function getDonorProfile(donorId: string) {
  const donor = await db.from('donors').select('*').eq('id', donorId).single();

  if (donor.error) return donor;

  // Get donor's donations
  const donations = await db
    .from('donations')
    .select('*')
    .eq('donor_id', donorId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false });

  return {
    data: {
      ...donor.data,
      donations: donations.data || [],
    },
  };
}

// ============================================================================
// DONATIONS (Extended)
// ============================================================================

export async function recordDonation(
  orgId: string,
  data: {
    donorId?: string;
    campaignId?: string;
    programId?: string;
    amount: number;
    paymentMethod?: string;
    mpesaReceiptNumber?: string;
    donorName?: string;
    donorEmail?: string;
    donorMessage?: string;
    isPublic?: boolean;
    impactUnits?: number;
  },
) {
  const donation = await db
    .from('donations')
    .insert([
      {
        organization_id: orgId,
        donor_id: data.donorId,
        campaign_id: data.campaignId,
        program_id: data.programId,
        amount: data.amount,
        payment_method: data.paymentMethod,
        mpesa_receipt_number: data.mpesaReceiptNumber,
        donor_name: data.donorName,
        donor_email: data.donorEmail,
        donor_message: data.donorMessage,
        is_public: data.isPublic ?? true,
        impact_units: data.impactUnits,
        status: 'completed',
      },
    ])
    .select()
    .single();

  if (!donation.error && data.donorId) {
    // Update donor totals
    await db
      .from('donors')
      .update({
        total_donated: db.raw('total_donated + ?', [data.amount]),
        donation_count: db.raw('donation_count + 1'),
        last_donation_at: new Date().toISOString(),
      })
      .eq('id', data.donorId);
  }

  return donation;
}

export async function listDonationsByProgram(programId: string) {
  return db
    .from('donations')
    .select('*')
    .eq('program_id', programId)
    .eq('status', 'completed')
    .eq('is_public', true)
    .order('created_at', { ascending: false });
}

// ============================================================================
// FUNDING SOURCES
// ============================================================================

export async function createFundingSource(
  ctx: any,
  data: {
    name: string;
    type: string;
    amount?: number;
    sourceContactName?: string;
    sourceContactEmail?: string;
    notes?: string;
  },
) {
  return db
    .from('funding_sources')
    .insert([
      {
        organization_id: ctx.organization_id,
        name: data.name,
        type: data.type,
        amount: data.amount,
        source_contact_name: data.sourceContactName,
        source_contact_email: data.sourceContactEmail,
        notes: data.notes,
        status: 'pledged',
      },
    ])
    .select()
    .single();
}

export async function listFundingSources(ctx: any) {
  return db
    .from('funding_sources')
    .select('*')
    .eq('organization_id', ctx.organization_id)
    .order('created_at', { ascending: false });
}

// ============================================================================
// IMPACT METRICS
// ============================================================================

export async function getImpactSummary(orgId: string) {
  const metrics = await db
    .from('impact_metrics')
    .select('*')
    .eq('organization_id', orgId)
    .eq('verified', true);

  const donations = await db
    .from('donations')
    .select('amount')
    .eq('organization_id', orgId)
    .eq('status', 'completed');

  const donors = await db
    .from('donors')
    .select('id')
    .eq('organization_id', orgId)
    .eq('is_anonymous', false)
    .eq('is_verified', true);

  const totalDonated = donations.data?.reduce((sum, d) => sum + (d.amount || 0), 0) || 0;

  return {
    data: {
      metrics: metrics.data || [],
      totalDonated,
      totalDonors: donors.data?.length || 0,
      totalPrograms: 0, // Calculated separately
    },
  };
}

export async function recordImpactMetric(
  ctx: any,
  data: {
    metricName: string;
    metricType: string;
    currentValue: number;
    targetValue?: number;
    unitName?: string;
  },
) {
  return db
    .from('impact_metrics')
    .insert([
      {
        organization_id: ctx.organization_id,
        metric_name: data.metricName,
        metric_type: data.metricType,
        current_value: data.currentValue,
        target_value: data.targetValue,
        unit_name: data.unitName,
        verified: true,
        verified_by: ctx.user_id,
        verified_at: new Date().toISOString(),
      },
    ])
    .select()
    .single();
}

// ============================================================================
// ECOSYSTEM PARTNERS (Public)
// ============================================================================

export async function listActivePartners({ type }: { type?: string } = {}) {
  let query = db.from('ecosystem_partners').select('*').eq('is_active', true);

  if (type) {
    query = query.eq('type', type);
  }

  return query.order('total_referrals', { ascending: false });
}

export async function getPartnerProfile(partnerId: string) {
  return db.from('ecosystem_partners').select('*').eq('id', partnerId).single();
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

export async function updateProgramProgress(programId: string, amount: number) {
  return db
    .from('programs')
    .update({
      current_amount: db.raw('current_amount + ?', [amount]),
      updated_at: new Date().toISOString(),
    })
    .eq('id', programId);
}

export async function updateDonorStats(donorId: string) {
  const donations = await db
    .from('donations')
    .select('amount')
    .eq('donor_id', donorId)
    .eq('status', 'completed');

  const totalDonated = donations.data?.reduce((sum, d) => sum + (d.amount || 0), 0) || 0;

  return db
    .from('donors')
    .update({
      total_donated: totalDonated,
      donation_count: donations.data?.length || 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', donorId);
}
