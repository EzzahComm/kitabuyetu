import type {
  IdentityPort,
  KycPort,
  MessagingPort,
  BillingPort,
  ContributionPort,
  GroupLinkPort,
  StoragePort,
  ScanPort,
  AuditPort,
} from '@ukoo/ports';
import { supabaseAdmin } from './supabase';

const mode = process.env.UKOO_MODE || 'integrated';

// Mode A: Integrated with Kitabu Yetu services (v1 only)
class IntegratedIdentityPort implements IdentityPort {
  async currentUserId(): Promise<string | null> {
    // TODO: Call next-auth session or Kitabu Yetu auth
    return null;
  }

  async getUserRole(userId: string): Promise<string> {
    // TODO: Query space_member.role
    return 'member';
  }

  async getUserKycLevel(userId: string): Promise<number> {
    // TODO: Query kyc_profile.level
    return 0;
  }
}

class IntegratedKycPort implements KycPort {
  async requestLevel(userId: string, targetLevel: number, documents?: File[]): Promise<{ caseId: string }> {
    // TODO: Create kyc_case row
    return { caseId: 'stub' };
  }

  async checkLevel(userId: string): Promise<number> {
    // TODO: Query kyc_profile.level
    return 0;
  }
}

class IntegratedMessagingPort implements MessagingPort {
  async sendSms(to: string, body: string, options?: { templateId?: string }): Promise<{ messageId: string }> {
    // TODO: Call Kitabu Yetu SMS service via RPC
    console.log(`[SMS] To: ${to}, Body: ${body}`);
    return { messageId: 'stub' };
  }

  async onInbound(provider: string, from: string, body: string): Promise<void> {
    // TODO: Route inbound SMS to appropriate handler
    console.log(`[Inbound SMS] From: ${from}, Body: ${body}`);
  }
}

class IntegratedBillingPort implements BillingPort {
  async catalog(): Promise<{ products: Array<{ id: string; code: string; name: string }> }> {
    // TODO: Query products table
    const { data, error } = await supabaseAdmin!.from('products').select('id, code, name');
    if (error) throw error;
    return { products: data || [] };
  }

  async entitlements(spaceId: string): Promise<Record<string, unknown>> {
    // TODO: Query space_billing.plan_id -> plan_entitlements
    return {};
  }

  async reserve(spaceId: string, metric: string, quantity: number): Promise<boolean> {
    // TODO: Check entitlements, reserve from cache
    return true;
  }

  async checkoutUrl(spaceId: string, planId: string): Promise<string> {
    // TODO: Generate Kitabu Yetu checkout link
    return 'https://checkout.example.com';
  }
}

class IntegratedContributionPort implements ContributionPort {
  async recordContribution(
    groupId: string,
    memberId: string,
    amount: number,
    month: string
  ): Promise<{ id: string }> {
    // TODO: Call Kitabu Yetu contribution service
    return { id: 'stub' };
  }

  async getBalance(groupId: string, memberId: string): Promise<number> {
    // TODO: Query from Kitabu Yetu
    return 0;
  }
}

class IntegratedGroupLinkPort implements GroupLinkPort {
  async linkGroup(spaceId: string, groupId: string, program: string): Promise<{ linkId: string }> {
    // TODO: Create external_link row
    return { linkId: 'stub' };
  }

  async listLinkedGroups(spaceId: string): Promise<Array<{ groupId: string; program: string }>> {
    // TODO: Query external_link rows
    return [];
  }
}

class IntegratedStoragePort implements StoragePort {
  async uploadFile(bucket: string, path: string, file: File): Promise<{ url: string }> {
    // TODO: Upload to Supabase Storage
    return { url: 'https://storage.example.com/file' };
  }

  async getSignedUrl(bucket: string, path: string, expiresIn?: number): Promise<string> {
    // TODO: Generate signed URL
    return 'https://storage.example.com/signed';
  }

  async deleteFile(bucket: string, path: string): Promise<void> {
    // TODO: Delete from Supabase Storage
  }
}

class IntegratedScanPort implements ScanPort {
  async scanFile(file: File): Promise<{ safe: boolean; verdict?: string }> {
    // TODO: Call ClamAV or antivirus service
    return { safe: true };
  }
}

class IntegratedAuditPort implements AuditPort {
  async log(event: {
    category: string;
    action: string;
    userId: string;
    resourceId?: string;
    before?: unknown;
    after?: unknown;
  }): Promise<void> {
    // TODO: Insert audit_event row via RPC
    console.log('[Audit]', event);
  }
}

// Container factory
export function createContainer() {
  if (mode === 'integrated') {
    return {
      identity: new IntegratedIdentityPort(),
      kyc: new IntegratedKycPort(),
      messaging: new IntegratedMessagingPort(),
      billing: new IntegratedBillingPort(),
      contribution: new IntegratedContributionPort(),
      groupLink: new IntegratedGroupLinkPort(),
      storage: new IntegratedStoragePort(),
      scan: new IntegratedScanPort(),
      audit: new IntegratedAuditPort(),
    };
  }

  throw new Error(`Unknown UKOO_MODE: ${mode}`);
}

// Singleton container instance
let container: ReturnType<typeof createContainer> | null = null;

export function getContainer() {
  if (!container) {
    container = createContainer();
  }
  return container;
}
