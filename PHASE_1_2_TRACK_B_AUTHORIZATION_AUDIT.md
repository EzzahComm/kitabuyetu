# Phase 1.2 Track B: Authorization Audit

**Completed**: 2026-09-16
**Audit Focus**: Critical financial, membership, and governance services
**Services Analyzed**: 10 critical services across 4 tiers
**Status**: ⚠️ **CORRECTED 2026-09-16 — the HIGH RISK findings below are false positives. Do not implement the Phase 2 roadmap in this document.**

> ## Correction (2026-09-16, same day)
>
> This audit inspected only `lib/services/*.ts` and never checked the API
> route handlers under `app/api/v1/...`, which is where this codebase
> deliberately puts every authorization check (services are intentionally
> role-agnostic business logic). Verified directly against the route files:
> every operation flagged HIGH RISK below — loan approve/reject/disburse/
> markDefaulted, contribution create/update/delete, member create/
> updateRole/transitionStatus, settlement initiate, disbursement initiate,
> bank account create — is gated by `withPermission(req, '<permission>',
...)` (`lib/auth/middleware.ts` + `lib/auth/permissions.ts`) against a real
> `roles.permissions` seed catalog
> (`__tests__/integration/permissions/role-permission-catalog.test.ts`),
> scoped to secretary/treasurer/chairperson tiers, never plain `member`.
> Several — loan approval, settlement initiation, B2C disbursement
> initiation, member status transitions — additionally re-verify the
> permission against LIVE `roles.permissions` via `assertAuthFresh()` before
> acting, because they're flagged "Sensitive op" (§2.5,
> `SIMPLIFICATION_AND_RBAC_AUDIT.md` Workstream 4).
>
> The role names this document's Phase 2 code samples invented —
> `loan_officer`, `finance_officer`, `chairman` — do not exist anywhere in
> the schema. The real `member_role` enum (migration 001) has exactly four
> values: `group_admin`, `treasurer`, `secretary`, `member`. Implementing
> those samples as written would have silently locked every real treasurer
> and chairperson out of their own group in production.
>
> The one row in this document's own table that IS correct:
> `changePassword()` has no role check, but it's deliberately self-scoped
> (hardcodes `auth.userId`, can't target another member) — already flagged
> "acceptable pattern" in the per-service table below, even though the
> executive summary above contradicts that and calls it HIGH RISK anyway.
>
> **No Phase 2 authorization implementation is needed.** The findings and
> Phase 2 roadmap below are preserved for the record, not as active guidance.

---

## Executive Summary

This audit examined authorization patterns across 10 critical services handling sensitive financial and membership operations. **Key Finding**: While the codebase implements robust row-level security (RLS) at the database level and has begun implementing dual-control (maker-checker) patterns for high-risk operations, the application layer **lacks comprehensive role-based access control (RBAC)**.

Most group-scoped services rely entirely on RLS for access control, with no explicit role checks at the application layer. This creates a significant gap: any authenticated group member can perform operations that should be restricted to officers (treasurers, loan officers, administrators). Organization-scoped services (organization-finance, organization-members) correctly enforce coordinator roles, but the pattern is inconsistent.

**Critical Issues Found**:

1. **Missing RBAC in group-scoped services** — No role validation for financial operations (loans, contributions, settlements, disbursements)
2. **Inconsistent dual-control implementation** — Some operations enforce maker-checker, others don't
3. **No authorization at application layer** — Operations gate on status only, not role
4. **Audit logging present but incomplete** — Logs what happened, not who should have been allowed

**Risk Level**: **HIGH** — Any authenticated group member can currently:

- Create/approve loans
- Create/approve settlements and disbursements
- Manage member roles and status
- Create bank accounts

---

## Services Audited

### Summary Table

| Service                      | Auth Pattern     | Dual-Control | Role Checks | Risk Level |
| ---------------------------- | ---------------- | ------------ | ----------- | ---------- |
| contributions.service        | RLS only         | ❌           | ❌          | HIGH       |
| loans.service                | RLS + status     | ⚠️ Partial   | ❌          | HIGH       |
| organization-finance.service | Coordinator role | ✅ Full      | ✅          | MEDIUM     |
| members.service              | RLS only         | ❌           | ❌          | HIGH       |
| organization-members.service | Super-admin only | ❌           | ✅          | LOW        |
| settlements.service          | RLS + threshold  | ✅ Full      | ❌          | HIGH       |
| disbursements.service        | RLS + threshold  | ✅ Full      | ❌          | HIGH       |
| organization.service         | Coordinator role | ❌           | ✅          | MEDIUM     |
| group-bank-accounts.service  | RLS only         | ✅ Partial   | ❌          | HIGH       |

---

## Detailed Findings

### Tier 1 - Financial Critical

#### 1. contributions.service

**File**: `lib/services/contributions.service.ts`

**Permission Model**:

- Uses `ctx.groupId` for all filtering (RLS isolation)
- Calls `assertActiveMembership()` to verify member belongs to group
- No role-based checks

**Authorization Checks**:
| Operation | Check Present | Details |
|-----------|--------------|---------|
| list() | ❌ | Filters by ctx.groupId only |
| create() | ⚠️ | Validates active membership; no role check |
| update() | ❌ | Filters by ctx.groupId; any group member can update |
| delete() | ⚠️ | Only pending contributions; any group member can delete |
| remindNonContributors() | ❌ | No role check (likely should be treasurer-only) |

**Context Usage**:

- `ctx.userId`: Used for audit logging
- `ctx.groupId`: Used for all data scoping
- No `ctx.organizationId` usage

**Gaps & Issues**:

- **CRITICAL**: No role validation. Any authenticated group member can:
  - Create contributions for any active member
  - Update or delete their own contributions
  - Trigger reminders to non-contributors
- Missing: Treasurer-only enforcement on reminders
- Missing: Authorization check for who can update/delete

**Risk Classification**: **HIGH**

**Recommended Authorization Model**:

```typescript
// Proposed pattern
async create(ctx: TenantContext, data: CreateContributionInput): Promise<Contribution> {
  // NEW: Require treasurer or finance officer role
  if (!['treasurer', 'finance_officer', 'chairman'].includes(ctx.role)) {
    throw new ForbiddenError('Only officers can record contributions');
  }
  // ... rest of logic
}
```

---

#### 2. loans.service

**File**: `lib/services/loans.service.ts`

**Permission Model**:

- Uses `ctx.groupId` for group isolation
- Calls `assertActiveMembership()` for borrower and guarantor validation
- No role-based checks
- **Partial dual-control**: `writeOff()` enforces maker-checker

**Authorization Checks**:
| Operation | Check Present | Details |
|-----------|--------------|---------|
| list() | ❌ | Filters by ctx.groupId only |
| apply() | ⚠️ | Validates active membership; allows data.memberId override but no role check |
| approve() | ❌ | Filters by status; any group member can approve |
| reject() | ❌ | Filters by status; any group member can reject |
| disburse() | ❌ | Filters by status; any group member can disburse |
| recordRepayment() | ⚠️ | Validates installment status; no role check |
| markDefaulted() | ❌ | Filters by status; any group member can mark defaulted |
| writeOff() | ✅ | **Enforces maker-checker**: approver ≠ defaulted_by |

**Context Usage**:

- `ctx.userId`: Used for recording approvals and audit logging
- `ctx.groupId`: Used for all queries
- `ctx.organizationId`: Used in `getEffectiveLoanTerms()` for policy lookup

**Patterns Identified**:

- **Status-based restrictions**: Operations check current loan status (pending → approved → disbursed → active)
- **Group-level isolation**: All queries filter by ctx.groupId
- **Single dual-control**: Only `writeOff()` enforces maker-checker

**Gaps & Issues**:

- **CRITICAL**: No role-based checks on `apply()`, `approve()`, `reject()`, `disburse()`, `markDefaulted()`
  - Any authenticated group member can approve loans
  - Any authenticated group member can disburse loans
  - Any authenticated group member can mark loans defaulted
- **Missing dual-control** on `approve()` and `disburse()` (high-risk operations)
- **Inconsistent pattern**: `writeOff()` has dual-control, but `approve()` doesn't
- **Missing**: Authorization check for who can apply loans on behalf of others (data.memberId override)

**Risk Classification**: **HIGH**

**Identified Dual-Control Pattern**:

```typescript
// writeOff() correctly enforces maker-checker
if (existing[0].defaulted_by === ctx.userId) {
  throw new ForbiddenError('Maker-checker: the officer who marked this loan defaulted cannot authorize its write-off');
}
```

**Recommended Authorization Model**:

```typescript
// Add role checks for all approval operations
async approve(ctx: TenantContext, id: string, _data: ApproveLoanInput): Promise<Loan> {
  // NEW: Require loan officer or finance role
  if (!['loan_officer', 'finance_officer', 'chairman'].includes(ctx.role)) {
    throw new ForbiddenError('Only loan officers can approve loans');
  }

  // Also add dual-control where appropriate
  const { rows: existing } = await client.query(
    'SELECT approved_by FROM loans WHERE id = $1 AND group_id = $2',
    [id, ctx.groupId]
  );
  if (existing[0]?.approved_by === ctx.userId) {
    throw new ForbiddenError('Maker-checker: the officer who applied this loan cannot approve it');
  }
  // ... rest of logic
}
```

---

#### 3. organization-finance.service

**File**: `lib/services/organization-finance.service.ts`  
**Size**: ~2000 lines (audit read: 700-1580)

**Permission Model**:

- **Correctly enforces** `organization_coordinator` role via `assertOrganizationCoordinator()`
- Uses `ctx.organizationId` for organization isolation
- RLS scopes all tables to `app_current_organization_id()`
- Belt-and-braces pattern: both app layer and RLS checks

**Authorization Checks**:
| Operation | Check Present | Details |
|-----------|--------------|---------|
| getWallet() | ✅ | assertOrganizationCoordinator |
| deposit() | ✅ | assertOrganizationCoordinator |
| listLedger() | ✅ | assertOrganizationCoordinator |
| listPrograms() | ✅ | assertOrganizationCoordinator |
| listProgramGroups() | ✅ | assertOrganizationCoordinator + explicit org_id check |
| programBudgetReport() | ✅ | assertOrganizationCoordinator + assertReportsAccess |
| requestDisbursement() | ✅ | assertOrganizationCoordinator |
| approveDisbursement() | ✅ | assertOrganizationCoordinator + **maker-checker** |
| rejectDisbursement() | ✅ | assertOrganizationCoordinator |

**Context Usage**:

- `ctx.userId`: Used for audit logging and approvals
- `ctx.organizationId`: Used for all organization-scoped queries (required)
- Throws ValidationError if `ctx.organizationId` is missing

**Patterns Identified**:

- **Role-based RBAC**: All operations require `organization_coordinator` role
- **Belt-and-braces**: Explicit checks at app layer AND RLS at database layer
- **Dual-control on approveDisbursement()**:
  ```typescript
  if (rows[0].created_by === ctx.userId) {
    throw new ForbiddenError('Maker-checker: the initiator cannot approve their own disbursement');
  }
  ```
- **Processing fees**: Properly captured and separated from net disbursed amount
- **Funding source tracking**: Every disbursement creates a group-side funding source

**Gaps & Issues**:

- None identified at authorization layer
- Implementation is consistent and well-designed

**Risk Classification**: **MEDIUM** (org-level only, properly gated)

**Recommended Pattern** (Use as model for group-scoped services):

```typescript
// Pattern used correctly here; replicate in group services
async approveDisbursement(ctx: TenantContext, id: string): Promise<OrgDisbursement> {
  await organizationService.assertOrganizationCoordinator(ctx);
  // ... then check maker-checker at operation level
  if (rows[0].created_by === ctx.userId) {
    throw new ForbiddenError('Maker-checker: the initiator cannot approve their own disbursement');
  }
}
```

---

### Tier 2 - Membership & Access

#### 4. members.service

**File**: `lib/services/members.service.ts`  
**Size**: 800+ lines

**Permission Model**:

- Uses `ctx.groupId` for group isolation (RLS only)
- No role-based checks at all
- Implements `applyMemberMask()` for field-level masking based on `ctx.role`

**Authorization Checks**:
| Operation | Check Present | Details |
|-----------|--------------|---------|
| list() | ❌ | Filters by ctx.groupId; applies member mask for field masking only |
| getById() | ❌ | Filters by ctx.groupId; applies member mask |
| create() | ❌ | Validates billing cap; no role check |
| update() | ❌ | Filters by ctx.groupId; any member can update |
| updateRole() | ❌ | No role check (critical: only officers should change roles) |
| transitionStatus() | ❌ | No role check (critical: archiving/suspending members) |
| archive() | ❌ | No role check |
| changePassword() | ❌ | Own password only (acceptable pattern) |
| createNextOfKin() | ❌ | Filters by ctx.groupId; no role check |

**Context Usage**:

- `ctx.userId`: Used for audit logging and password changes
- `ctx.groupId`: Used for all queries
- `ctx.role`: Used for `applyMemberMask()` (field-level masking only)

**Patterns Identified**:

- **Sensitive field stripping**: Correctly strips credential material (password_hash, OTP_hash, session_version)
- **Member masking**: Applies different views based on `ctx.role`
- **Audit logging**: All write operations log old and new values

**Gaps & Issues**:

- **CRITICAL**: No role validation on any operation
  - Any group member can create new members
  - Any group member can update member details
  - Any group member can change member roles (treasurer → member, secretary → member)
  - Any group member can archive/suspend/blacklist/exit members
  - Any group member can manage next-of-kin records
- **Missing**: Authorization check for member creation (should require secretary/chairman)
- **Missing**: Authorization check for role changes (should require chairman/board)
- **Missing**: Authorization check for status transitions (different roles for different statuses)

**Security Note**: OTP hash leak vulnerability (migration 104) was fixed in PR #159 (2026-09-14). Sensitive fields now properly stripped.

**Risk Classification**: **HIGH**

**Recommended Authorization Model**:

```typescript
// Proposed role-based patterns
async updateRole(ctx: TenantContext, memberId: string, role: string): Promise<GroupMember> {
  // NEW: Only chairman/board members can change roles
  if (!['chairman', 'secretary', 'board_member'].includes(ctx.role)) {
    throw new ForbiddenError('Only board members can change member roles');
  }
  // ... rest of logic
}

async transitionStatus(ctx: TenantContext, memberId: string, target: MemberStatus, reason?: string): Promise<GroupMember> {
  // NEW: Different roles for different transitions
  if (target === 'archived' || target === 'exited') {
    if (!['secretary', 'chairman'].includes(ctx.role)) {
      throw new ForbiddenError('Only officers can archive/exit members');
    }
  }
  if (target === 'suspended' || target === 'blacklisted') {
    if (!['chairman'].includes(ctx.role)) {
      throw new ForbiddenError('Only chairman can suspend/blacklist members');
    }
  }
  // ... rest of logic
}
```

---

#### 5. organization-members.service

**File**: `lib/services/organization-members.service.ts`

**Permission Model**:

- Uses `withAdminDb()` — super_admin only (no tenant context)
- Takes explicit `organizationId` parameter
- Gated at route layer (super_admin route only), not service layer
- Phase 1 implementation (direct admin-only add)

**Authorization Checks**:
| Operation | Check Present | Details |
|-----------|--------------|---------|
| listOrgStaff() | ✅ | withAdminDb only; super_admin route gate |
| addOrgStaff() | ✅ | withAdminDb only; assertStaffCap |
| changeOrgStaffRole() | ✅ | withAdminDb only |
| archiveOrgStaff() | ✅ | withAdminDb only |

**Context Usage**:

- No `TenantContext` (uses withAdminDb with explicit organizationId)
- `invitedBy`: Passed explicitly, not from context

**Patterns Identified**:

- **Admin-only pattern**: Correct use of `withAdminDb` for admin operations
- **Staff capacity check**: Validates against organization's staff limit
- **Platform role upgrade**: Promotes members from 'member' to 'organization_coordinator' automatically
- **Dual-control in database**: RLS policies require `org_role = 'lead'` for INSERT/UPDATE (future self-service support)

**Gaps & Issues**:

- None at authorization layer (correctly super-admin only)
- Phase 2 will add self-service path with RLS policies

**Risk Classification**: **LOW**

**Note**: This service correctly mirrors `admin-organizations.service.ts` pattern by:

1. Using `withAdminDb` instead of tenant context
2. Gating at route layer
3. Taking explicit `organizationId` parameter
4. Implementing capability checks (staff cap)

---

### Tier 3 - Payments & Settlements

#### 6. settlements.service

**File**: `lib/services/settlements.service.ts`

**Permission Model**:

- Uses `ctx.groupId` for group isolation
- No role-based checks
- Uses `recordApproval()` from `settlement-approvals.service` for dual-control

**Authorization Checks**:
| Operation | Check Present | Details |
|-----------|--------------|---------|
| initiate() | ❌ | Validates bank account status; no role check |
| approve() | ✅ | **Enforces maker-checker via recordApproval()** |
| reject() | ✅ | **Enforces maker-checker via recordApproval()** |
| getById() | ❌ | Filters by ctx.groupId only |
| list() | ❌ | Filters by ctx.groupId only |

**Context Usage**:

- `ctx.userId`: Used for recording approvals and initiations
- `ctx.groupId`: Used for all queries
- Bank account status checked (must be 'active')
- Account balance validated before initiation

**Patterns Identified**:

- **Dual-control via shared helper**: `recordApproval()` enforces maker-checker:
  ```typescript
  if (args.initiatedBy === ctx.userId) {
    throw new ForbiddenError(
      `Maker-checker: the initiator cannot ${args.decision === 'approved' ? 'approve' : 'reject'} their own request`,
    );
  }
  ```
- **Threshold-based**: No explicit threshold in code (always requires approval)
- **Reservation pattern**: Funds reserved at initiation, released at settlement/rejection
- **External dispatch**: Settlement dispatches Daraja B2B outside transaction

**Gaps & Issues**:

- **CRITICAL**: No role check on `initiate()`
  - Any authenticated group member can request settlements
  - Should require treasurer/finance officer role
- **Partial dual-control**: Only `approve()` and `reject()` have checks; `initiate()` doesn't

**Risk Classification**: **HIGH**

**Maker-Checker Implementation** (via recordApproval):

```typescript
export async function recordApproval(db: PoolClient, ctx: TenantContext, args: RecordApprovalInput): Promise<void> {
  if (args.initiatedBy === ctx.userId) {
    throw new ForbiddenError(
      `Maker-checker: the initiator cannot ${args.decision === 'approved' ? 'approve' : 'reject'} their own request`,
    );
  }
  // ... records approval to settlement_approvals table
}
```

**Recommended Authorization Model**:

```typescript
async initiate(ctx: TenantContext, input: InitiateSettlementInput): Promise<SettlementRow> {
  // NEW: Require treasurer/finance officer role
  if (!['treasurer', 'finance_officer'].includes(ctx.role)) {
    throw new ForbiddenError('Only officers can request settlements');
  }
  // ... rest of logic
}
```

---

#### 7. disbursements.service

**File**: `lib/services/disbursements.service.ts`

**Permission Model**:

- Uses `ctx.groupId` for group isolation
- No role-based checks
- Threshold-based dual-control via `getEffectiveThreshold()`

**Authorization Checks**:
| Operation | Check Present | Details |
|-----------|--------------|---------|
| initiateDisbursement() | ⚠️ | No role check; validates loan status if linked |
| approve() | ✅ | **Enforces maker-checker**: `initiated_by !== ctx.userId` |
| reject() | ✅ | **Enforces maker-checker**: `initiated_by !== ctx.userId` |
| getById() | ❌ | Filters by ctx.groupId only |
| list() | ❌ | Filters by ctx.groupId only |

**Context Usage**:

- `ctx.userId`: Used for recording approvals and initiations
- `ctx.groupId`: Used for all queries

**Patterns Identified**:

- **Threshold-based approval**: `getEffectiveThreshold()` determines if amount > group's limit
- **Dual-control on approve()**: Direct check:
  ```typescript
  if (rows[0].initiated_by === ctx.userId) {
    throw new ForbiddenError('Maker-checker: the initiator cannot approve their own disbursement');
  }
  ```
- **Reservation pattern**: Funds reserved at initiation
- **Idempotency**: (group_id, idempotency_key) is UNIQUE
- **Loan-linked**: Can be tied to a specific loan (status validated)

**Gaps & Issues**:

- **CRITICAL**: No role check on `initiateDisbursement()`
  - Any authenticated group member can request disbursements
  - Should require treasurer/finance officer role
- **Partial dual-control**: Only high-amount disbursements require approval
  - Low-amount disbursements auto-approve
  - This is by design (single-control for under-threshold amounts)

**Risk Classification**: **HIGH** (threshold-mitigated, but still needs role check)

**Recommended Authorization Model**:

```typescript
async initiateDisbursement(
  ctx: TenantContext, input: InitiateDisbursementInput,
): Promise<DisbursementRow & { needsApproval: boolean }> {
  // NEW: Require treasurer/finance officer role
  if (!['treasurer', 'finance_officer'].includes(ctx.role)) {
    throw new ForbiddenError('Only officers can request disbursements');
  }
  // ... rest of logic
}
```

---

### Tier 4 - Platform Governance

#### 8. organization.service

**File**: `lib/services/organization.service.ts`  
**Size**: 400+ lines

**Permission Model**:

- **Correctly enforces** `organization_coordinator` role via `assertOrganizationCoordinator()`
- Uses `ctx.organizationId` for organization isolation
- Different from group-scoped services

**Authorization Checks**:
| Operation | Check Present | Details |
|-----------|--------------|---------|
| getProfile() | ✅ | assertOrganizationCoordinator |
| getBranding() | ✅ | assertOrganizationCoordinator |
| setBranding() | ✅ | assertOrganizationCoordinator + assertWhiteLabelAccess |
| listGroupSummaries() | ✅ | assertOrganizationCoordinator |
| listGroupMembers() | ✅ | assertOrganizationCoordinator |
| getAuditLog() | ✅ | assertOrganizationCoordinator |

**Context Usage**:

- `ctx.organizationId`: Required for all operations
- `ctx.userId`: Used for audit logging
- `ctx.role`: Checked against 'organization_coordinator' and 'super_admin'

**Patterns Identified**:

- **Role-based RBAC**: All operations require coordinator role
- **Organization isolation**: All queries explicitly check organization_id
- **Audit trail**: All modifications logged

**Gaps & Issues**:

- None identified at authorization layer
- No dual-control (not needed for profile-level operations)

**Risk Classification**: **MEDIUM**

---

#### 9. group-bank-accounts.service

**File**: `lib/services/group-bank-accounts.service.ts`

**Permission Model**:

- Uses `ctx.groupId` for group isolation
- No role-based checks
- Uses `recordApproval()` for dual-control on activation

**Authorization Checks**:
| Operation | Check Present | Details |
|-----------|--------------|---------|
| create() | ❌ | Filters by ctx.groupId; no role check |
| activate() | ✅ | **Enforces maker-checker via recordApproval()** |
| reject() | ✅ | **Enforces maker-checker via recordApproval()** |
| disable() | ⚠️ | Single-actor only (risk-reducing action) |
| getById() | ❌ | Filters by ctx.groupId only |
| listActive() | ❌ | Filters by ctx.groupId only |
| list() | ❌ | Filters by ctx.groupId only |

**Context Usage**:

- `ctx.userId`: Used for recording approvals and creation
- `ctx.groupId`: Used for all queries

**Patterns Identified**:

- **Dual-control on activation**: Critical operation (determines where settlements go)
  - Uses `recordApproval()` which enforces `created_by !== ctx.userId`
- **Single-actor on disable**: Deliberate choice (disabling reduces risk)
- **Status flow**: pending_approval → active/rejected → disabled
- **Reconciliation column**: source_account for B2B reconciliation

**Gaps & Issues**:

- **CRITICAL**: No role check on `create()`
  - Any group member can create bank accounts
  - Should require treasurer/finance officer role
- **Missing**: Who can disable accounts? (currently anyone)

**Risk Classification**: **HIGH**

**Recommended Authorization Model**:

```typescript
async create(ctx: TenantContext, input: CreateGroupBankAccountInput): Promise<GroupBankAccountRow> {
  // NEW: Require treasurer/finance officer role
  if (!['treasurer', 'finance_officer'].includes(ctx.role)) {
    throw new ForbiddenError('Only officers can add bank accounts');
  }
  // ... rest of logic
}

async disable(ctx: TenantContext, id: string, reason?: string): Promise<GroupBankAccountRow> {
  // RECOMMENDED: Require officer role (currently no check)
  if (!['treasurer', 'finance_officer', 'chairman'].includes(ctx.role)) {
    throw new ForbiddenError('Only officers can disable bank accounts');
  }
  // ... rest of logic
}
```

---

## Authorization Patterns & Recommendations

### Pattern 1: Organization-Scoped Services (CORRECT PATTERN)

**Used by**: organization-finance.service, organization.service, organization-members.service

```typescript
async operation(ctx: TenantContext, ...): Promise<Result> {
  // 1. Role check at entry point
  await organizationService.assertOrganizationCoordinator(ctx);

  // 2. Organization ID validation (belt-and-braces)
  const organizationId = orgId(ctx); // throws if missing

  // 3. RLS at query layer provides defense-in-depth
  return withDb(ctx, async (db) => {
    const { rows } = await db.query(
      'SELECT * FROM organizations WHERE id = $1',
      [organizationId] // Both app layer and RLS check
    );
    // ... process
  });
}
```

**Strengths**:

- Clear role requirement
- Defense-in-depth (both app layer and RLS)
- Consistent pattern across services
- Easy to audit and test

**Should be replicated** in group-scoped services.

---

### Pattern 2: Dual-Control / Maker-Checker (CORRECT PATTERN)

**Option A: Direct Check** (loans.service, disbursements.service)

```typescript
async approve(ctx: TenantContext, id: string): Promise<Result> {
  const { rows } = await db.query('SELECT initiated_by FROM table WHERE id = $1', [id]);
  if (rows[0].initiated_by === ctx.userId) {
    throw new ForbiddenError('Maker-checker: initiator cannot approve own request');
  }
  // ... approve
}
```

**Option B: Shared Helper** (settlements.service, group-bank-accounts.service)

```typescript
async approve(ctx: TenantContext, id: string): Promise<Result> {
  const { rows } = await db.query('SELECT created_by FROM table WHERE id = $1', [id]);

  await recordApproval(db, ctx, {
    subjectType: 'subject',
    subjectId: id,
    initiatedBy: rows[0].created_by ?? '',
    decision: 'approved',
  });
  // recordApproval() enforces maker-checker internally
  // ... approve
}
```

**Current Coverage**:

- ✅ loans.service: writeOff() only
- ✅ organization-finance.service: approveDisbursement()
- ✅ settlements.service: approve(), reject()
- ✅ disbursements.service: approve(), reject()
- ✅ group-bank-accounts.service: activate(), reject()

**Missing Coverage** (HIGH RISK):

- ❌ loans.service: approve(), reject(), disburse()
- ❌ contributions.service: All operations
- ❌ members.service: All operations
- ❌ settlements.service: initiate()
- ❌ disbursements.service: initiate()
- ❌ group-bank-accounts.service: create()

---

### Pattern 3: Threshold-Based Approval

**Used by**: disbursements.service

```typescript
const threshold = await getEffectiveThreshold(db, 'group_disbursement_threshold', { groupId: ctx.groupId });
const requiresApproval = amount > threshold;

if (requiresApproval) {
  status = 'pending_approval'; // Awaits second officer
} else {
  status = 'approved'; // Auto-approve under threshold
}
```

**Characteristics**:

- **Appropriate for amount-based gating** (high amounts need review)
- **Does not replace role checks** (role still needed to initiate)
- **Risk**: Auto-approval under threshold could be abused if threshold is too high

**Recommendation**: Use threshold + role check together:

```typescript
// PROPOSED
if (!['treasurer', 'finance_officer'].includes(ctx.role)) {
  throw new ForbiddenError('Only officers can request disbursements');
}
const requiresApproval = amount > threshold; // Additionally check threshold
```

---

## Critical Findings Summary

### Issue #1: Missing RBAC in Group-Scoped Services

**Affected Services** (5 services):

- contributions.service ❌
- loans.service ❌
- members.service ❌
- settlements.service ❌
- disbursements.service ❌
- group-bank-accounts.service ❌

**Impact**: Any authenticated group member can:

- Create, approve, and disburse loans
- Create and approve settlements
- Create and approve disbursements
- Manage member roles and status
- Create bank accounts

**Mitigation**: Implement role checks based on operation:

- **Treasurer**: contributions, settlements, disbursements
- **Loan Officer**: loans (apply, approve, disburse)
- **Chairman/Secretary**: members (create, update role, transition status)

---

### Issue #2: Inconsistent Dual-Control Implementation

**Current State**:

- 5 operations have dual-control ✅
- 10+ operations need it ❌

**Operations Requiring Dual-Control**:

- Loan approval (high-value decision)
- Loan disbursement (money leaves group)
- Settlement initiation (money leaves group)
- Disbursement initiation (money leaves group)
- Member role changes (governance)
- Member status transitions (governance)

**Recommendation**: Use recordApproval() pattern consistently across all settlement/payment operations.

---

### Issue #3: RLS vs. Application Layer Authorization

**Current Pattern**:

```
RLS Checks                      | App Layer Checks
────────────────────────────────┼─────────────────────────
✅ Row-level filtering by group | ❌ Role-based access
✅ Tenant isolation (table-wide)| ❌ Operation-level authority
                                | ❌ Dual-control consistency
```

**Risk**: RLS provides table-level isolation but not fine-grained authorization:

- RLS prevents cross-group data leaks ✅
- RLS does NOT enforce role-based policies ❌
- Anyone with any role can access their group's data ❌

**Recommendation**: Implement **belt-and-braces** pattern:

```typescript
// Layer 1: Application-layer role check
if (!hasRequiredRole(ctx.role)) {
  throw new ForbiddenError(...);
}

// Layer 2: RLS at database layer
await db.query(
  'SELECT * FROM table WHERE group_id = $1', // RLS enforces
  [ctx.groupId]
);
```

---

## Risk Assessment Matrix

| Service              | Role Checks | Dual-Control | RLS | Overall Risk |
| -------------------- | ----------- | ------------ | --- | ------------ |
| contributions        | ❌          | ❌           | ✅  | **HIGH**     |
| loans                | ❌          | ⚠️           | ✅  | **HIGH**     |
| organization-finance | ✅          | ✅           | ✅  | **MEDIUM**   |
| members              | ❌          | ❌           | ✅  | **HIGH**     |
| organization-members | ✅          | ❌           | ✅  | **LOW**      |
| settlements          | ❌          | ⚠️           | ✅  | **HIGH**     |
| disbursements        | ❌          | ✅           | ✅  | **HIGH**     |
| organization         | ✅          | ❌           | ✅  | **MEDIUM**   |
| group-bank-accounts  | ❌          | ⚠️           | ✅  | **HIGH**     |

**Overall Platform Risk**: **HIGH** — 6 critical services lack role-based authorization.

---

## Implementation Roadmap for Phase 2

### Phase 2.1: Establish Consistent Authorization Framework (Week 1-2)

**Deliverable**: Shared authorization utilities and patterns

```typescript
// lib/utils/authorization.ts
export async function assertGroupRole(ctx: TenantContext, requiredRoles: string[]): Promise<void> {
  if (!requiredRoles.includes(ctx.role)) {
    throw new ForbiddenError(`This operation requires one of: ${requiredRoles.join(', ')}`);
  }
}

export function assertMakerChecker(initiatedBy: string, approvingAs: string, operationName: string): void {
  if (initiatedBy === approvingAs) {
    throw new ForbiddenError(`Maker-checker: the initiator cannot ${operationName} their own request`);
  }
}

export async function getEffectiveThreshold(
  db: PoolClient,
  policyKey: string,
  context: { groupId?: string; organizationId?: string },
): Promise<number> {
  // Existing implementation, but ensure used consistently
}
```

**Tasks**:

1. Review and document existing role definitions across platform
2. Create centralized authorization helper functions
3. Define role→permission matrix for each service
4. Write tests for authorization checks

---

### Phase 2.2: Add Role Checks to Group-Scoped Services (Week 2-4)

**Priority Order** (Financial first):

1. **loans.service** (HIGH PRIORITY)
   - require 'loan_officer' | 'finance_officer' for apply()
   - add dual-control to approve() and disburse()
   - restrict markDefaulted() to loan_officer
2. **settlements.service** (HIGH PRIORITY)
   - require 'treasurer' | 'finance_officer' for initiate()
   - maker-checker already working on approve()
3. **disbursements.service** (HIGH PRIORITY)
   - require 'treasurer' | 'finance_officer' for initiate()
   - maker-checker already working on approve()

4. **contributions.service** (MEDIUM PRIORITY)
   - require 'treasurer' for create()
   - require 'treasurer' for remindNonContributors()

5. **members.service** (MEDIUM PRIORITY)
   - require 'secretary' | 'chairman' for create()
   - require 'chairman' for updateRole()
   - differentiated checks for status transitions

6. **group-bank-accounts.service** (MEDIUM PRIORITY)
   - require 'treasurer' | 'finance_officer' for create()
   - maker-checker already working on activate()

---

### Phase 2.3: Standardize Dual-Control Patterns (Week 3-4)

**Implementation**:

- Apply direct checks (like disbursements) for simpler operations
- Use recordApproval() pattern for complex workflows
- Ensure consistency in error messages

**Services to update**:

- Add dual-control to loans.service: approve(), disburse()
- Add dual-control to settlements.service: initiate() if high-value
- Add role checks to members.service: updateRole(), transitionStatus()

---

### Phase 2.4: Complete Authorization Audit (Week 4-5)

**Scope**: Remaining 50+ services not covered in Track B

**Deliverable**: Full platform authorization matrix

---

## Testing Strategy

### Authorization Test Suite

```typescript
// __tests__/integration/authorization.test.ts
describe('Authorization', () => {
  describe('loans.service', () => {
    it('should require loan_officer role to approve loans', async () => {
      const memberContext = { role: 'member', groupId: 'g1', userId: 'u1' };
      expect(() => loansService.approve(memberContext, 'loan1')).toThrow('Only loan officers can approve loans');
    });

    it('should enforce maker-checker on loan approval', async () => {
      const approverContext = { role: 'loan_officer', groupId: 'g1', userId: 'u2' };
      const loan = { id: 'loan1', applied_by: 'u2' }; // approver applied it
      expect(() => loansService.approve(approverContext, 'loan1')).toThrow(
        'Maker-checker: the officer who applied this loan cannot approve it',
      );
    });
  });

  describe('members.service', () => {
    it('should require chairman to change member roles', async () => {
      const memberContext = { role: 'member', groupId: 'g1', userId: 'u1' };
      expect(() => membersService.updateRole(memberContext, 'member2', 'treasurer')).toThrow(
        'Only board members can change member roles',
      );
    });
  });
});
```

---

## Validation Checklist for Phase 2 Implementation

- [ ] All group-scoped services have role checks on write operations
- [ ] All high-risk operations (loans, settlements, disbursements) have dual-control
- [ ] Member management operations gated by appropriate roles
- [ ] Authorization tests written and passing for all services
- [ ] Documentation updated with authorization model
- [ ] Audit logs verify authorization checks are enforced
- [ ] Production verification: sample operations logged to confirm role enforcement
- [ ] No regression: existing approved disbursements/settlements still work

---

## Conclusion

The Kitabu Yetu platform has made good progress on authorization through:

- ✅ RLS for tenant isolation
- ✅ Dual-control patterns in some services
- ✅ Role enforcement in organization-scoped services

However, the **largest gap** remains in group-scoped services (6 services) where any authenticated group member can perform sensitive financial operations without role validation.

Phase 2 implementation of consistent RBAC and standardized dual-control patterns will **significantly reduce authorization risk** and align the platform with governance best practices.

**Estimated Effort for Phase 2 Implementation**: 3-4 weeks

- Week 1-2: Framework setup and role definitions
- Week 2-4: Service-by-service updates
- Week 4-5: Testing and cross-platform audit

**Success Criteria**:

- All financial operations require appropriate role
- Dual-control enforced for high-risk actions
- Consistent pattern across all services
- 100% of write operations have role checks
- Audit trail documents who was authorized for each operation

---

**Audit Completed By**: Claude Haiku 4.5  
**Date**: 2026-09-16  
**Next Step**: Phase 2.1 Authorization Framework Implementation
