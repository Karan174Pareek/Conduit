import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { UpstreamManager } from '../src/upstream/manager.js';
import { CredentialCrypto } from '../src/registry/crypto.js';
import { CatalogService } from '../catalog/service.js';
import type { Db } from 'mongodb';
import type { McpServerDocument } from '../src/db/types.js';

describe('Circuit Breaker & Bulkhead State Machine', () => {
  let mockDb: any;
  let mockCrypto: any;
  let mockCatalogService: any;
  let manager: UpstreamManager;

  const sampleServer: McpServerDocument = {
    slug: 'test-upstream',
    displayName: 'Test Upstream',
    url: 'http://localhost:9999/mcp',
    enabled: true,
    trusted: false,
    system: false,
    origin: 'admin',
    auth: { type: 'none' },
    callTimeoutMs: 1000,
    maxConcurrent: 2, // bulkhead capacity 2
    approveOnAdd: false,
    status: {
      state: 'connected',
      reasonCode: null,
      reason: null,
      checkedAt: null,
      lastSuccessAt: null,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.useFakeTimers();
    mockDb = {
      collection: vi.fn().mockReturnValue({
        find: vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([sampleServer]) }),
        updateOne: vi.fn().mockResolvedValue({}),
      }),
    };
    mockCrypto = {
      decryptCredential: vi.fn().mockReturnValue('super-secret-token-12345'),
      encryptCredential: vi.fn().mockReturnValue({ type: 'none' }),
    };
    mockCatalogService = {};

    manager = new UpstreamManager(mockDb as unknown as Db, mockCrypto as CredentialCrypto, mockCatalogService as CatalogService);
    manager.upsertServerState(sampleServer);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('scrubs secret credentials and Authorization headers from error messages', () => {
    const rawError = 'Request failed with Bearer secret-token-xyz and super-secret-token-12345';
    const scrubbed = manager.scrub(rawError, 'super-secret-token-12345');

    expect(scrubbed).not.toContain('super-secret-token-12345');
    expect(scrubbed).not.toContain('secret-token-xyz');
    expect(scrubbed).toContain('Bearer [REDACTED]');
    expect(scrubbed).toContain('[REDACTED]');
  });

  it('trips circuit breaker from closed to open after 3 consecutive failures', async () => {
    const state = manager.getServerState('test-upstream')!;
    expect(state.breaker.phase).toBe('closed');
    expect(state.breaker.consecutiveFailures).toBe(0);

    // Mock client failing
    vi.spyOn(manager, 'getOrCreateClient').mockRejectedValue(new Error('Connection refused'));

    // Attempt 1: fail
    await expect(manager.invokeTool('test-upstream', 'ping', {})).rejects.toThrow('upstream_unreachable');
    expect(state.breaker.phase).toBe('closed');
    expect(state.breaker.consecutiveFailures).toBe(1);

    // Attempt 2: fail
    await expect(manager.invokeTool('test-upstream', 'ping', {})).rejects.toThrow('upstream_unreachable');
    expect(state.breaker.phase).toBe('closed');
    expect(state.breaker.consecutiveFailures).toBe(2);

    // Attempt 3: fail -> trips to open
    await expect(manager.invokeTool('test-upstream', 'ping', {})).rejects.toThrow('upstream_unreachable');
    expect(state.breaker.phase).toBe('open');
    expect(state.breaker.consecutiveFailures).toBe(3);
    expect(state.breaker.openedAt).not.toBeNull();

    // Next call fails fast with circuit_open without attempting connection
    await expect(manager.invokeTool('test-upstream', 'ping', {})).rejects.toThrow('circuit_open');
  });

  it('transitions from open to half_open after backoff, and re-closes upon success', async () => {
    const state = manager.getServerState('test-upstream')!;
    state.breaker.phase = 'open';
    state.breaker.openedAt = Date.now();
    state.breaker.currentBackoffMs = 10000;

    // Before backoff expires: fails fast
    await expect(manager.invokeTool('test-upstream', 'ping', {})).rejects.toThrow('circuit_open');

    // Advance timers past backoff duration (10s + 20% max jitter = 12s)
    vi.advanceTimersByTime(15000);

    // Now allows probe into half_open
    const mockClient = {
      callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'pong' }] }),
    } as any;
    vi.spyOn(manager, 'getOrCreateClient').mockResolvedValue(mockClient);

    const result = await manager.invokeTool('test-upstream', 'ping', {});
    expect(result.content[0]?.text).toBe('pong');

    // Successful probe closes the breaker
    expect(state.breaker.phase).toBe('closed');
    expect(state.breaker.consecutiveFailures).toBe(0);
  });

  it('enforces bulkhead concurrency limit and fails fast with upstream_busy when full', async () => {
    const state = manager.getServerState('test-upstream')!;
    // Simulate 2 calls already in flight (maxConcurrent = 2)
    state.inFlightCalls = 2;

    await expect(manager.invokeTool('test-upstream', 'ping', {})).rejects.toThrow('upstream_busy');
    expect(manager.getMetrics().bulkheadRejections['test-upstream']).toBe(1);
  });
});
