# Chama SMS Reminder Troubleshooting Guide

## Overview

Chama Reminder SMS delivers scheduled messages to group members via SMS. This guide helps diagnose and fix issues when SMS is not being sent.

## Architecture

The SMS reminder system works through this pipeline:

```
┌─────────────────────────────────────────────────────┐
│ 1. SMS Schedule Created                              │
│    (sms_schedules table)                            │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│ 2. Job Processor (every 5 minutes)                  │
│    sms_process_schedules job                        │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│ 3. Process Due Schedules                            │
│    (processDueSmsSchedules)                         │
│    - Check if schedule is active                   │
│    - Check if next_run_at <= NOW()                │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│ 4. Resolve Recipients                              │
│    (resolveSmsRecipients)                          │
│    - Get all active members with phones            │
│    - Filter by recipient_type                      │
│    - Exclude opt-outs                              │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│ 5. Enqueue Bulk Send Job                           │
│    sms_bulk_send job                               │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│ 6. Send via Provider                               │
│    (sendBulkCampaign)                              │
│    - Reserve SMS credits                           │
│    - Create usage logs                             │
│    - Dispatch to TextSMS/Africastalking            │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│ 7. Track Delivery                                  │
│    - DLR (Delivery Receipt) polling                │
│    - Update message status (sent/failed)           │
│    - Retry failed messages                         │
└─────────────────────────────────────────────────────┘
```

## Common Issues & Solutions

### Issue 1: SMS Credits Exhausted (Most Common - 60%)

**Symptoms:**

- Schedule exists but SMS not sent
- Low balance alert notifications appear
- `sms_usage_logs.status = 'failed'` with error about credits

**Root Cause:**
The system reserves credits before sending. If insufficient credits, the entire batch is rejected and SMS sending is blocked.

**Solution:**

Option A - Purchase via M-Pesa (Preferred):

```
1. Group officer logs into dashboard
2. Settings → SMS Credits → "Buy Credits"
3. Select amount (KES 500, 1000, 5000, etc.)
4. Complete M-Pesa payment
5. Credits instantly available
```

Option B - Admin Grant (Testing/Support):

```sql
-- Check current balance
SELECT product, monthly_fee, sms_credits
FROM subscriptions
WHERE group_id = '550e8400-e29b-41d4-a716-446655440000';

-- Add test credits
UPDATE subscriptions
SET sms_credits = COALESCE(sms_credits, 0) + 1000
WHERE group_id = '550e8400-e29b-41d4-a716-446655440000';
```

**Verify Fix:**

```sql
SELECT COUNT(*) as sms_sent
FROM sms_usage_logs
WHERE group_id = '550e8400-e29b-41d4-a716-446655440000'
  AND status = 'sent'
  AND created_at > NOW() - INTERVAL '15 minutes';
```

---

### Issue 2: Schedule Not Active or Due (20%)

**Symptoms:**

- Schedule created but never fires
- `next_run_at` is NULL or far in the future
- No activity in `job_queue` for this schedule

**Cause:**

- Schedule `is_active = false`
- `next_run_at` is in the future
- No cron job processor running

**Solution:**

```sql
-- Check schedule status
SELECT id, name, is_active, schedule_type, next_run_at, last_run_at
FROM sms_schedules
WHERE group_id = '550e8400-e29b-41d4-a716-446655440000'
ORDER BY created_at DESC;

-- Activate schedule and set to run immediately
UPDATE sms_schedules
SET is_active = true,
    next_run_at = NOW()
WHERE group_id = '550e8400-e29b-41d4-a716-446655440000'
  AND is_active = false;
```

**Wait 5-10 minutes** for the `sms_process_schedules` job to execute.

---

### Issue 3: No Members with Phone Numbers (10%)

**Symptoms:**

- Members exist in group
- But SMS logs show 0 recipients
- Diagnostic: "Members with phone: 0"

**Cause:**
Members have no phone numbers or invalid format.

**Solution:**

```sql
-- Check members without phones
SELECT m.id, m.first_name, m.email
FROM members m
JOIN group_members gm ON gm.member_id = m.id
WHERE gm.group_id = '550e8400-e29b-41d4-a716-446655440000'
  AND (m.phone IS NULL OR m.phone = '');

-- Add phone number (must be E.164 format: +254...)
UPDATE members
SET phone = '+254712345678'
WHERE id = 'member-id-here';

-- Verify format
SELECT id, first_name, phone
FROM members
WHERE phone LIKE '+254%'
LIMIT 5;
```

---

### Issue 4: Stuck Reservations (Rare - 5%)

**Symptoms:**

- `sms_usage_logs.status = 'reserved'` for hours
- SMS credits stuck/unavailable
- Provider timeout or network error

**Cause:**
SMS log stuck in "reserved" state after provider call failed.

**Solution:**

```sql
-- Check stuck reservations
SELECT COUNT(*) as stuck_count,
  SUM(credits_reserved) as credits_tied_up,
  MAX(created_at) as oldest_stuck
FROM sms_usage_logs
WHERE group_id = '550e8400-e29b-41d4-a716-446655440000'
  AND status = 'reserved'
  AND created_at < NOW() - INTERVAL '1 hour';

-- Release stuck credits (safe if no active job)
BEGIN;
  UPDATE sms_usage_logs
  SET status = 'failed',
      failed_reason = 'released_stale_reservation',
      billing_state = 'refunded'
  WHERE group_id = '550e8400-e29b-41d4-a716-446655440000'
    AND status = 'reserved'
    AND created_at < NOW() - INTERVAL '1 hour'
    AND NOT EXISTS (
      SELECT 1 FROM job_queue
      WHERE type = 'sms_bulk_send'
        AND status NOT IN ('completed', 'failed')
        AND (payload->>'groupId') =
            '550e8400-e29b-41d4-a716-446655440000'
    );
COMMIT;
```

---

### Issue 5: All Members Opted Out (5%)

**Symptoms:**

- Schedule fires but 0 SMS delivered
- Diagnostic shows all members opted out

**Cause:**
Incorrect opt-outs or bulk opt-out event.

**Solution:**

```sql
-- Check opt-outs
SELECT COUNT(*) as opt_out_count
FROM sms_opt_outs
WHERE group_id = '550e8400-e29b-41d4-a716-446655440000';

-- Review who opted out
SELECT phone, created_at FROM sms_opt_outs
WHERE group_id = '550e8400-e29b-41d4-a716-446655440000'
ORDER BY created_at DESC;

-- Clear opt-outs (if confirmed incorrect)
DELETE FROM sms_opt_outs
WHERE group_id = '550e8400-e29b-41d4-a716-446655440000';
```

---

## Diagnostic Commands

### Quick Health Check

```bash
# Run diagnostic script
chmod +x docs/diagnose-sms-issue.sh
./docs/diagnose-sms-issue.sh 550e8400-e29b-41d4-a716-446655440000
```

### Database Queries

```sql
-- 1. Check subscription status
SELECT product, status, monthly_fee, sms_credits
FROM subscriptions
WHERE group_id = '550e8400-e29b-41d4-a716-446655440000';

-- 2. Check active schedules
SELECT id, name, is_active, next_run_at
FROM sms_schedules
WHERE group_id = '550e8400-e29b-41d4-a716-446655440000'
ORDER BY created_at DESC;

-- 3. Check recent SMS activity
SELECT DATE(created_at) as date, status, COUNT(*) as count
FROM sms_usage_logs
WHERE group_id = '550e8400-e29b-41d4-a716-446655440000'
GROUP BY DATE(created_at), status
ORDER BY date DESC;

-- 4. Check job queue
SELECT type, status, COUNT(*), MAX(created_at)
FROM job_queue
WHERE type IN ('sms_process_schedules', 'sms_bulk_send')
GROUP BY type, status
ORDER BY MAX(created_at) DESC;

-- 5. Check for low balance alerts
SELECT COUNT(*) FROM job_queue
WHERE type = 'sms_low_balance_alert'
  AND payload->>'groupId' = '550e8400-e29b-41d4-a716-446655440000'
  AND created_at > NOW() - INTERVAL '7 days';
```

---

## Testing

### Test 1: Send Single SMS

```bash
curl -X POST http://localhost:3000/api/v1/sms/send \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+254712345678",
    "message": "Test SMS",
    "referenceType": "test",
    "referenceId": "test-001"
  }'
```

### Test 2: Trigger Schedule

```sql
UPDATE sms_schedules
SET next_run_at = NOW()
WHERE group_id = '550e8400-e29b-41d4-a716-446655440000'
  AND is_active = true;

-- Wait 5 minutes, then check
SELECT COUNT(*) as sms_sent
FROM sms_usage_logs
WHERE group_id = '550e8400-e29b-41d4-a716-446655440000'
  AND created_at > NOW() - INTERVAL '10 minutes';
```

---

## Monitoring

### Key Metrics to Watch

```sql
-- Daily SMS usage
SELECT DATE(created_at) as date,
  COUNT(*) as total_sms,
  SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) as sent,
  SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed,
  SUM(credits_deducted) as credits_spent
FROM sms_usage_logs
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- Credit burn rate (last 7 days)
SELECT
  COUNT(*) as sms_sent,
  SUM(credits_deducted) as total_credits,
  SUM(credits_from_allowance) as from_allowance,
  SUM(credits_deducted - credits_from_allowance) as from_paid
FROM sms_usage_logs
WHERE created_at > NOW() - INTERVAL '7 days'
  AND status = 'sent';

-- Job execution health
SELECT type, COUNT(*) as executed,
  SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as successful,
  SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed
FROM job_queue
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY type;
```

---

## Code References

### Key Files

- **Schedule Processing**: `lib/services/sms-scheduler.service.ts`
  - `processDueSmsSchedules()` - Main scheduler
  - `claimOccurrence()` - Atomic claim logic

- **SMS Sending**: `lib/services/sms.service.ts`
  - `sendBulkCampaign()` - Core send logic
  - `reserveCredits()` - Credit validation

- **Job Handler**: `lib/jobs/handlers.ts`
  - `handleSmsProcessSchedules()` - Cron job entry point
  - `handleSmsBulkSend()` - Bulk send execution

- **Recipient Resolution**: `lib/services/sms.service.ts:342`
  - `resolveSmsRecipients()` - Filtering logic

### Key Tables

- `sms_schedules` - Scheduled reminder configurations
- `sms_usage_logs` - All SMS activity and billing
- `sms_opt_outs` - Members who opted out
- `job_queue` - Asynchronous job execution
- `subscriptions` - Group billing and SMS credits

---

## Escalation

If issues persist after all checks:

1. **Verify database connectivity**
2. **Check Vercel function logs** for job processor errors
3. **Test provider directly** (TextSMS/Africastalking)
4. **Review SMS provider health** monitoring
5. **Contact support** with diagnostic report

---

## See Also

- [SMS Architecture](./sms-architecture.md)
- [Billing & Credits](./sms-billing.md)
- [Provider Integration](./sms-providers.md)
