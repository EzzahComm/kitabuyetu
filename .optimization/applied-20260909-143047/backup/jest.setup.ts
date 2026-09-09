import '@testing-library/jest-dom';
import { resetCircuit } from '@/lib/sms/circuit-breaker';

// The SMS provider circuit breaker (SMS-AUDIT-v3 T3-3) holds process-lifetime
// state by design (lib/sms/circuit-breaker.ts). Jest gives each test FILE its
// own module registry, so this can't leak across files — but every `it()`/
// `test()` within one file shares the same loaded instance. A test that
// simulates ≥5 consecutive provider failures to exercise an outage path would
// otherwise leave the circuit open for every case that runs after it in that
// same file, turning an unrelated later assertion into a flake that has
// nothing to do with what it's testing. Reset after every test,
// unconditionally — cheap (an in-memory Map clear) and correct for files that
// never touch SMS at all.
afterEach(() => resetCircuit());
