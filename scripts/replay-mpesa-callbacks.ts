/**
 * Manually trigger the M-Pesa callback DLQ replay (normally runs every 5
 * minutes via the mpesa_replay_callbacks job — lib/jobs/index.ts). Useful
 * right after fixing a bug that was causing callbacks to fail processing:
 * reprocesses every mpesa_callbacks row still marked unprocessed instead of
 * waiting for the next scheduled tick.
 *
 *   npx tsx scripts/replay-mpesa-callbacks.ts
 *
 * Safe to run any time — the same idempotency guards the real callback
 * routes rely on (ON CONFLICT DO NOTHING, status-guarded UPDATEs) apply here
 * too, since this calls the exact same handleSTKCallback/handleC2BConfirmation
 * functions, not a separate reimplementation.
 */
import { replayUnprocessedCallbacks } from '../lib/services/mpesa.service';

async function main() {
  const result = await replayUnprocessedCallbacks();
  console.log(JSON.stringify(result, null, 2));
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
