import { createHash } from 'node:crypto';
import type { JsonRpcError } from '../types/jsonrpc.js';

export interface IdempotencySuccessResult {
  kind: 'success';
  value: unknown;
}

export interface IdempotencyFailureResult {
  kind: 'error';
  error: Pick<JsonRpcError, 'code' | 'message' | 'data'>;
}

export type IdempotencyStoredResult = IdempotencySuccessResult | IdempotencyFailureResult;

export interface IdempotencyRecord {
  scope: string;
  key: string;
  fingerprint: string;
  storedAt: string;
  expiresAt: number;
  result: IdempotencyStoredResult;
}

export interface IdempotencyStore {
  get(scope: string, key: string): Promise<IdempotencyRecord | null>;
  set(
    scope: string,
    key: string,
    fingerprint: string,
    result: IdempotencyStoredResult,
    ttlMs: number,
  ): Promise<IdempotencyRecord>;
}

export interface RedisIdempotencyClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  pexpire(key: string, ttlMs: number): Promise<number>;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();

  async get(scope: string, key: string): Promise<IdempotencyRecord | null> {
    this.pruneExpired();
    return structuredClone(this.records.get(this.buildKey(scope, key)) ?? null);
  }

  async set(
    scope: string,
    key: string,
    fingerprint: string,
    result: IdempotencyStoredResult,
    ttlMs: number,
  ): Promise<IdempotencyRecord> {
    this.pruneExpired();
    const record: IdempotencyRecord = {
      scope,
      key,
      fingerprint,
      storedAt: new Date().toISOString(),
      expiresAt: Date.now() + ttlMs,
      result: structuredClone(result),
    };
    this.records.set(this.buildKey(scope, key), record);
    return structuredClone(record);
  }

  private buildKey(scope: string, key: string): string {
    return `${scope}:${key}`;
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, record] of this.records.entries()) {
      if (record.expiresAt <= now) {
        this.records.delete(key);
      }
    }
  }
}

export class RedisIdempotencyStore implements IdempotencyStore {
  constructor(
    private readonly client: RedisIdempotencyClient,
    private readonly prefix = 'a2a:idempotency',
  ) {}

  async get(scope: string, key: string): Promise<IdempotencyRecord | null> {
    const record = await this.client.get(this.buildKey(scope, key));
    if (!record) {
      return null;
    }

    const parsed = JSON.parse(record) as IdempotencyRecord;
    if (parsed.expiresAt <= Date.now()) {
      return null;
    }

    return parsed;
  }

  async set(
    scope: string,
    key: string,
    fingerprint: string,
    result: IdempotencyStoredResult,
    ttlMs: number,
  ): Promise<IdempotencyRecord> {
    const record: IdempotencyRecord = {
      scope,
      key,
      fingerprint,
      storedAt: new Date().toISOString(),
      expiresAt: Date.now() + ttlMs,
      result,
    };
    const redisKey = this.buildKey(scope, key);
    await this.client.set(redisKey, JSON.stringify(record));
    await this.client.pexpire(redisKey, ttlMs);
    return record;
  }

  private buildKey(scope: string, key: string): string {
    return `${this.prefix}:${scope}:${key}`;
  }
}

export function buildIdempotencyFingerprint(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}
