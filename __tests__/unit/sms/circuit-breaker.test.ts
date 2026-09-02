/**
 * lib/sms/circuit-breaker.ts (SMS-AUDIT-v3 T3-3). Pure in-memory module — no
 * mocks needed beyond controlling Date.now(), which is spied rather than
 * faked with Jest timers so each assertion states exactly what "now" is
 * without depending on fake-timer/Date interop.
 */
import {
  canAttempt, recordSuccess, recordFailure, circuitState, resetCircuit,
} from '@/lib/sms/circuit-breaker';

const PROVIDER = 'test-provider';

function openCircuit(name = PROVIDER, failures = 5): void {
  for (let i = 0; i < failures; i++) recordFailure(name);
}

describe('circuit breaker', () => {
  let now = 1_700_000_000_000;
  let dateSpy: jest.SpyInstance;

  beforeEach(() => {
    resetCircuit();
    now = 1_700_000_000_000;
    dateSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    dateSpy.mockRestore();
  });

  it('starts closed and stays closed on isolated successes', () => {
    expect(canAttempt(PROVIDER)).toBe(true);
    recordSuccess(PROVIDER);
    recordSuccess(PROVIDER);
    expect(canAttempt(PROVIDER)).toBe(true);
    expect(circuitState(PROVIDER).state).toBe('closed');
  });

  it('tolerates failures below the threshold', () => {
    recordFailure(PROVIDER);
    recordFailure(PROVIDER);
    recordFailure(PROVIDER);
    recordFailure(PROVIDER);
    expect(circuitState(PROVIDER).state).toBe('closed');
    expect(canAttempt(PROVIDER)).toBe(true);
  });

  it('a success resets the consecutive-failure count, so it does not carry over', () => {
    recordFailure(PROVIDER);
    recordFailure(PROVIDER);
    recordFailure(PROVIDER);
    recordFailure(PROVIDER);
    recordSuccess(PROVIDER);
    recordFailure(PROVIDER);
    recordFailure(PROVIDER);
    recordFailure(PROVIDER);
    recordFailure(PROVIDER);
    // 4 failures again, not the 5th of an unbroken run of 8 — still closed.
    expect(circuitState(PROVIDER).state).toBe('closed');
  });

  it('opens on the 5th CONSECUTIVE failure and fails fast', () => {
    openCircuit();
    const state = circuitState(PROVIDER);
    expect(state.state).toBe('open');
    expect(state.consecutiveFails).toBe(5);
    expect(canAttempt(PROVIDER)).toBe(false);
  });

  it('stays open and keeps failing fast before the cool-down elapses', () => {
    openCircuit();
    now += 59_000; // just under OPEN_DURATION_MS
    expect(canAttempt(PROVIDER)).toBe(false);
    expect(circuitState(PROVIDER).state).toBe('open');
  });

  it('half-opens for exactly one probe once the cool-down elapses', () => {
    openCircuit();
    now += 60_000; // OPEN_DURATION_MS

    // The probe call itself flips state to half_open and returns true...
    expect(canAttempt(PROVIDER)).toBe(true);
    expect(circuitState(PROVIDER).state).toBe('half_open');

    // ...but a second concurrent call must NOT get a second probe through
    // while the first is still in flight and unresolved.
    expect(canAttempt(PROVIDER)).toBe(false);
  });

  it('a successful half-open probe closes the circuit and clears the count', () => {
    openCircuit();
    now += 60_000;
    expect(canAttempt(PROVIDER)).toBe(true); // enters half_open

    recordSuccess(PROVIDER);

    const state = circuitState(PROVIDER);
    expect(state.state).toBe('closed');
    expect(state.consecutiveFails).toBe(0);
    expect(state.openedAt).toBeNull();
    expect(canAttempt(PROVIDER)).toBe(true);
  });

  it('a failed half-open probe re-opens the circuit immediately, restarting the cool-down', () => {
    openCircuit();
    now += 60_000;
    expect(canAttempt(PROVIDER)).toBe(true); // enters half_open

    recordFailure(PROVIDER);
    expect(circuitState(PROVIDER).state).toBe('open');

    // Cool-down restarted from THIS failure, not the original one — the old
    // 60s mark has already passed, so a stale openedAt would wrongly probe
    // again immediately.
    expect(canAttempt(PROVIDER)).toBe(false);
    now += 60_000;
    expect(canAttempt(PROVIDER)).toBe(true);
  });

  it('tracks independent circuits per provider name', () => {
    openCircuit('provider-a');
    expect(circuitState('provider-a').state).toBe('open');
    expect(circuitState('provider-b').state).toBe('closed');
    expect(canAttempt('provider-b')).toBe(true);
  });

  it('resetCircuit(name) clears only that provider', () => {
    openCircuit('provider-a');
    openCircuit('provider-b');
    resetCircuit('provider-a');
    expect(circuitState('provider-a').state).toBe('closed');
    expect(circuitState('provider-b').state).toBe('open');
  });

  it('resetCircuit() with no name clears every provider', () => {
    openCircuit('provider-a');
    openCircuit('provider-b');
    resetCircuit();
    expect(circuitState('provider-a').state).toBe('closed');
    expect(circuitState('provider-b').state).toBe('closed');
  });
});
