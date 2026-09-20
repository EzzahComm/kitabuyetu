# Phase 7: Ecosystem Feature E2E Test Plan

## Overview

Complete end-to-end testing for the Ecosystem foundation (programs, donors, impact metrics, donation flow, admin approval).

**Target Date**: 2026-09-18  
**Build Status**: In progress  
**Deployment Target**: Vercel production (kitabuyetu.co.ke)

## Test Scenarios

### 1. Organization Officer: Create Program (Draft)

**Actor**: Group treasurer / officer (member of group with manage_group role)  
**Path**: Dashboard → Programs → Create New Program

**Steps**:

1. Navigate to `https://kitabuyetu.co.ke/dashboard/programs`
2. Fill program creation form:
   - Program Name: "School Building Initiative"
   - Slug: auto-generates to "school-building-initiative"
   - Description: "Help us build a new school wing"
   - Target Amount: 500000 (KES)
   - Impact Metric Name: "Students Reached"
   - Metric Target: 150
   - Start Date: 2026-09-18
   - End Date: 2026-12-31
3. Click "Create Program"
4. Verify toast: "Program created successfully"
5. Verify program appears in "Draft" tab
6. Verify program does NOT appear in public listing

**Expected State**:

- `programs.status = 'draft'`
- `programs.created_by = current_user_id`
- `programs.organization_id = current_org_id`

---

### 2. Organization Officer: Submit Program for Review

**Actor**: Same group officer  
**Path**: Dashboard → Programs → View Details (from Draft tab) → Submit for Review

**Steps**:

1. In "Draft" programs tab, click "View Details" on newly created program
2. Click "Submit for Review" button
3. Verify confirmation toast
4. Verify program moves to "All" tab with status badge "Pending"

**Expected State**:

- `programs.status = 'pending_review'`
- Audit log entry: `{action: 'program_submitted_for_review', ...}`

---

### 3. Super Admin: Approve Program

**Actor**: Platform super admin  
**Path**: Admin → Program Review → Pending Programs

**Steps**:

1. Login as super admin (e.g., test@ezzahcomm.com with super_admin role)
2. Navigate to `https://kitabuyetu.co.ke/admin/programs`
3. Verify pending program card displays:
   - Program name
   - Organization name
   - Description
   - Target amount & impact metric
4. Click "Approve" button
5. Verify toast confirmation
6. Verify program disappears from queue

**Expected State**:

- `programs.status = 'active'`
- `programs.reviewed_by = admin_user_id`
- `programs.reviewed_at = current_timestamp`
- Audit log entry: `{action: 'program_approved', ...}`

---

### 4. Super Admin: Reject Program (Alternative)

**Actor**: Platform super admin  
**Path**: Admin → Program Review → Pending Programs

**Steps** (for alternative flow):

1. Navigate to `https://kitabuyetu.co.ke/admin/programs`
2. Click "Reject" button on pending program
3. Details section expands, reveal textarea for rejection reason
4. Enter reason: "Missing required documentation"
5. Click "Submit Rejection"
6. Verify toast confirmation

**Expected State**:

- `programs.status = 'rejected'`
- `programs.rejection_reason = 'Missing required documentation'`
- Audit log entry: `{action: 'program_rejected', changes: {reason: ...}}`

---

### 5. Public User: Browse Active Programs

**Actor**: Any unauthenticated user  
**Path**: Marketing site → Ecosystem → Programs

**Steps**:

1. Navigate to `https://kitabuyetu.co.ke/ecosystem/programs` (or from public nav)
2. Verify page title: "Support Programs"
3. Verify grid displays only active programs
4. Click on a program card
5. Verify program detail page loads with:
   - Program title, description
   - Funding progress bar (current/target)
   - Impact metric progress (Students Reached: X/150)
   - Sticky sidebar: Support button, donation form, top supporters

**Expected State**:

- Only programs with `status = 'active'` are listed
- Page is publicly accessible (no auth required)
- Metadata: title = program.name, description = program.description

---

### 6. Public User: Donate to Program (M-Pesa STK Flow)

**Actor**: Any person with M-Pesa (authenticated or public)  
**Path**: Public program detail → Donation form

**Steps**:

**6a. Initiate Donation**:

1. On program detail page, click "Support [Program Name]" button
2. Donation form opens inline with fields:
   - Phone Number: "254712345678"
   - Amount: "1000" (KES)
   - Your Name: "Jane Donor"
   - Donate Anonymously: unchecked
   - Message: "Proud to support education" (optional)
3. Click "Donate Now"
4. Verify toast: "M-Pesa prompt sent! Complete the payment on your phone."
5. Verify form shows loading state: "Waiting for payment..."

**6b. M-Pesa Payment Callback** (simulated):

- M-Pesa STK appears on phone
- User enters PIN and confirms payment
- Safaricom sends callback to `/api/webhooks/mpesa/stk-callback`
- Callback handler verifies receipt, posts ledger entry, updates `campaign_donations.status = 'completed'`
- Webhook updates `programs.amount_raised += 1000`

**6c. Completion Poll**: 6. Form continues polling `/api/v1/donations/{donationId}` every 5 seconds 7. When poll detects `status = 'completed'`:

- Toast: "Donation received! Thank you for your support."
- Form resets & closes
- Page updates to show new donation count in leaderboard
- `programs.amount_raised` increments in display

**Expected State**:

- `campaign_donations` row created with:
  - `status = 'pending'` initially, → `'completed'` after STK callback
  - `donor_name = 'Jane Donor'` (or NULL if anonymous)
  - `donor_phone = '254712345678'`
  - `amount = 1000`
  - `is_anonymous = false`
  - `message = 'Proud to support education'`
- Ledger entry posted: `DR 1001 (Cash) / CR 4001 (Donor Contributions)` for 1000
- `programs.amount_raised` incremented
- Audit log entry: `{action: 'donation_received', entity_id: donation_id}`

---

### 7. Rate Limiting: Donation Endpoint

**Actor**: Attacker / script  
**Path**: POST `/api/v1/donations`

**Steps**:

1. Send 11 donation requests in rapid succession, all from same phone + IP
2. 10th request succeeds (status 200)
3. 11th request returns 429 Too Many Requests
4. Verify rate limit resets after 1 hour window

**Expected State**:

- Rate limit key: `{phone}:{ip}`
- Limit: 10 donations per hour per phone+IP combination
- Response header: `Retry-After: 3600`

---

### 8. Donor Leaderboard: Top Supporters

**Actor**: Any user (authenticated or public)  
**Path**: Program detail sidebar OR `/ecosystem/donors`

**Steps**:

1. On program detail page, scroll to "Top Supporters" card (right sidebar)
2. Verify leaderboard displays:
   - Rank (1, 2, 3, ...)
   - Profile image or placeholder
   - Donor name (or "Anonymous" if `is_anonymous = true`)
   - Donation count
   - Total donated (formatted currency)
3. For verified donors, verify "Verified" badge appears
4. Navigate to `/ecosystem/donors` page
5. Verify leaderboards grouped by organization
6. Verify only non-anonymous donors appear

**Expected State**:

- Donors ordered by `total_donated DESC`
- Limited to top 5-10 per leaderboard (configurable)
- Anonymous donors excluded from public listing
- Verified badge present for `donors.is_verified = true`

---

### 9. Impact Dashboard: Organization Summary

**Actor**: Group officer  
**Path**: Dashboard → Ecosystem (or new section)

**Steps** (if built):

1. Navigate to organization impact summary
2. Verify key stats:
   - Total Donated: aggregate of all `donations.amount` for org's programs
   - Supporters: distinct count of `donors` across org's programs
   - Impact Metrics: count of active `impact_metrics` for org
3. Verify detailed metric breakdown:
   - Metric name, current value, target value, progress bar
   - Example: "Students Reached: 87/150 (58%)"

**Expected State**:

- Stats computed from `donations`, `donors`, `impact_metrics`
- Updates reflect recent donations within 30s (Redis TTL)

---

### 10. Integration: Ledger Posting

**Actor**: System (automatic on donation completion)  
**Path**: `/api/webhooks/mpesa/stk-callback` → ledger posting

**Steps**:

1. Trigger STK callback for completed donation (1000 KES)
2. Query ledger: `SELECT * FROM journal_lines WHERE reference_id = '{donation_id}'`
3. Verify two rows exist:
   - DR entry: account 1001, amount 1000, org_id, reference_type = 'donation'
   - CR entry: account 4001, amount 1000, org_id, reference_type = 'donation'
4. Verify balance sheet: `1001 = 4001` (double-entry maintained)

**Expected State**:

- Ledger entries posted atomically with donation status update
- Account codes hardcoded: 1001 (Cash), 4001 (Donor Contributions)
- If account codes missing in chart of accounts, donation still recorded (warning logged)

---

## Build Verification Checklist

- [ ] `npm run build` completes with exit code 0
- [ ] No TypeScript errors: `npx tsc --noEmit`
- [ ] No ESLint errors: `npx eslint app components lib/services`
- [ ] All new migrations applied to local DB
- [ ] Supabase RLS advisor shows no new warnings: `get_advisors()`
- [ ] All new tables have RLS policies enabled
- [ ] All new API routes have auth checks (withAuth or withPlatformRole)
- [ ] All new pages use proper metadata (title, description)

---

## Deployment Verification Checklist

- [ ] Vercel deployment succeeds (check https://vercel.com/dashboard)
- [ ] Production build logs show no errors
- [ ] `/api/health` endpoint responds 200
- [ ] `/api/health/deep` includes ecosystem tables in checks
- [ ] Production migrations applied (check Supabase dashboard)
- [ ] Public program listing loads at `/ecosystem/programs`
- [ ] Can create program as org officer (dashboard)
- [ ] Can approve program as super admin (admin panel)
- [ ] M-Pesa STK flow initiates on donation (may need sandbox creds)

---

## Known Limitations

1. **M-Pesa Sandbox**: May require real Safaricom sandbox credentials; production testing without real payments requires mock callback injection
2. **Anonymous Enforcement**: UI hides name but not enforced server-side; consider SECURITY DEFINER RPC if needed
3. **No Refund UI**: Ledger primitive supports reversal, but operator interface not built
4. **No Program Updates Feed**: Programs have `updated_at` but no timeline/activity feed UI

---

## Rollback Plan

If production issues found:

1. Revert last 6 commits: `git revert 0f088a5...99db22b`
2. Delete new tables: migrations to add `DROP TABLE IF EXISTS` for all 8 tables
3. Remove API routes + UI pages
4. Revert to commit `52b7681` (last Phase 6 commit)
5. Trigger Vercel redeploy

---

## Success Criteria

- ✅ All 10 test scenarios pass end-to-end
- ✅ No TypeScript/ESLint errors
- ✅ Build completes in <5 minutes
- ✅ Vercel deployment succeeds
- ✅ Zero 5xx errors in production logs over 24h
- ✅ All audit logs record state transitions
- ✅ Rate limiting blocks abuse without false positives
