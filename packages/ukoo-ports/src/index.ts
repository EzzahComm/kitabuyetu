// Spec §3.3: Port interfaces for external service adapters

export interface IdentityPort {
  currentUserId(): Promise<string | null>;
  getUserRole(userId: string): Promise<string>;
  getUserKycLevel(userId: string): Promise<number>;
}

export interface KycPort {
  requestLevel(userId: string, targetLevel: number, documents?: File[]): Promise<{ caseId: string }>;
  checkLevel(userId: string): Promise<number>;
}

export interface MessagingPort {
  sendSms(to: string, body: string, options?: { templateId?: string }): Promise<{ messageId: string }>;
  onInbound(provider: string, from: string, body: string): Promise<void>;
}

export interface BillingPort {
  catalog(): Promise<{ products: Array<{ id: string; code: string; name: string }> }>;
  entitlements(spaceId: string): Promise<Record<string, unknown>>;
  reserve(spaceId: string, metric: string, quantity: number): Promise<boolean>;
  checkoutUrl(spaceId: string, planId: string): Promise<string>;
}

export interface ContributionPort {
  recordContribution(
    groupId: string,
    memberId: string,
    amount: number,
    month: string
  ): Promise<{ id: string }>;
  getBalance(groupId: string, memberId: string): Promise<number>;
}

export interface GroupLinkPort {
  linkGroup(spaceId: string, groupId: string, program: string): Promise<{ linkId: string }>;
  listLinkedGroups(spaceId: string): Promise<Array<{ groupId: string; program: string }>>;
}

export interface StoragePort {
  uploadFile(bucket: string, path: string, file: File): Promise<{ url: string }>;
  getSignedUrl(bucket: string, path: string, expiresIn?: number): Promise<string>;
  deleteFile(bucket: string, path: string): Promise<void>;
}

export interface ScanPort {
  scanFile(file: File): Promise<{ safe: boolean; verdict?: string }>;
}

export interface AuditPort {
  log(event: {
    category: string;
    action: string;
    userId: string;
    resourceId?: string;
    before?: unknown;
    after?: unknown;
  }): Promise<void>;
}
