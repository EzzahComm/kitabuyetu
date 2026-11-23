# Production monitoring

Use the deployment serving the configured application origin in the Vercel project dashboard. Check the linked Supabase and Upstash projects for database and Redis metrics.

## Health probes

Set `APP_ORIGIN` to the HTTPS origin being monitored. The liveness endpoint returns the application status. The authenticated deep probe checks PostgreSQL and Redis and returns 503 when either check fails.

```bash
curl -fsS "${APP_ORIGIN:?Set APP_ORIGIN}/api/health"
curl -fsS -H "x-worker-secret: ${WORKER_SECRET:?Set WORKER_SECRET}" "$APP_ORIGIN/api/health/deep"
```

Review errors in the current deployment logs and inspect job-queue status when either probe degrades. The [deployment guide](DEPLOY.md#5d-verify-the-schedule) has the scheduler and queue queries.

## Critical Metrics to Monitor

### **Application Health**

- [ ] Response time < 500ms (homepage)
- [ ] Error rate < 0.5%
- [ ] Uptime > 99.9%

### **Database**

- [ ] Connection pool: < 50% utilized
- [ ] Query latency: < 100ms (p95)
- [ ] Replication lag: < 1s

### **Authentication**

- [ ] Login success rate > 99%
- [ ] Token refresh working
- [ ] No auth errors in logs

### **Changi$ha Fundraising**

- [ ] Campaign creation: Working
- [ ] Campaign listing: Working
- [ ] Monitor failed or pending STK confirmations in the payment queue.

### **Infrastructure**

- [ ] Build time: < 5 minutes
- [ ] Deployment success: 100%
- [ ] No unhandled exceptions

---

## Weekly Checks

- [ ] Review error logs for patterns
- [ ] Check database backup status (Supabase)
- [ ] Verify RLS policies are enforced
- [ ] Check M-Pesa callback processing
- [ ] Review performance metrics (Vercel Analytics)

---

## Critical Alerts to Setup

**In Vercel:**

1. High error rate (> 1%)
2. Build failure
3. Deployment failure
4. Response time > 2s

**In Supabase:**

1. Database connection pool exhausted
2. Replication lag > 10s
3. Failed backups
4. High query latency (> 500ms)

---

## Recovery

For an application regression, promote the last known working deployment in Vercel and repeat both health probes. Check outstanding queue jobs before resuming any paused worker.

For a data incident, identify the affected time range and verify the Supabase backup in a recovery environment. Reconcile intervening ledger entries and payment callbacks before a production cutover. Share incident status and recovery progress through the support channel.
