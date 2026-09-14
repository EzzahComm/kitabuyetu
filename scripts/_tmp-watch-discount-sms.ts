import { withAdminDb } from '@/lib/db';

const DEADLINE = Date.now() + 20 * 60 * 1000;

async function poll() {
  return withAdminDb(async (db) => {
    const { rows } = await db.query<{
      phone: string; st: string; provider_msg_id: string | null;
      retries: string | null; fail: string | null;
    }>(
      `SELECT u.recipient_phone AS phone, u.status::text AS st,
              u.provider_msg_id,
              f.retry_count::text AS retries,
              LEFT(COALESCE(f.failure_reason,''), 40) AS fail
         FROM sms_usage_logs u
         LEFT JOIN sms_failures f ON f.sms_log_id = u.id
        WHERE u.message_text LIKE '%has been discounted from%'
        ORDER BY u.recipient_phone`,
    );
    return rows;
  });
}

async function main() {
  for (;;) {
    const rows = await poll();
    const stamp = new Date().toISOString().slice(11, 19);
    const line = rows.map((r) => `${r.phone.slice(-4)}:${r.st}${r.retries ? `/r${r.retries}` : ''}`).join('  ');
    console.log(`[${stamp}] ${line}`);

    const settled = rows.every((r) => r.st === 'sent' || r.st === 'delivered');
    if (settled) {
      console.log('\nALL DELIVERED OR SENT:');
      for (const r of rows) console.log(`  ${r.phone} ${r.st} msgid=${r.provider_msg_id ?? '-'}`);
      return;
    }
    if (Date.now() > DEADLINE) {
      console.log('\nTIMED OUT — still not sent:');
      for (const r of rows) console.log(`  ${r.phone} ${r.st} retries=${r.retries ?? '-'} ${r.fail ?? ''}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 60_000));
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
