import { resetCircuit } from '@/lib/sms/circuit-breaker';

// Same reasoning as jest.setup.ts's identical hook (see there for the full
// explanation) — the circuit breaker's module-level state is shared across
// every test case within one file, and resetting after each test keeps a
// real-outage-simulating case from leaving the circuit open for a later,
// unrelated one in the same file.
afterEach(() => resetCircuit());
