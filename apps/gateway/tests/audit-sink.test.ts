import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { processAuditArguments, sanitizeCsvCell, redactSensitiveKeys } from '../src/audit/redaction.js';
import { MongoAuditSink } from '../src/audit/sink.js';
import type { Db } from 'mongodb';
import type { Principal } from '../src/router/tool-router.js';

describe('Audit Redaction & Utilities', () => {
  it('redacts sensitive argument keys recursively', () => {
    const input = {
      product_id: 123,
      auth_token: 'secret-token-value',
      api_key: 'sensitive-api-key',
      nested: {
        password: 'pass',
        creditCard: '1234-5678-9012-3456',
        publicField: 'safe',
      },
      tags: ['electronics', 'gadgets'],
    };

    const redacted = redactSensitiveKeys(input) as any;
    expect(redacted.product_id).toBe(123);
    expect(redacted.auth_token).toBe('[REDACTED]');
    expect(redacted.api_key).toBe('[REDACTED]');
    expect(redacted.nested.password).toBe('[REDACTED]');
    expect(redacted.nested.creditCard).toBe('[REDACTED]');
    expect(redacted.nested.publicField).toBe('safe');
    expect(redacted.tags).toEqual(['electronics', 'gadgets']);
  });

  it('generates summary under 200 chars and deterministic hash', () => {
    const args = {
      status: 'processing',
      secret_key: 'ultra-secret',
      limit: 10,
    };

    const { argsSummary, argsHash } = processAuditArguments(args);
    expect(argsSummary).toContain('status=processing');
    expect(argsSummary).toContain('secret_key=[REDACTED]');
    expect(argsSummary.length).toBeLessThanOrEqual(200);
    expect(argsHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('sanitizes CSV cells to prevent CSV injection (DDE)', () => {
    // Formula injection triggers: =, +, -, @, \t, \r
    expect(sanitizeCsvCell('=cmd|/c calc')).toBe(`"'=cmd|/c calc"`);
    expect(sanitizeCsvCell('+1234')).toBe(`"'+1234"`);
    expect(sanitizeCsvCell('-5678')).toBe(`"'-5678"`);
    expect(sanitizeCsvCell('@SUM(A1:A10)')).toBe(`"'@SUM(A1:A10)"`);
    expect(sanitizeCsvCell('\tmalicious')).toBe(`"'\tmalicious"`);

    // Standard values without dangerous prefixes
    expect(sanitizeCsvCell('Normal Text')).toBe('"Normal Text"');
    expect(sanitizeCsvCell('Text with "quotes"')).toBe('"Text with ""quotes"""');
    expect(sanitizeCsvCell(null)).toBe('""');
  });
});

describe('MongoAuditSink', () => {
  let mockDb: any;
  let mockCollection: any;

  const testPrincipal: Principal = {
    userId: 'usr_test',
    role: 'member',
    via: 'apikey',
  };

  beforeEach(() => {
    mockCollection = {
      insertMany: vi.fn().mockResolvedValue({ insertedCount: 1 }),
    };
    mockDb = {
      collection: vi.fn().mockReturnValue(mockCollection),
    };
  });

  it('buffers and batches records, dropping oldest on capacity', async () => {
    const sink = new MongoAuditSink(mockDb as unknown as Db, undefined, {
      batchSize: 10,
      flushIntervalMs: 10000, // Do not auto-flush in this test
      maxQueueSize: 3,
    });

    // Record 4 items -> capacity is 3, 1st item should be dropped
    await sink.record({
      principal: testPrincipal,
      serverSlug: 'woo',
      toolName: 'tool1',
      exposedName: 'woo__tool1',
      durationMs: 10,
      outcome: 'success',
    });
    await sink.record({
      principal: testPrincipal,
      serverSlug: 'woo',
      toolName: 'tool2',
      exposedName: 'woo__tool2',
      durationMs: 20,
      outcome: 'success',
    });
    await sink.record({
      principal: testPrincipal,
      serverSlug: 'woo',
      toolName: 'tool3',
      exposedName: 'woo__tool3',
      durationMs: 30,
      outcome: 'success',
    });
    await sink.record({
      principal: testPrincipal,
      serverSlug: 'woo',
      toolName: 'tool4',
      exposedName: 'woo__tool4',
      durationMs: 40,
      outcome: 'success',
    });

    expect(sink.getQueueLength()).toBe(3);
    expect(sink.getDroppedCount()).toBe(1);

    await sink.flush();

    expect(mockCollection.insertMany).toHaveBeenCalledTimes(1);
    const inserted = mockCollection.insertMany.mock.calls[0][0];
    expect(inserted).toHaveLength(3);
    expect(inserted[0].tool).toBe('tool2'); // tool1 was dropped
    expect(inserted[1].tool).toBe('tool3');
    expect(inserted[2].tool).toBe('tool4');

    await sink.close();
  });

  it('retries with backoff on transient MongoDB error', async () => {
    let callCount = 0;
    mockCollection.insertMany = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount < 2) {
        throw new Error('MongoNetworkTimeout');
      }
      return { insertedCount: 1 };
    });

    const sink = new MongoAuditSink(mockDb as unknown as Db, undefined, {
      batchSize: 5,
      flushIntervalMs: 10000,
    });

    await sink.record({
      principal: testPrincipal,
      serverSlug: 'woo',
      toolName: 'tool1',
      exposedName: 'woo__tool1',
      durationMs: 15,
      outcome: 'success',
    });

    await sink.flush();

    expect(callCount).toBe(2);
    expect(sink.getQueueLength()).toBe(0);

    await sink.close();
  });
});
