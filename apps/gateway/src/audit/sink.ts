import type { Db } from 'mongodb';
import type { FastifyBaseLogger } from 'fastify';
import type { ToolCallDocument } from '../db/types.js';
import type { AuditRecord, AuditSink } from '../router/tool-router.js';
import { processAuditArguments } from './redaction.js';

export interface MongoAuditSinkOptions {
  batchSize?: number;
  flushIntervalMs?: number;
  maxQueueSize?: number;
}

export class MongoAuditSink implements AuditSink {
  private readonly queue: ToolCallDocument[] = [];
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private readonly maxQueueSize: number;
  private droppedCount = 0;
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing = false;
  private isClosed = false;

  constructor(
    private readonly db: Db,
    private readonly logger?: FastifyBaseLogger,
    options: MongoAuditSinkOptions = {},
  ) {
    this.batchSize = options.batchSize ?? 50;
    this.flushIntervalMs = options.flushIntervalMs ?? 250;
    this.maxQueueSize = options.maxQueueSize ?? 10000;

    this.flushTimer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);

    // Ensure timer doesn't prevent process from exiting if unref is supported
    if (this.flushTimer.unref) {
      this.flushTimer.unref();
    }
  }

  /**
   * Enqueues an audit record for asynchronous persistence.
   * Drops the oldest record if buffer exceeds max capacity.
   */
  async record(audit: AuditRecord): Promise<void> {
    if (this.isClosed) {
      this.logger?.warn('MongoAuditSink is closed; dropping audit record');
      return;
    }

    const { argsSummary, argsHash } = processAuditArguments(audit.args ?? {});

    const doc: ToolCallDocument = {
      ts: new Date(),
      requestId: audit.requestId ?? '',
      userId: audit.principal.userId,
      userEmail: audit.userEmail ?? (audit.principal.userId.includes('@') ? audit.principal.userId : ''),
      role: audit.principal.role,
      via: audit.principal.via,
      keyId: audit.principal.keyId ?? null,
      source: audit.principal.source ?? 'mcp',
      conversationId: null,
      serverId: audit.serverId,
      serverSlug: audit.serverSlug,
      tool: audit.toolName,
      exposedName: audit.exposedName,
      durationMs: audit.durationMs,
      outcome: audit.outcome,
      errorCode: audit.errorCode ?? null,
      errorMessage: audit.errorMessage ?? null,
      argsSummary,
      argsHash,
      resultBytes: audit.resultBytes ?? 0,
      upstreamIsError: Boolean(audit.upstreamIsError),
    };

    if (this.queue.length >= this.maxQueueSize) {
      this.queue.shift(); // Drop oldest
      this.droppedCount++;
      if (this.droppedCount % 100 === 1) {
        this.logger?.warn(
          { droppedCount: this.droppedCount, queueSize: this.queue.length },
          'MongoAuditSink queue full; dropped oldest audit records',
        );
      }
    }

    this.queue.push(doc);

    if (this.queue.length >= this.batchSize) {
      void this.flush();
    }
  }

  /**
   * Flushes up to batchSize items from the queue to MongoDB.
   */
  async flush(): Promise<void> {
    if (this.isFlushing || this.queue.length === 0) {
      return;
    }

    this.isFlushing = true;

    try {
      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, this.batchSize * 2);
        if (batch.length === 0) break;

        let attempts = 0;
        let success = false;
        let backoffMs = 50;

        while (!success && attempts < 3) {
          attempts++;
          try {
            await this.db.collection<ToolCallDocument>('tool_calls').insertMany(batch, { ordered: false });
            success = true;
          } catch (err: unknown) {
            this.logger?.warn(
              { attempt: attempts, error: err instanceof Error ? err.message : String(err) },
              'Failed to insert audit batch into MongoDB; retrying',
            );
            if (attempts < 3) {
              await new Promise((resolve) => setTimeout(resolve, backoffMs));
              backoffMs *= 2;
            } else {
              this.logger?.error('Failed to insert audit batch into MongoDB after 3 attempts; batch dropped');
            }
          }
        }
      }
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * Flushes all queued records and closes the timer. Used during graceful shutdown.
   */
  async close(): Promise<void> {
    this.isClosed = true;
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getDroppedCount(): number {
    return this.droppedCount;
  }
}
