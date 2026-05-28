-- =============================================================================
-- 048_mpesa_airtime_type.sql
-- Adds the 'airtime' value to the mpesa_tx_type enum so airtime purchases
-- (funded from the Airtime Purchase sub-account, 500020109900232311) are a
-- first-class transaction type in the ledger rather than masquerading as B2C.
--
-- PostgreSQL 12+ permits ADD VALUE inside a transaction as long as the new
-- value isn't *used* in the same transaction. The migrate runner wraps each
-- file in BEGIN/COMMIT; we only add the label here, so this is safe.
-- =============================================================================

ALTER TYPE mpesa_tx_type ADD VALUE IF NOT EXISTS 'airtime';

-- Matching callback-type labels so the raw airtime callbacks are audited
-- honestly in mpesa_callbacks rather than masquerading as b2c_result.
ALTER TYPE mpesa_callback_type ADD VALUE IF NOT EXISTS 'airtime_result';
ALTER TYPE mpesa_callback_type ADD VALUE IF NOT EXISTS 'airtime_timeout';
