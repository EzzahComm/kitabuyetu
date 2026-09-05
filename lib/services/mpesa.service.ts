/**
 * M-Pesa orchestration layer — public barrel.
 *
 * The implementation is split by concern across sibling `mpesa-*.service.ts`
 * files (OPTIMIZATION_CLEANUP_AUDIT.md High #9 — this file was previously
 * 3,126 lines mixing every M-Pesa flow):
 *
 *  - mpesa-spine.service.ts           payment-spine primitives (shared)
 *  - mpesa-payment-accounts.service.ts payment-identifier registry (shared)
 *  - mpesa-charges.service.ts         Safaricom fee handling (shared)
 *  - mpesa-allocation.service.ts      product-allocation/dispatch engine (shared, STK+C2B)
 *  - mpesa-stk.service.ts             STK push + callback
 *  - mpesa-c2b.service.ts             C2B validation + confirmation
 *  - mpesa-b2c.service.ts             B2C disbursement + result callback
 *  - mpesa-b2b.service.ts             B2B result callback
 *  - mpesa-airtime.service.ts         airtime purchase + result callback
 *  - mpesa-callbacks.service.ts       callback audit log, DLQ replay, misc callbacks
 *  - mpesa-reconciliation.service.ts  STK/paybill/charge reconciliation
 *  - mpesa-unrouted.service.ts        treasurer unrouted-receipt review
 *
 * This file re-exports the full public API so existing callers
 * (`@/lib/services/mpesa.service`) need no changes.
 */

export { assertSafaricomIp } from './daraja.service';

export {
  type StkPushParams,
  type StkPushResult,
  initiateSTKPush,
  type StkCallbackBody,
  type StkCallbackResult,
  handleSTKCallback,
} from './mpesa-stk.service';

export {
  registerC2BUrls,
  getC2BUrls,
  type C2BUrls,
  type C2BRegistrationResult,
  type C2BValidationVerdict,
  validateC2BAccount,
  type C2BCallbackBody,
  handleC2BConfirmation,
} from './mpesa-c2b.service';

export {
  type PaymentAccountHit,
  lookupPaymentAccount,
} from './mpesa-payment-accounts.service';

export {
  emitPaymentReceiptEvent,
} from './mpesa-spine.service';

export {
  logMpesaCallback,
  markCallbackProcessed,
  markCallbackError,
  replayUnprocessedCallbacks,
  handleReversalResult,
  handleBalanceResult,
  handleTransactionStatusResult,
  queryBalance,
} from './mpesa-callbacks.service';

export {
  type AirtimeParams,
  type AirtimeResult,
  initiateAirtime,
  handleAirtimeResult,
} from './mpesa-airtime.service';

export {
  type UnroutedRow,
  listUnrouted,
  resolveUnrouted,
} from './mpesa-unrouted.service';

export {
  type B2CParams,
  type B2CResult,
  initiateB2C,
  type B2CResultBody,
  handleB2CResult,
} from './mpesa-b2c.service';

export { handleB2BResult } from './mpesa-b2b.service';

export {
  type ReconciliationResult,
  runReconciliation,
  sweepPaybillTransactions,
  reconcileCharges,
} from './mpesa-reconciliation.service';
