<#
.SYNOPSIS
    Kitabu Yetu — Production-Readiness Master Testing Prompt
.DESCRIPTION
    Comprehensive test suite covering Unit, Integration, System/E2E, UAT,
    Security, AuthZ, Financial Integrity, M-Pesa, SMS, Email, Performance,
    Accessibility, Responsive UI and Regression.
.NOTES
    Run from the root of the Kitabu Yetu repository.
    The AI agent must follow every constraint and produce the required reports.
#>

# ============================================================
# HARD CONSTRAINTS (never violate)
# ============================================================
# - Work only from the CURRENT application tree
# - Do NOT rewrite architecture
# - Do NOT replace existing authentication
# - Do NOT introduce Prisma
# - Do NOT modify production data
# - Do NOT expose secrets (SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET, Daraja, Resend, SMS, DB passwords, tokens)
# - Do NOT disable security controls to make tests pass
# - Do NOT delete failing tests
# - Do NOT change requirements to match current (broken) behaviour
# - If a test fails → establish evidence first, then identify root cause
# - Prefer existing test infrastructure; create only the minimum needed
# - Detect package manager (npm / pnpm / yarn / bun) before running any package commands
# - Never claim PASS without objective evidence
# - Never convert BLOCKED or NOT TESTED into PASS

# ============================================================
# START — PHASE 0: ENVIRONMENT & REPOSITORY DISCOVERY
# ============================================================
Write-Host "=== PHASE 0: Environment & Repository Discovery ===" -ForegroundColor Cyan

Get-Location
Get-ChildItem -Force

# Key files & folders to inspect
$pathsToInspect = @(
    "package.json",
    "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock",
    "tsconfig.json", "next.config.*",
    "app", "components", "lib", "services", "supabase", "migrations",
    "tests", "e2e", "scripts", "middleware.*", "proxy.*",
    "api", "server actions"
)
$pathsToInspect | ForEach-Object { if (Test-Path $_) { Get-Item $_ } }

git status --short
git branch --show-current
git log -5 --oneline

# Detect package manager, Node, Next.js, testing stack, DB strategy, auth, etc.
# (Agent: record findings — never print secrets)

# Create result directories
$dirs = @(
    ".test-results",
    ".test-results/unit",
    ".test-results/integration",
    ".test-results/system",
    ".test-results/security",
    ".test-results/uat",
    ".test-results/regression"
)
$dirs | ForEach-Object { New-Item -ItemType Directory -Force -Path $_ | Out-Null }

# Initial discovery report
@"
# Kitabu Yetu — Discovery Report
Generated: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
"@ | Set-Content -Path ".test-results/00-discovery.md" -Encoding UTF8

Write-Host "Discovery directories created. Proceed with full Phase 0 inspection and populate 00-discovery.md" -ForegroundColor Green

# ============================================================
# PHASE 1 — TEST INFRASTRUCTURE VALIDATION
# ============================================================
# Goal: Identify existing scripts and run safest checks
# Actions:
#   - Inspect package.json scripts (test, test:unit, test:integration, test:e2e, lint, typecheck, build)
#   - Detect package manager and run only compatible commands
#   - At minimum attempt: package-manager test / lint / tsc --noEmit / build
#   - Record missing infrastructure as NOT CONFIGURED
# Output: .test-results/01-test-infrastructure.md

# ============================================================
# PHASE 2 — UNIT TESTING
# ============================================================
# Priority areas:
# AUTHENTICATION: login, session, token, expired/invalid session, password reset, role/org/group resolution, post-login routing
# AUTHORIZATION: developer, staff/admin, super_admin, support, org admin, field officer, donor, chairperson, secretary, treasurer, member
# FINANCIAL LOGIC: savings, shares, loan principal/service charge/interest, repayments, outstanding, fines, penalties, registration fees, welfare, dividends, balances, allocation, arrears, due dates
#   Boundary values: 0, 1, negative, decimal, very large, null, undefined, invalid strings, duplicates, boundary dates
#   Must not rely on unsafe floating-point
# VSLA RULES: share price, savings, loan eligibility/limits, service charge, repayment, fines, welfare, meeting frequency, cycle dates/closing, dividends, constitution
# MEMBERSHIP: create/update/deactivate/reactivate, duplicates, next-of-kin, group/org membership
# VALIDATION: malformed UUIDs/numbers/enums/dates/strings/IDs/URLs + malicious input (HTML/JS/SQL-like/oversized)
# Expected: validation failures without crash or unauthorized mutation
# Output: .test-results/unit/results.txt + summary.md

# ============================================================
# PHASE 3 — DATABASE & INTEGRATION TESTING
# ============================================================
# Inspect Supabase migrations + structure for: organizations, groups, users, members, meetings, contributions, shares, loans, repayments, welfare, fines, payments, grants, donors, notifications, audit logs
# Verify: FKs, unique constraints, indexes, RLS, triggers, functions, transactions
# Test path: application → Supabase → PostgreSQL (insert/update/transaction/rollback/RLS/audit)
# Concurrent financial updates where practical
# Output: .test-results/integration/database.md

# ============================================================
# PHASE 4 — AUTHENTICATION & AUTHORIZATION
# ============================================================
# Routes: /login, /admin-login, /enterprise/login
# Cases: valid/invalid login, expired session, logout, protected/unauthorized routes, role/org/group routing, session refresh, revoked access
# Critical: IDOR resistance (URL/API ID changes, modified JWT claims, wrong org/group/role)
# Expected: 401/403 (do not rely on UI alone)
# Output: .test-results/security/authentication.md + authorization.md

# ============================================================
# PHASE 5 — ORGANIZATION & GROUP ISOLATION
# ============================================================
# Create isolated contexts: ORG-A/B, GROUP-A1/A2/B1 + users
# Verify strict isolation + donor visibility rules + field-officer assignment limits
# Output: .test-results/security/isolation.md

# ============================================================
# PHASE 6 — FINANCIAL INTEGRITY (CRITICAL)
# ============================================================
# Every mutation must record: transaction ID, timestamp, actor, org, group, member, type, amount, reference, audit
# Verify: group totals == sum of valid member transactions, loan balance = principal + charges − repayments, welfare balance consistency
# Cases: duplicate, concurrent, failed, rollback, retry, partial failure, invalid/negative/decimal/large amounts
# Failed transactions must leave no partial state
# Output: .test-results/integration/financial-integrity.md

# ============================================================
# PHASE 7 — M-PESA / PAYMENT TESTING
# ============================================================
# NEVER use real production money. Use mocks / sandbox / test credentials only.
# Cover: STK Push, C2B, status, reversal, B2C (if applicable), failures, timeouts, invalid/delayed/duplicate callbacks, over/partial payment, reconciliation
# Full lifecycle per callback: payment → validation → idempotency → transaction → allocation → balance → receipt → notification → audit
# Same callback twice → exactly ONE financial transaction
# Invalid signature → rejected
# Output: .test-results/integration/payments.md

# ============================================================
# PHASE 8 — SMS TESTING
# ============================================================
# Cover: meeting/contribution/payment/loan/birthday/campaign messages + failure/retry/invalid/opt-out/duplicate prevention
# CRITICAL: audit for SMS loops — run same scheduler/event multiple times → no uncontrolled duplicates
# Verify: idempotency, deduplication, retry limits, recipient throttling, audit logging
# Use provider mocks/test mode only
# Output: .test-results/integration/sms.md

# ============================================================
# PHASE 9 — EMAIL TESTING
# ============================================================
# Cover: transactional, enterprise, support, marketing, password reset, notifications + failure/retry/bounce/unsubscribe/duplicate prevention/rate limiting
# CRITICAL: one event → expected number of emails (no uncontrolled retries → spam)
# Check: event deduplication, queues, background/cron/webhook processing
# Use test sink / mock only
# Output: .test-results/integration/email.md

# ============================================================
# PHASE 10 — SYSTEM / E2E TESTING
# ============================================================
# Full scenarios:
# 1. Organization (TEST_ORGANIZATION)
# 2. Group (TEST_UKULIMA_GROUP) with full VSLA config
# 3. 15–30 members (unique refs, balances, next-of-kin)
# 4. Meeting (savings/shares/repayments/fines/welfare/loan disbursement)
# 5. Loan lifecycle (apply → eligibility → approve → disburse → repay → balances/statements)
# 6. M-Pesa payment full lifecycle
# 7. Reminder scheduler (no duplicate SMS)
# 8. Donor + grant (KES 1,000,000) visibility rules
# 9. Multi-group enterprise org + field officers
# 10. VSLA cycle close (balances, dividends, outstanding, reports, audit)
# Output: .test-results/system/e2e-results.md

# ============================================================
# PHASE 11 — SECURITY TESTING
# ============================================================
# Auth bypass, AuthZ bypass, IDOR, privilege escalation, cross-org/group, RLS bypass, XSS, SQLi, command injection, path traversal, open redirects, session issues, info leakage, unsafe uploads, webhook/payment callback spoofing, rate-limit weaknesses
# Test/staging only — no destructive attacks on production
# Output: .test-results/security/security-report.md

# ============================================================
# PHASE 12 — PERFORMANCE TESTING
# ============================================================
# Measure: homepage, login, dashboards, member/transaction lists, reports, search, key APIs
# Data sizes: 10 / 50 / 100 / 500 / 1k members, 100k transactions
# Look for: N+1, unbounded queries, missing pagination, large payloads, slow server actions, excessive client render, memory issues
# Output: .test-results/system/performance.md

# ============================================================
# PHASE 13 — RESPONSIVE UI TESTING
# ============================================================
# Viewports: 320 / 375 / 768 / 1024 / 1440 px
# Check: navigation, dashboard, tables, forms, dialogs, modals, dropdowns, error/loading/empty/success states
# Look for: horizontal overflow, clipped controls, inaccessible forms, broken tables, unusable mobile nav
# Output: .test-results/system/responsive-ui.md

# ============================================================
# PHASE 14 — ACCESSIBILITY TESTING
# ============================================================
# Keyboard navigation, focus states, semantic HTML, labels, ARIA, contrast, screen-reader, form errors, modal focus, table a11y, skip links
# Test key workflows without mouse
# Output: .test-results/system/accessibility.md

# ============================================================
# PHASE 15 — USER ACCEPTANCE TESTING (UAT)
# ============================================================
# Personas & core tasks:
# Chairperson, Treasurer, Secretary, Member, Field Officer, Org Admin, Donor, Platform Admin
# For every workflow verify:
# 1. Task completable  2. Data correct  3. Permissions correct  4. Financials correct
# 5. Audit trail       6. Notifications correct  7. No duplicates  8. Error recovery
# 9. Mobile works      10. Result understandable
# Output: .test-results/uat/uat-results.md

# ============================================================
# PHASE 16 — REGRESSION TESTING
# ============================================================
# After any fix: reproduce → fix root cause → targeted test → related integration → full workflow → regression suite
# Never delete a failing test
# Output: .test-results/regression/regression-results.md

# ============================================================
# PHASE 17 — AUTOMATION
# ============================================================
# P0 (must automate): auth, AuthZ, financial calculations, payment processing + idempotency, org/group isolation, loan balances, transaction creation
# P1: meetings, members, reports, notifications, reminders, donor workflows
# P2: CMS/CRM/HRM/marketing/low-risk UI
# Prefer existing framework (Vitest/Jest + Playwright if compatible). Add minimal infrastructure only.

# ============================================================
# PHASE 18 — FINAL TEST REPORT
# ============================================================
# Create: .test-results/FINAL-TEST-REPORT.md
#
# Structure:
# 1. EXECUTIVE SUMMARY (objective findings only — use CRITICAL / HIGH / MEDIUM / LOW / INFORMATIONAL)
# 2. TEST COVERAGE table (Unit / Integration / System / UAT / Security / Payments / SMS / Email / A11y / Performance)
# 3. FAILED TESTS (ID, severity, area, env, preconditions, repro steps, expected, actual, evidence, root cause, recommended fix, regression test)
# 4–12. Findings by area (Security, AuthZ, Financial, Payments, SMS, Email, UAT, Performance, Accessibility)
# 13. BLOCKED / NOT TESTED (clearly distinguished from FAILED)
# 14. ROOT-CAUSE ANALYSIS
# 15. RECOMMENDED FIXES (prioritized)
# 16. AUTOMATED TESTS CREATED
# 17. REMAINING TESTS
# 18. PRODUCTION-READINESS CHECKLIST
#     [ ] Authentication  [ ] Authorization  [ ] Org isolation  [ ] Group isolation
#     [ ] Financial integrity  [ ] Payments  [ ] SMS  [ ] Email  [ ] Audit logging
#     [ ] Validation  [ ] Error handling  [ ] Security  [ ] Performance
#     [ ] Accessibility  [ ] Responsive UI  [ ] Backup/recovery  [ ] Monitoring
#     [ ] UAT  [ ] Regression coverage

# ============================================================
# FINAL RULE
# ============================================================
# A test is PASS only with objective evidence.
# A test is FAIL when expected ≠ actual.
# A test is BLOCKED when environment/dependency/credential prevents execution.
# A test is NOT TESTED when not executed.
# Never claim production readiness if critical workflows are failed, blocked, or untested.

Write-Host "`n=== Kitabu Yetu Production-Readiness Testing Prompt loaded ===" -ForegroundColor Green
Write-Host "Begin with Phase 0 discovery commands above, then proceed sequentially through all phases." -ForegroundColor Yellow
Write-Host "All reports must be written under .test-results/" -ForegroundColor Yellow