import type { FastifyPluginAsync } from 'fastify';
import type { Db, Filter } from 'mongodb';
import { z } from 'zod';
import type { Config } from '../config.js';
import { requireAuth } from '../middleware/authenticator.js';
import { requireRole } from '../middleware/roles.js';
import type { ToolCallDocument, AdminEventDocument } from '../db/types.js';
import { sanitizeCsvCell } from '../audit/redaction.js';

export interface AuditRouteOptions {
  db: Db;
  config: Config;
}

const auditQuerySchema = z.object({
  serverSlug: z.string().optional(),
  tool: z.string().optional(),
  userId: z.string().optional(),
  outcome: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const adminEventsQuerySchema = z.object({
  action: z.string().optional(),
  actorId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const auditRoutes: FastifyPluginAsync<AuditRouteOptions> = async (
  fastify,
  opts,
) => {
  const { db, config } = opts;

  // 1. GET /api/audit - Paginated audit logs with role-based scoping
  fastify.get('/audit', { preHandler: [requireAuth(db, config)] }, async (request, reply) => {
    const principal = request.principal!;
    const query = auditQuerySchema.parse(request.query);

    const filter: Filter<ToolCallDocument> = {};

    // Members can only see their own audit logs
    if (principal.role !== 'admin') {
      filter.userId = principal.userId;
    } else if (query.userId) {
      filter.userId = query.userId;
    }

    if (query.serverSlug) filter.serverSlug = query.serverSlug;
    if (query.tool) filter.tool = query.tool;
    if (query.outcome) filter.outcome = query.outcome as ToolCallDocument['outcome'];

    if (query.from || query.to) {
      filter.ts = {};
      if (query.from) filter.ts.$gte = new Date(query.from);
      if (query.to) filter.ts.$lte = new Date(query.to);
    }

    const skip = (query.page - 1) * query.limit;
    const collection = db.collection<ToolCallDocument>('tool_calls');

    const [items, total] = await Promise.all([
      collection
        .find(filter)
        .sort({ ts: -1 })
        .skip(skip)
        .limit(query.limit)
        .toArray(),
      collection.countDocuments(filter),
    ]);

    reply.send({
      items: items.map((doc) => ({
        id: doc._id?.toString(),
        ts: doc.ts,
        requestId: doc.requestId,
        userId: doc.userId,
        userEmail: doc.userEmail,
        role: doc.role,
        via: doc.via,
        keyId: doc.keyId,
        source: doc.source,
        serverSlug: doc.serverSlug,
        tool: doc.tool,
        exposedName: doc.exposedName,
        durationMs: doc.durationMs,
        outcome: doc.outcome,
        errorCode: doc.errorCode,
        errorMessage: doc.errorMessage,
        argsSummary: doc.argsSummary,
        argsHash: doc.argsHash,
        resultBytes: doc.resultBytes,
        upstreamIsError: doc.upstreamIsError,
      })),
      total,
      page: query.page,
      limit: query.limit,
    });
  });

  // 2. GET /api/audit/export.csv - CSV export with formula injection prevention
  fastify.get('/audit/export.csv', { preHandler: [requireAuth(db, config)] }, async (request, reply) => {
    const principal = request.principal!;
    const query = auditQuerySchema.parse(request.query);

    const filter: Filter<ToolCallDocument> = {};

    if (principal.role !== 'admin') {
      filter.userId = principal.userId;
    } else if (query.userId) {
      filter.userId = query.userId;
    }

    if (query.serverSlug) filter.serverSlug = query.serverSlug;
    if (query.tool) filter.tool = query.tool;
    if (query.outcome) filter.outcome = query.outcome as ToolCallDocument['outcome'];

    if (query.from || query.to) {
      filter.ts = {};
      if (query.from) filter.ts.$gte = new Date(query.from);
      if (query.to) filter.ts.$lte = new Date(query.to);
    }

    // Limit CSV export to 5000 items to protect memory
    const items = await db
      .collection<ToolCallDocument>('tool_calls')
      .find(filter)
      .sort({ ts: -1 })
      .limit(5000)
      .toArray();

    const headers = [
      'Timestamp',
      'User ID',
      'User Email',
      'Role',
      'Via',
      'Server',
      'Tool',
      'Exposed Name',
      'Outcome',
      'Duration (ms)',
      'Args Summary',
      'Args Hash',
      'Error Message',
    ];

    const rows: string[] = [headers.map(sanitizeCsvCell).join(',')];

    for (const doc of items) {
      const row = [
        sanitizeCsvCell(doc.ts.toISOString()),
        sanitizeCsvCell(doc.userId),
        sanitizeCsvCell(doc.userEmail),
        sanitizeCsvCell(doc.role),
        sanitizeCsvCell(doc.via),
        sanitizeCsvCell(doc.serverSlug),
        sanitizeCsvCell(doc.tool),
        sanitizeCsvCell(doc.exposedName),
        sanitizeCsvCell(doc.outcome),
        sanitizeCsvCell(doc.durationMs),
        sanitizeCsvCell(doc.argsSummary),
        sanitizeCsvCell(doc.argsHash),
        sanitizeCsvCell(doc.errorMessage ?? ''),
      ];
      rows.push(row.join(','));
    }

    const csvContent = rows.join('\r\n');
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="conduit-audit-${Date.now()}.csv"`)
      .send(csvContent);
  });

  // 3. GET /api/admin-events - Admin activity audit log
  fastify.get('/admin-events', { preHandler: [requireAuth(db, config), requireRole('admin')] }, async (request, reply) => {
    const query = adminEventsQuerySchema.parse(request.query);
    const filter: Filter<AdminEventDocument> = {};

    if (query.action) filter.action = query.action;
    if (query.actorId) filter.actorId = query.actorId;

    const skip = (query.page - 1) * query.limit;
    const collection = db.collection<AdminEventDocument>('admin_events');

    const [events, total] = await Promise.all([
      collection
        .find(filter)
        .sort({ ts: -1 })
        .skip(skip)
        .limit(query.limit)
        .toArray(),
      collection.countDocuments(filter),
    ]);

    reply.send({
      events: events.map((e) => ({
        id: e._id?.toString(),
        ts: e.ts,
        actorId: e.actorId,
        actorEmail: e.actorEmail,
        action: e.action,
        target: e.target,
        details: e.details,
      })),
      total,
      page: query.page,
      limit: query.limit,
    });
  });

  // 4. GET /api/stats/servers - Aggregated server call metrics over the last 24h
  fastify.get('/stats/servers', { preHandler: [requireAuth(db, config), requireRole('admin')] }, async (_request, reply) => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const pipeline = [
      { $match: { ts: { $gte: since } } },
      {
        $group: {
          _id: '$serverSlug',
          totalCalls: { $sum: 1 },
          errorCalls: {
            $sum: {
              $cond: [{ $in: ['$outcome', ['error', 'timeout', 'unreachable']] }, 1, 0],
            },
          },
          avgDurationMs: { $avg: '$durationMs' },
        },
      },
    ];

    const results = await db
      .collection<ToolCallDocument>('tool_calls')
      .aggregate(pipeline)
      .toArray();

    const stats = results.map((r) => ({
      serverSlug: r._id as string,
      totalCalls: r.totalCalls as number,
      errorCalls: r.errorCalls as number,
      successCalls: (r.totalCalls as number) - (r.errorCalls as number),
      avgDurationMs: Math.round((r.avgDurationMs as number) || 0),
    }));

    reply.send({ stats });
  });
};
