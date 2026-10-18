import { parseExposedToolName } from '@conduit/shared';
import type { Db } from 'mongodb';
import type { FastifyBaseLogger } from 'fastify';
import type { ToolCatalogDocument } from '../db/types.js';
import type { UpstreamManager } from '../upstream/manager.js';
import type { ToolInvocationResult } from '../upstream/types.js';
import { toolCallsCounter, errorsCounter, toolLatencyHistogram } from '../metrics.js';

export interface Principal {
  userId: string;
  email?: string;
  role: 'admin' | 'member';
  via: 'apikey' | 'session';
  keyId?: string | null;
  source?: 'mcp' | 'chat';
  mustChangePassword?: boolean;
}

export interface PolicyEngine {
  evaluate(
    principal: Principal,
    serverSlug: string,
    toolName: string,
    annotations?: Record<string, unknown>,
    serverTrusted?: boolean,
  ): Promise<boolean>;
}

export class DefaultPolicyEngine implements PolicyEngine {
  async evaluate(
    _principal: Principal,
    _serverSlug: string,
    _toolName: string,
    _annotations?: Record<string, unknown>,
    _serverTrusted?: boolean,
  ): Promise<boolean> {
    return true;
  }
}

export interface RateLimiter {
  consume(key: string): Promise<{ allowed: boolean; retryAfterSeconds?: number }>;
}

export class NoopRateLimiter implements RateLimiter {
  async consume(_key: string): Promise<{ allowed: boolean }> {
    // Default no-op rate limiter fallback
    return { allowed: true };
  }
}

export interface AuditRecord {
  principal: Principal;
  serverSlug: string;
  toolName: string;
  exposedName: string;
  durationMs: number;
  outcome: 'success' | 'error' | 'timeout' | 'denied' | 'unreachable' | 'rate_limited' | 'invalid' | 'quarantined';
  errorMessage?: string;
  errorCode?: string;
  upstreamIsError?: boolean;
  args?: Record<string, unknown>;
  resultBytes?: number;
  requestId?: string;
  userEmail?: string;
  serverId?: string;
}

export interface AuditSink {
  record(audit: AuditRecord): Promise<void>;
}

export class LoggingAuditSink implements AuditSink {
  constructor(private readonly logger?: FastifyBaseLogger) {}

  async record(audit: AuditRecord): Promise<void> {
    this.logger?.info(
      {
        userId: audit.principal.userId,
        role: audit.principal.role,
        via: audit.principal.via,
        serverSlug: audit.serverSlug,
        tool: audit.toolName,
        exposedName: audit.exposedName,
        durationMs: audit.durationMs,
        outcome: audit.outcome,
        upstreamIsError: audit.upstreamIsError,
      },
      `Audit tool call: ${audit.exposedName} -> ${audit.outcome} (${audit.durationMs}ms)`,
    );
  }
}

export interface ExposedToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export class ToolRouter {
  constructor(
    private readonly db: Db,
    private readonly upstreamManager: UpstreamManager,
    private readonly policyEngine: PolicyEngine = new DefaultPolicyEngine(),
    private readonly rateLimiter: RateLimiter = new NoopRateLimiter(),
    private readonly auditSink: AuditSink = new LoggingAuditSink(),
    private readonly logger?: FastifyBaseLogger,
  ) {}

  /**
   * Returns union over servers where enabled && breaker != open && state == connected,
   * for tools that are approved.
   */
  async list(principal: Principal): Promise<ExposedToolDefinition[]> {
    const activeServers = this.upstreamManager
      .getAllServerStates()
      .filter((s) => s.server.enabled && s.breaker.phase !== 'open' && s.server.status?.state === 'connected');

    const result: ExposedToolDefinition[] = [];

    for (const serverState of activeServers) {
      const server = serverState.server;
      const serverId = server._id?.toString() ?? server.slug;

      const tools = await this.db
        .collection<ToolCatalogDocument>('tool_catalog')
        .find({
          serverId,
          'approval.status': 'approved',
          removedAt: null,
        })
        .toArray();

      for (const t of tools) {
        const allowed = await this.policyEngine.evaluate(
          principal,
          server.slug,
          t.name,
          t.annotations,
          server.trusted,
        );
        if (!allowed) {
          continue;
        }

        result.push({
          name: t.exposedName,
          description: `[${server.displayName}] ${t.description}`,
          inputSchema: t.inputSchema,
          annotations: t.annotations,
        });
      }
    }

    return result;
  }

  /**
   * Invokes an exposed tool by name `<slug>__<tool>`.
   * Enforces policy, rate limits, server state, and emits audit records.
   * Unknown, denied, and quarantined tools return identical "Unknown tool" error.
   */
  async call(
    principal: Principal,
    exposedName: string,
    args: Record<string, unknown>,
    ctx: { deadlineMs?: number } = {},
  ): Promise<ToolInvocationResult> {
    const startTime = Date.now();
    const parsed = parseExposedToolName(exposedName);

    if (!parsed) {
      toolCallsCounter.inc({ server: 'unknown', tool: exposedName, status: 'invalid' });
      errorsCounter.inc({ type: 'invalid', server: 'unknown' });
      await this.auditSink.record({
        principal,
        serverSlug: 'unknown',
        toolName: exposedName,
        exposedName,
        durationMs: Date.now() - startTime,
        outcome: 'invalid',
        errorMessage: 'Invalid exposed tool name format',
      });
      // Identical Unknown tool error per spec
      throw new Error(`Unknown tool "${exposedName}"`);
    }

    const { slug, toolPart } = parsed;
    const serverState = this.upstreamManager.getServerState(slug);

    if (!serverState || !serverState.server.enabled) {
      toolCallsCounter.inc({ server: slug, tool: toolPart, status: 'denied' });
      errorsCounter.inc({ type: 'server_disabled', server: slug });
      await this.auditSink.record({
        principal,
        serverSlug: slug,
        toolName: toolPart,
        exposedName,
        durationMs: Date.now() - startTime,
        outcome: 'denied',
      });
      throw new Error(`Unknown tool "${exposedName}"`);
    }

    const serverId = serverState.server._id?.toString() ?? serverState.server.slug;
    const catalogItem = await this.db.collection<ToolCatalogDocument>('tool_catalog').findOne({
      serverId,
      exposedName,
      removedAt: null,
    });

    if (!catalogItem || catalogItem.approval.status !== 'approved') {
      const outcome = catalogItem?.approval.status === 'changed' ? 'quarantined' : 'denied';
      toolCallsCounter.inc({ server: slug, tool: toolPart, status: outcome });
      errorsCounter.inc({ type: outcome, server: slug });
      await this.auditSink.record({
        principal,
        serverSlug: slug,
        toolName: toolPart,
        exposedName,
        durationMs: Date.now() - startTime,
        outcome,
      });
      // Leak prevention: identical Unknown tool error
      throw new Error(`Unknown tool "${exposedName}"`);
    }

    // Policy check
    const allowed = await this.policyEngine.evaluate(
      principal,
      slug,
      catalogItem.name,
      catalogItem.annotations,
      serverState.server.trusted,
    );
    if (!allowed) {
      toolCallsCounter.inc({ server: slug, tool: catalogItem.name, status: 'denied' });
      errorsCounter.inc({ type: 'policy_denied', server: slug });
      await this.auditSink.record({
        principal,
        serverSlug: slug,
        toolName: catalogItem.name,
        exposedName,
        durationMs: Date.now() - startTime,
        outcome: 'denied',
      });
      throw new Error(`Unknown tool "${exposedName}"`);
    }

    // Rate limiter check
    const rateLimit = await this.rateLimiter.consume(`user:${principal.userId}`);
    if (!rateLimit.allowed) {
      toolCallsCounter.inc({ server: slug, tool: catalogItem.name, status: 'rate_limited' });
      errorsCounter.inc({ type: 'rate_limited', server: slug });
      await this.auditSink.record({
        principal,
        serverSlug: slug,
        toolName: catalogItem.name,
        exposedName,
        durationMs: Date.now() - startTime,
        outcome: 'rate_limited',
      });
      throw new Error(`Rate limit exceeded for tool "${exposedName}"`);
    }

    try {
      const result = await this.upstreamManager.invokeTool(
        slug,
        catalogItem.name,
        args,
        { deadlineMs: ctx.deadlineMs },
      );

      const durationMs = Date.now() - startTime;
      const resultBytes = result?.content ? JSON.stringify(result.content).length : 0;
      const outcome = result.isError ? 'error' : 'success';

      toolCallsCounter.inc({ server: slug, tool: catalogItem.name, status: outcome });
      toolLatencyHistogram.observe({ server: slug, tool: catalogItem.name }, durationMs / 1000);
      if (result.isError) {
        errorsCounter.inc({ type: 'upstream_error', server: slug });
      }

      await this.auditSink.record({
        principal,
        serverId,
        serverSlug: slug,
        toolName: catalogItem.name,
        exposedName,
        args,
        resultBytes,
        durationMs,
        outcome,
        upstreamIsError: result.isError,
      });

      this.logger?.debug(
        { exposedName, slug, durationMs, isError: result.isError },
        'Tool call finished',
      );

      return result;
    } catch (err: unknown) {
      const durationMs = Date.now() - startTime;
      const errMsg = err instanceof Error ? err.message : String(err);
      const outcome = errMsg.includes('timeout') ? 'timeout' : 'error';

      toolCallsCounter.inc({ server: slug, tool: catalogItem.name, status: outcome });
      toolLatencyHistogram.observe({ server: slug, tool: catalogItem.name }, durationMs / 1000);
      errorsCounter.inc({ type: outcome, server: slug });

      await this.auditSink.record({
        principal,
        serverId,
        serverSlug: slug,
        toolName: catalogItem.name,
        exposedName,
        args,
        durationMs,
        outcome,
        errorMessage: errMsg,
      });

      throw err;
    }
  }
}
