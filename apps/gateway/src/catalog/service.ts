import type { Db } from 'mongodb';
import { formatExposedToolName } from '@conduit/shared';
import type {
  ToolCatalogDocument,
  McpServerDocument,
  AdminEventDocument,
  SystemStateDocument,
} from '../db/types.js';
import {
  computeToolDefinitionHash,
  sanitizeText,
  validateAndSanitizeSchema,
} from './sanitizer.js';
import type { FastifyBaseLogger } from 'fastify';

export interface UpstreamRawTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: Record<string, unknown>;
}

export class CatalogService {
  constructor(
    private readonly db: Db,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  /**
   * Reconciles raw tools fetched from an upstream server into the tool_catalog collection.
   * Enforces sanitization, canonical hashing, and approval state machine transitions.
   */
  async reconcileTools(
    server: McpServerDocument,
    rawTools: UpstreamRawTool[],
  ): Promise<void> {
    const serverId = server._id?.toString() ?? server.slug;
    const collection = this.db.collection<ToolCatalogDocument>('tool_catalog');
    const adminEvents = this.db.collection<AdminEventDocument>('admin_events');

    const seenNames = new Set<string>();

    for (const raw of rawTools) {
      seenNames.add(raw.name);

      const rawDescription = raw.description ?? '';
      const sanitizedDescription = sanitizeText(rawDescription);

      const schemaResult = validateAndSanitizeSchema(raw.inputSchema ?? { type: 'object' });
      const sanitizedSchema = schemaResult.valid && schemaResult.sanitizedSchema
        ? schemaResult.sanitizedSchema
        : { type: 'object' };

      // Untrusted servers' annotations are ignored for decision making
      const annotations = server.trusted ? (raw.annotations ?? {}) : {};

      const hash = computeToolDefinitionHash({
        name: raw.name,
        description: sanitizedDescription,
        inputSchema: sanitizedSchema,
        annotations,
      });

      const exposedName = formatExposedToolName(server.slug, raw.name);

      const existing = await collection.findOne({ serverId, name: raw.name });

      if (!existing) {
        // First sight: pending unless server is trusted or approveOnAdd is true
        const autoApprove = server.trusted || server.approveOnAdd;
        const status = autoApprove ? 'approved' : 'pending';

        const doc: ToolCatalogDocument = {
          serverId,
          name: raw.name,
          exposedName,
          description: sanitizedDescription,
          descriptionRaw: rawDescription,
          inputSchema: sanitizedSchema,
          annotations,
          hash,
          approval: {
            status,
            approvedHash: autoApprove ? hash : undefined,
            approvedAt: autoApprove ? new Date() : undefined,
          },
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
          removedAt: null,
        };

        await collection.insertOne(doc);
      } else {
        // Existing tool: check if hash changed
        let status = existing.approval.status;
        let adminEventNeeded = false;

        if (existing.approval.status === 'approved' && existing.approval.approvedHash !== hash) {
          status = 'changed';
          adminEventNeeded = true;
        }

        const updateFields: Record<string, unknown> = {
          exposedName,
          description: sanitizedDescription,
          descriptionRaw: rawDescription,
          inputSchema: sanitizedSchema,
          annotations,
          hash,
          lastSeenAt: new Date(),
          removedAt: null,
          'approval.status': status,
        };

        await collection.updateOne({ serverId, name: raw.name }, { $set: updateFields as any });

        if (adminEventNeeded) {
          this.logger?.warn(
            { serverSlug: server.slug, toolName: raw.name, hash },
            'Approved tool definition changed upstream; quarantined to status "changed"',
          );
          await adminEvents.insertOne({
            ts: new Date(),
            actorId: 'system',
            actorEmail: 'system@conduit.internal',
            action: 'tool.changed',
            target: { type: 'tool', id: `${serverId}:${raw.name}`, label: exposedName },
            details: {
              serverSlug: server.slug,
              toolName: raw.name,
              previousHash: existing.approval.approvedHash,
              newHash: hash,
            },
          });
        }
      }
    }

    // Mark tools that disappeared from upstream as removed
    await collection.updateMany(
      { serverId, name: { $nin: Array.from(seenNames) }, removedAt: null },
      { $set: { removedAt: new Date() } },
    );
  }

  /**
   * Approves a tool definition, setting approvedHash to its current definition hash.
   */
  async approveTool(
    serverId: string,
    toolName: string,
    actorId: string,
    actorEmail: string,
  ): Promise<ToolCatalogDocument | null> {
    const collection = this.db.collection<ToolCatalogDocument>('tool_catalog');
    const adminEvents = this.db.collection<AdminEventDocument>('admin_events');

    const tool = await collection.findOne({ serverId, name: toolName });
    if (!tool) {
      return null;
    }

    const now = new Date();
    await collection.updateOne(
      { serverId, name: toolName },
      {
        $set: {
          'approval.status': 'approved',
          'approval.approvedHash': tool.hash,
          'approval.approvedBy': actorId,
          'approval.approvedAt': now,
        },
      },
    );

    // Bump configVersion
    await this.db.collection<SystemStateDocument>('system_state').updateOne(
      { _id: 'config' },
      { $inc: { configVersion: 1 }, $set: { updatedAt: now } },
      { upsert: true },
    );

    // Synchronously write admin_events row
    await adminEvents.insertOne({
      ts: now,
      actorId,
      actorEmail,
      action: 'tool.approve',
      target: { type: 'tool', id: `${serverId}:${toolName}`, label: tool.exposedName },
      details: {
        serverId,
        toolName,
        approvedHash: tool.hash,
      },
    });

    return await collection.findOne({ serverId, name: toolName });
  }
}
