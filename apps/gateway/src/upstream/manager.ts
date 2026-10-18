import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Db } from 'mongodb';
import { ConduitError, formatGatewayErrorMessage } from '@conduit/shared';
import type { FastifyBaseLogger } from 'fastify';
import type { McpServerDocument } from '../db/types.js';
import { CredentialCrypto } from '../registry/crypto.js';
import { CatalogService } from '../catalog/service.js';
import { createSecureFetch } from '../registry/secure-fetch.js';
import type {
  InvokeToolOptions,
  ToolInvocationResult,
  UpstreamMetrics,
  UpstreamServerState,
} from './types.js';

export const MAX_RESULT_BYTES = 1024 * 1024; // 1 MB
export const DEFAULT_CALL_TIMEOUT_MS = 30000;
export const MAX_CALL_TIMEOUT_MS = 120000;
export const CONNECT_TIMEOUT_MS = 3000;
export const PING_TIMEOUT_MS = 2000;

export class UpstreamManager {
  private readonly statesBySlug = new Map<string, UpstreamServerState>();
  private readonly statesById = new Map<string, UpstreamServerState>();
  private healthIntervalTimer: NodeJS.Timeout | null = null;
  private catalogIntervalTimer: NodeJS.Timeout | null = null;
  private isShuttingDown = false;

  private readonly metrics: UpstreamMetrics = {
    totalCalls: {},
    failuresByOutcome: {},
    bulkheadRejections: {},
  };

  constructor(
    private readonly db: Db,
    private readonly crypto: CredentialCrypto,
    private readonly catalogService: CatalogService,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  /**
   * Initializes or updates server state from MongoDB.
   */
  async loadServers(): Promise<void> {
    const servers = await this.db.collection<McpServerDocument>('mcp_servers').find().toArray();
    for (const server of servers) {
      await this.upsertServerState(server);
    }
  }

  async upsertServerState(server: McpServerDocument): Promise<void> {
    const serverId = server._id?.toString() ?? server.slug;
    const existing = this.statesBySlug.get(server.slug);

    let decryptedCredential = '';
    try {
      decryptedCredential = this.crypto.decryptCredential(serverId, server.auth);
    } catch {
      // Credential decryption failure will surface as upstream_auth_failed when connecting
    }

    if (existing) {
      existing.server = server;
      existing.decryptedCredential = decryptedCredential;
      return;
    }

    const state: UpstreamServerState = {
      server,
      client: null,
      transport: null,
      decryptedCredential,
      breaker: {
        phase: 'closed',
        consecutiveFailures: 0,
        openedAt: null,
        currentBackoffMs: 10000,
        halfOpenProbeInFlight: false,
      },
      inFlightCalls: 0,
      lastHealthCheckAt: null,
      lastSuccessAt: null,
      lastError: null,
    };

    this.statesBySlug.set(server.slug, state);
    this.statesById.set(serverId, state);
  }

  getServerState(slug: string): UpstreamServerState | undefined {
    return this.statesBySlug.get(slug);
  }

  getServerStateById(id: string): UpstreamServerState | undefined {
    return this.statesById.get(id);
  }

  getAllServerStates(): UpstreamServerState[] {
    return Array.from(this.statesBySlug.values());
  }

  /**
   * Scrubs any sensitive credentials or Authorization headers from message strings.
   */
  scrub(message: string, credential?: string): string {
    if (!message) return '';
    let cleaned = message.replace(/Bearer\s+[a-zA-Z0-9_\-.]+/gi, 'Bearer [REDACTED]');
    cleaned = cleaned.replace(/Basic\s+[a-zA-Z0-9+/=]+/gi, 'Basic [REDACTED]');
    cleaned = cleaned.replace(/Authorization:\s*(?:Bearer|Basic)?\s*([^\s,;]+)/gi, 'Authorization: [REDACTED]');
    if (credential && credential.trim().length > 0) {
      cleaned = cleaned.split(credential).join('[REDACTED]');
    }
    return cleaned;
  }

  /**
   * Starts background health check and catalog refresh loops.
   */
  startBackgroundLoops(): void {
    if (this.healthIntervalTimer) return;

    // Immediately run initial health check and catalog refresh on startup
    void this.runHealthLoop().then(() => void this.runCatalogRefreshLoop());

    // Health check loop every 15s with jitter
    this.healthIntervalTimer = setInterval(() => {
      if (this.isShuttingDown) return;
      void this.runHealthLoop();
    }, 15000);

    // Catalog refresh loop every 60s
    this.catalogIntervalTimer = setInterval(() => {
      if (this.isShuttingDown) return;
      void this.runCatalogRefreshLoop();
    }, 60000);
  }

  stopBackgroundLoops(): void {
    this.isShuttingDown = true;
    if (this.healthIntervalTimer) {
      clearInterval(this.healthIntervalTimer);
      this.healthIntervalTimer = null;
    }
    if (this.catalogIntervalTimer) {
      clearInterval(this.catalogIntervalTimer);
      this.catalogIntervalTimer = null;
    }
  }

  /**
   * Establishes or returns an active client connection to the upstream server.
   */
  async getOrCreateClient(state: UpstreamServerState): Promise<Client> {
    if (state.client) {
      return state.client;
    }

    const headers: Record<string, string> = {};
    if (state.decryptedCredential) {
      if (state.server.auth.type === 'bearer') {
        headers['Authorization'] = `Bearer ${state.decryptedCredential}`;
      } else if (state.server.auth.type === 'header' && state.server.auth.headerName) {
        headers[state.server.auth.headerName] = state.decryptedCredential;
      }
    }

    const transport = new StreamableHTTPClientTransport(new URL(state.server.url), {
      fetch: createSecureFetch(),
      requestInit: { headers, redirect: 'error' },
      redirectPolicy: 'same-origin',
    });

    const client = new Client(
      { name: 'conduit-gateway', version: '0.1.0' },
      { capabilities: {} },
    );

    const connectTimeoutPromise = new Promise<never>((_, reject) => {
      const t = setTimeout(() => {
        reject(new Error(`Upstream connection timed out after ${CONNECT_TIMEOUT_MS}ms`));
      }, CONNECT_TIMEOUT_MS);
      t.unref?.();
    });

    try {
      await Promise.race([client.connect(transport), connectTimeoutPromise]);
      state.client = client;
      state.transport = transport;
      return client;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.recordBreakerFailure(state, 'connect_failed', errMsg);
      throw this.mapUpstreamError(state, err);
    }
  }

  /**
   * Invokes an upstream tool via the client.
   * Enforces circuit breaker, bulkhead, deadline, cancellation, size cap, and error taxonomy.
   */
  async invokeTool(
    serverSlug: string,
    toolName: string,
    toolArgs: Record<string, unknown>,
    options: InvokeToolOptions = {},
  ): Promise<ToolInvocationResult> {
    const state = this.statesBySlug.get(serverSlug);
    if (!state || !state.server.enabled) {
      throw new ConduitError({
        code: 'upstream_disabled',
        message: formatGatewayErrorMessage('upstream_disabled', serverSlug),
        statusCode: 403,
      });
    }

    // 1. Circuit breaker check
    this.checkCircuitBreaker(state);

    // 2. Bulkhead check
    const maxConcurrent = state.server.maxConcurrent || 8;
    if (state.inFlightCalls >= maxConcurrent) {
      this.metrics.bulkheadRejections[serverSlug] = (this.metrics.bulkheadRejections[serverSlug] || 0) + 1;
      throw new ConduitError({
        code: 'upstream_busy',
        message: formatGatewayErrorMessage('upstream_busy', serverSlug, 'Upstream is at capacity; failing fast'),
        statusCode: 503,
      });
    }

    state.inFlightCalls++;
    this.metrics.totalCalls[serverSlug] = (this.metrics.totalCalls[serverSlug] || 0) + 1;

    const callTimeout = Math.min(
      state.server.callTimeoutMs || DEFAULT_CALL_TIMEOUT_MS,
      options.deadlineMs ?? MAX_CALL_TIMEOUT_MS,
    );

    const abortController = new AbortController();
    const timer = setTimeout(() => {
      abortController.abort(new Error(`Upstream call timed out after ${callTimeout}ms`));
    }, callTimeout);

    try {
      const client = await this.getOrCreateClient(state);

      const callPromise = client.callTool(
        { name: toolName, arguments: toolArgs },
        undefined,
        { signal: abortController.signal },
      );

      const result = await callPromise;
      clearTimeout(timer);

      // 3. Response size cap check (1 MB)
      const serialized = JSON.stringify(result);
      if (Buffer.byteLength(serialized, 'utf-8') > MAX_RESULT_BYTES) {
        throw new ConduitError({
          code: 'result_too_large',
          message: formatGatewayErrorMessage('result_too_large', serverSlug, 'Response size exceeded 1MB limit'),
          statusCode: 413,
        });
      }

      // Record success in breaker
      this.recordBreakerSuccess(state);

      return {
        content: result.content as Array<{ type: string; text?: string; [key: string]: unknown }>,
        isError: result.isError === true,
      };
    } catch (err: unknown) {
      clearTimeout(timer);
      const isAbort = abortController.signal.aborted;
      if (isAbort) {
        this.recordBreakerFailure(state, 'timeout', `Upstream call timed out after ${callTimeout}ms`);
        throw new ConduitError({
          code: 'upstream_timeout',
          message: formatGatewayErrorMessage('upstream_timeout', serverSlug, 'Call timed out; request dropped'),
          statusCode: 504,
        });
      }

      if (err instanceof ConduitError) {
        throw err;
      }

      const mapped = this.mapUpstreamError(state, err);
      // Tool-level isError from upstream does NOT count as circuit breaker failure
      if (mapped.code !== 'upstream_tool_error') {
        this.recordBreakerFailure(state, mapped.code, mapped.message);
      }
      throw mapped;
    } finally {
      state.inFlightCalls = Math.max(0, state.inFlightCalls - 1);
    }
  }

  /**
   * Health loop probe per server.
   */
  async runHealthLoop(): Promise<void> {
    for (const state of this.statesBySlug.values()) {
      if (!state.server.enabled) continue;

      try {
        const client = await this.getOrCreateClient(state);
        try {
          const pingPromise = client.ping();
          const timeoutPromise = new Promise<never>((_, reject) => {
            const t = setTimeout(() => reject(new Error('Ping timeout')), PING_TIMEOUT_MS);
            t.unref?.();
          });
          await Promise.race([pingPromise, timeoutPromise]);
        } catch (pingErr: unknown) {
          const errMsg = pingErr instanceof Error ? pingErr.message : String(pingErr);
          // If server does not implement ping (Method not found / code -32601), fall back to listTools
          if (errMsg.includes('Method not found') || (pingErr as { code?: number })?.code === -32601) {
            await client.listTools();
          } else {
            throw pingErr;
          }
        }

        this.recordBreakerSuccess(state);
        state.lastSuccessAt = new Date();
        state.lastHealthCheckAt = new Date();
        await this.persistServerStatus(state, 'connected', null, null);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.recordBreakerFailure(state, 'health_ping_failed', msg);
        state.lastHealthCheckAt = new Date();
        await this.persistServerStatus(state, 'unreachable', 'connect_failed', this.scrub(msg, state.decryptedCredential));
      }
    }
  }

  /**
   * Refreshes tool catalog for a single upstream server.
   */
  async refreshServerCatalog(state: UpstreamServerState): Promise<void> {
    if (!state.server.enabled || state.breaker.phase === 'open') return;

    try {
      const client = await this.getOrCreateClient(state);
      const toolsResult = await client.listTools();
      await this.catalogService.reconcileTools(state.server, toolsResult.tools);
    } catch (err: unknown) {
      this.logger?.debug(
        { serverSlug: state.server.slug, error: err instanceof Error ? err.message : String(err) },
        'Catalog refresh failed',
      );
    }
  }

  /**
   * Catalog refresh loop.
   */
  async runCatalogRefreshLoop(): Promise<void> {
    for (const state of this.statesBySlug.values()) {
      await this.refreshServerCatalog(state);
    }
  }

  private checkCircuitBreaker(state: UpstreamServerState): void {
    const breaker = state.breaker;
    if (breaker.phase === 'closed') {
      return;
    }

    const now = Date.now();
    if (breaker.phase === 'open') {
      const jitterFactor = 0.8 + Math.random() * 0.4; // +/- 20% jitter
      const effectiveBackoff = breaker.currentBackoffMs * jitterFactor;

      if (breaker.openedAt && now - breaker.openedAt >= effectiveBackoff) {
        breaker.phase = 'half_open';
        breaker.halfOpenProbeInFlight = false;
      } else {
        throw new ConduitError({
          code: 'circuit_open',
          message: formatGatewayErrorMessage('circuit_open', state.server.slug, 'Circuit breaker open; failing fast'),
          statusCode: 503,
        });
      }
    }

    if (breaker.phase === 'half_open') {
      if (breaker.halfOpenProbeInFlight) {
        throw new ConduitError({
          code: 'circuit_open',
          message: formatGatewayErrorMessage('circuit_open', state.server.slug, 'Circuit breaker testing in progress'),
          statusCode: 503,
        });
      }
      breaker.halfOpenProbeInFlight = true;
    }
  }

  private recordBreakerSuccess(state: UpstreamServerState): void {
    const wasBroken = state.breaker.phase !== 'closed';
    state.breaker.phase = 'closed';
    state.breaker.consecutiveFailures = 0;
    state.breaker.openedAt = null;
    state.breaker.currentBackoffMs = 10000;
    state.breaker.halfOpenProbeInFlight = false;
    if (wasBroken) {
      void this.refreshServerCatalog(state);
    }
  }

  private recordBreakerFailure(state: UpstreamServerState, code: string, rawMessage: string): void {
    const breaker = state.breaker;
    breaker.consecutiveFailures++;
    state.lastError = {
      code,
      message: this.scrub(rawMessage, state.decryptedCredential),
      at: new Date(),
    };

    if (breaker.phase === 'half_open' || breaker.consecutiveFailures >= 3) {
      breaker.phase = 'open';
      breaker.openedAt = Date.now();
      breaker.currentBackoffMs = Math.min(breaker.currentBackoffMs * 2, 60000);
      breaker.halfOpenProbeInFlight = false;
      // Invalidate connection client on hard failure
      state.client = null;
      state.transport = null;
    }

    void this.persistServerStatus(
      state,
      'unreachable',
      code,
      this.scrub(rawMessage, state.decryptedCredential),
    );
  }

  private mapUpstreamError(state: UpstreamServerState, err: unknown): ConduitError {
    const rawMsg = err instanceof Error ? err.message : String(err);
    const scrubbedMsg = this.scrub(rawMsg, state.decryptedCredential);

    if (rawMsg.includes('401') || rawMsg.includes('403') || rawMsg.includes('Unauthorized')) {
      return new ConduitError({
        code: 'upstream_auth_failed',
        message: formatGatewayErrorMessage('upstream_auth_failed', state.server.slug, 'Credential rejected by upstream'),
        statusCode: 502,
      });
    }

    if (rawMsg.includes('JSON') || rawMsg.includes('protocol') || rawMsg.includes('Unexpected token')) {
      return new ConduitError({
        code: 'upstream_protocol_error',
        message: formatGatewayErrorMessage('upstream_protocol_error', state.server.slug, 'Invalid protocol response'),
        statusCode: 502,
      });
    }

    if (rawMsg.includes('ECONNREFUSED') || rawMsg.includes('ETIMEDOUT') || rawMsg.includes('ENOTFOUND') || rawMsg.includes('fetch failed')) {
      return new ConduitError({
        code: 'upstream_unreachable',
        message: formatGatewayErrorMessage('upstream_unreachable', state.server.slug, 'Connection refused or host unreachable'),
        statusCode: 502,
      });
    }

    return new ConduitError({
      code: 'upstream_unreachable',
      message: formatGatewayErrorMessage('upstream_unreachable', state.server.slug, scrubbedMsg),
      statusCode: 502,
    });
  }

  private async persistServerStatus(
    state: UpstreamServerState,
    statusState: 'connected' | 'unreachable' | 'disabled',
    reasonCode: string | null,
    reason: string | null,
  ): Promise<void> {
    const serverId = state.server._id;
    if (!serverId) return;

    const statusObj = {
      state: statusState,
      reasonCode,
      reason,
      checkedAt: new Date(),
      lastSuccessAt: state.lastSuccessAt,
    };
    state.server.status = statusObj;

    try {
      await this.db.collection('mcp_servers').updateOne(
        { _id: serverId },
        {
          $set: {
            status: statusObj,
          },
        },
      );
    } catch {
      // Best effort status persistence; last-writer-wins
    }
  }

  getMetrics(): UpstreamMetrics {
    return this.metrics;
  }
}
