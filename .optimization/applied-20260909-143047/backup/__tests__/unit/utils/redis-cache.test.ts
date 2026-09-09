jest.mock('@upstash/redis', () => ({
  Redis: jest.fn().mockImplementation(() => ({
    get: jest.fn(),
    set: jest.fn(),
  })),
}));

import { Redis } from '@upstash/redis';
import { cached } from '@/lib/redis';

// `lib/redis/index.ts` constructs its singleton client at module-load time,
// so the mocked constructor has already run once by the time this file's
// top-level code executes — grab that same instance via `mock.results`
// rather than a hand-rolled outer `const` (which Babel/SWC's import hoisting
// would reference before it's initialized, since jest.mock's factory runs at
// the hoisted `import` site — a TDZ crash, not a mocking bug).
const mockRedisClient = (Redis as unknown as jest.Mock).mock.results[0].value as {
  get: jest.Mock;
  set: jest.Mock;
};

describe('cached', () => {
  beforeEach(() => {
    mockRedisClient.get.mockReset();
    mockRedisClient.set.mockReset().mockResolvedValue('OK');
  });

  it('returns the cached value on a hit without calling fn', async () => {
    mockRedisClient.get.mockResolvedValue({ foo: 'bar' });
    const fn = jest.fn();

    const result = await cached('dashboard-hit', 60, fn);

    expect(result).toEqual({ foo: 'bar' });
    expect(fn).not.toHaveBeenCalled();
    expect(mockRedisClient.set).not.toHaveBeenCalled();
  });

  it('calls fn and stores the result on a cache miss', async () => {
    mockRedisClient.get.mockResolvedValue(null);
    const fn = jest.fn().mockResolvedValue({ foo: 'baz' });

    const result = await cached('dashboard-miss', 90, fn);

    expect(result).toEqual({ foo: 'baz' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(mockRedisClient.set).toHaveBeenCalledWith(
      expect.stringContaining('dashboard-miss'),
      { foo: 'baz' },
      { ex: 90 },
    );
  });

  it('fails open — a Redis read error still calls fn and returns its value', async () => {
    mockRedisClient.get.mockRejectedValue(new Error('read boom'));
    const fn = jest.fn().mockResolvedValue('value');

    const result = await cached('dashboard-read-error', 60, fn);

    expect(result).toBe('value');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('fails open — a Redis write error does not reject the call', async () => {
    mockRedisClient.get.mockResolvedValue(null);
    mockRedisClient.set.mockRejectedValue(new Error('write boom'));
    const fn = jest.fn().mockResolvedValue('value2');

    await expect(cached('dashboard-write-error', 60, fn)).resolves.toBe('value2');
  });
});
