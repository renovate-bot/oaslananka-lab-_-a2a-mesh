import { describe, expect, it, vi } from 'vitest';
import {
  buildIdempotencyFingerprint,
  InMemoryIdempotencyStore,
  RedisIdempotencyStore,
  type RedisIdempotencyClient,
} from '../src/server/IdempotencyStore.js';

describe('IdempotencyStore', () => {
  it('builds stable fingerprints independent of object key order', () => {
    expect(buildIdempotencyFingerprint({ b: 2, a: { d: 4, c: [3, 2] } })).toBe(
      buildIdempotencyFingerprint({ a: { c: [3, 2], d: 4 }, b: 2 }),
    );
  });

  it('stores process-local records with TTL and clone isolation', async () => {
    vi.useFakeTimers();
    const store = new InMemoryIdempotencyStore();

    const record = await store.set(
      'tenant-a:user-a:route',
      'key-1',
      'fingerprint',
      { kind: 'success', value: { ok: true } },
      1000,
    );
    (record.result as { kind: 'success'; value: { ok: boolean } }).value.ok = false;

    expect(await store.get('tenant-a:user-a:route', 'key-1')).toEqual(
      expect.objectContaining({
        scope: 'tenant-a:user-a:route',
        key: 'key-1',
        fingerprint: 'fingerprint',
        result: { kind: 'success', value: { ok: true } },
      }),
    );

    vi.advanceTimersByTime(1001);
    await expect(store.get('tenant-a:user-a:route', 'key-1')).resolves.toBeNull();
    vi.useRealTimers();
  });

  it('stores Redis records with TTL and ignores expired payloads', async () => {
    const values = new Map<string, string>();
    const expirations = new Map<string, number>();
    const client: RedisIdempotencyClient = {
      get: vi.fn(async (key) => values.get(key) ?? null),
      set: vi.fn(async (key, value) => {
        values.set(key, value);
      }),
      pexpire: vi.fn(async (key, ttlMs) => {
        expirations.set(key, ttlMs);
        return 1;
      }),
    };
    const store = new RedisIdempotencyStore(client, 'prefix');

    const record = await store.set(
      'scope',
      'key',
      'fingerprint',
      { kind: 'error', error: { code: -32000, message: 'nope' } },
      500,
    );

    expect(record.result).toEqual({ kind: 'error', error: { code: -32000, message: 'nope' } });
    expect(expirations.get('prefix:scope:key')).toBe(500);
    await expect(store.get('scope', 'key')).resolves.toEqual(record);

    values.set(
      'prefix:scope:key',
      JSON.stringify({
        ...record,
        expiresAt: Date.now() - 1,
      }),
    );
    await expect(store.get('scope', 'key')).resolves.toBeNull();
  });
});
