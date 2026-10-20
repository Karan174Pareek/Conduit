import type { FastifyPluginAsync } from 'fastify';
import { type Db, ObjectId } from 'mongodb';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { validateServerSlug } from '@conduit/shared';
import type { Config } from '../config.js';
import { requireAuth } from '../middleware/authenticator.js';
import { requireRole } from '../middleware/roles.js';
import type {
  McpServerDocument,
  ToolCatalogDocument,
  AdminEventDocument,
  UserDocument,
  SystemStateDocument,
} from '../db/types.js';
import { toObjectId } from '../db/types.js';
import { CredentialCrypto } from '../registry/crypto.js';
import { assertValidServerUrl } from '../registry/url-policy.js';
import { createSecureFetch } from '../registry/secure-fetch.js';
import { CatalogService } from '../catalog/service.js';
import { UpstreamManager } from '../upstream/manager.js';

export interface ServerRouteOptions {
  db: Db;
  config: Config;
  crypto: CredentialCrypto;
  catalogService: CatalogService;
  upstreamManager: UpstreamManager;
}

const authPayloadSchema = z.object({
  type: z.enum(['none', 'bearer', 'header']),
  headerName: z.string().optional().nullable(),
  credential: z.string().optional(),
});

const createServerSchema = z.object({
  slug: z.string().refine(validateServerSlug, {
    message: 'Slug must be 2-31 characters, start with a letter, lowercase alphanumeric and hyphens, no double underscores',
  }),
  displayName: z.string().min(1, 'displayName is required'),
  url: z.string().url('url must be a valid URL'),
  enabled: z.boolean().default(true),
  callTimeoutMs: z.number().int().min(1000).max(120000).default(30000),
  maxConcurrent: z.number().int().min(1).max(100).default(8),
  approveOnAdd: z.boolean().default(false),
  auth: authPayloadSchema.default({ type: 'none' }),
});

const updateServerSchema = z.object({
  displayName: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  url: z.string().url().optional(),
  enabled: z.boolean().optional(),
  callTimeoutMs: z.number().int().min(1000).max(120000).optional(),
  maxConcurrent: z.number().int().min(1).max(100).optional(),
  approveOnAdd: z.boolean().optional(),
  auth: authPayloadSchema.optional(),
});

export const serverRoutes: FastifyPluginAsync<ServerRouteOptions> = async (
  fastify,
  opts,
) => {
  const { db, config, crypto, catalogService, upstreamManager } = opts;

  // 1. GET /api/servers
  // Admins see full config without secrets; members see reduced view (name, slug, status, tools)
  fastify.get('/servers', { preHandler: [requireAuth(db, config)] }, async (request, reply) => {
    const principal = request.principal!;
    const isAdmin = principal.role === 'admin';

    const servers = await db.collection<McpServerDocument>('mcp_servers').find().toArray();

    if (!isAdmin) {
      // Member view: name, slug, status, tool names/descriptions, no URL, no auth info
      const memberList = await Promise.all(
        servers.map(async (s) => {
          const serverId = s._id?.toString() ?? s.slug;
          const tools = await db
            .collection<ToolCatalogDocument>('tool_catalog')
            .find({ serverId, 'approval.status': 'approved', removedAt: null })
            .project({ name: 1, exposedName: 1, description: 1 })
            .toArray();

          return {
            id: serverId,
            slug: s.slug,
            displayName: s.displayName,
            status: s.status,
            tools: tools.map((t) => ({
              name: t.name,
              exposedName: t.exposedName,
              description: t.description,
            })),
          };
        }),
      );
      reply.send({ servers: memberList });
      return;
    }

    // Admin view
    const adminList = servers.map((s) => ({
      id: s._id?.toString() ?? s.slug,
      slug: s.slug,
      displayName: s.displayName,
      url: s.url,
      enabled: s.enabled,
      trusted: s.trusted,
      system: s.system,
      origin: s.origin,
      callTimeoutMs: s.callTimeoutMs,
      maxConcurrent: s.maxConcurrent,
      approveOnAdd: s.approveOnAdd,
      status: s.status,
      authType: s.auth.type,
      hasCredential: Boolean(s.auth.ciphertext),
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));

    reply.send({ servers: adminList });
  });

  // 2. POST /api/servers (admin only)
  fastify.post('/servers', { preHandler: [requireAuth(db, config), requireRole('admin')] }, async (request, reply) => {
    const parsed = createServerSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(422).send({
        error: 'Validation Failed',
        message: 'Invalid server configuration',
        issues: parsed.error.issues,
      });
      return;
    }

    const data = parsed.data;
    await assertValidServerUrl(data.url);

    // Check slug uniqueness
    const existing = await db.collection<McpServerDocument>('mcp_servers').findOne({ slug: data.slug });
    if (existing) {
      reply.status(409).send({
        error: 'Conflict',
        message: `Server with slug "${data.slug}" already exists`,
      });
      return;
    }

    const principal = request.principal!;
    const userObjId = toObjectId(principal.userId);
    const user = userObjId ? await db.collection<UserDocument>('users').findOne({ _id: userObjId }) : null;
    const actorEmail = request.principal?.email ?? user?.email ?? 'admin@conduit.localhost';
    const now = new Date();

    const serverObjId = new ObjectId();
    const serverId = serverObjId.toString();

    // Encrypt credential if provided
    let authDoc: McpServerDocument['auth'] = {
      type: data.auth.type,
      headerName: data.auth.headerName ?? null,
    };

    if (data.auth.credential) {
      authDoc = crypto.encryptCredential(
        serverId,
        data.auth.credential,
        data.auth.type === 'header' ? 'header' : 'bearer',
        data.auth.headerName,
      );
    }

    const doc: McpServerDocument = {
      _id: serverObjId,
      slug: data.slug,
      displayName: data.displayName,
      url: data.url,
      enabled: data.enabled,
      trusted: false,
      system: false,
      origin: 'admin',
      auth: authDoc,
      callTimeoutMs: data.callTimeoutMs,
      maxConcurrent: data.maxConcurrent,
      approveOnAdd: data.approveOnAdd,
      status: {
        state: 'connected',
        reasonCode: null,
        reason: null,
        checkedAt: null,
        lastSuccessAt: null,
      },
      createdBy: principal.userId,
      createdAt: now,
      updatedAt: now,
    };

    await db.collection<McpServerDocument>('mcp_servers').insertOne(doc);

    // Bump configVersion atomically
    await db.collection<SystemStateDocument>('system_state').updateOne(
      { _id: 'config' },
      { $inc: { configVersion: 1 }, $set: { updatedAt: now } },
      { upsert: true },
    );

    // Synchronously write admin_events row (no secrets in details)
    await db.collection<AdminEventDocument>('admin_events').insertOne({
      ts: now,
      actorId: principal.userId,
      actorEmail,
      action: 'server.add',
      target: { type: 'server', id: serverId, label: data.slug },
      details: {
        slug: data.slug,
        displayName: data.displayName,
        url: data.url,
        authType: data.auth.type,
      },
      requestId: request.id,
      ip: request.ip,
    });

    // Notify upstream manager immediately
    await upstreamManager.upsertServerState(doc);

    reply.status(201).send({
      id: serverId,
      slug: data.slug,
      displayName: data.displayName,
      url: data.url,
      enabled: data.enabled,
      hasCredential: Boolean(authDoc.ciphertext),
      authType: authDoc.type,
    });
  });

  // 3. PATCH /api/servers/:id (admin only)
  fastify.put('/servers/:id', { preHandler: [requireAuth(db, config), requireRole('admin')] }, async (_request, _reply) => {
    return (fastify as any).inject ? null : null;
  });

  fastify.patch('/servers/:id', { preHandler: [requireAuth(db, config), requireRole('admin')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const objId = toObjectId(id);
    const filter = objId ? { _id: objId } : { slug: id };

    const server = await db.collection<McpServerDocument>('mcp_servers').findOne(filter);
    if (!server) {
      reply.status(404).send({ error: 'Not Found', message: 'Server not found' });
      return;
    }

    const parsed = updateServerSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(422).send({
        error: 'Validation Failed',
        message: 'Invalid update payload',
        issues: parsed.error.issues,
      });
      return;
    }

    const data = parsed.data;
    if (data.url) {
      await assertValidServerUrl(data.url);
    }

    const principal = request.principal!;
    const userObjId = toObjectId(principal.userId);
    const user = userObjId ? await db.collection<UserDocument>('users').findOne({ _id: userObjId }) : null;
    const actorEmail = request.principal?.email ?? user?.email ?? 'admin@conduit.localhost';
    const now = new Date();
    const updateFields: Partial<McpServerDocument> = {
      updatedAt: now,
    };

    const targetDisplayName = data.displayName ?? data.name;
    if (targetDisplayName !== undefined) updateFields.displayName = targetDisplayName;
    if (data.url !== undefined) updateFields.url = data.url;
    if (data.enabled !== undefined) updateFields.enabled = data.enabled;
    if (data.callTimeoutMs !== undefined) updateFields.callTimeoutMs = data.callTimeoutMs;
    if (data.maxConcurrent !== undefined) updateFields.maxConcurrent = data.maxConcurrent;
    if (data.approveOnAdd !== undefined) updateFields.approveOnAdd = data.approveOnAdd;

    if (data.auth) {
      if (server.system && data.auth.credential) {
        reply.status(400).send({
          error: 'Bad Request',
          message: 'System server credentials cannot be edited via the API',
        });
        return;
      }

      if (data.auth.credential) {
        updateFields.auth = crypto.encryptCredential(
          server._id?.toString() ?? server.slug,
          data.auth.credential,
          data.auth.type === 'header' ? 'header' : 'bearer',
          data.auth.headerName,
        );
      } else {
        updateFields.auth = {
          type: data.auth.type,
          headerName: data.auth.headerName ?? null,
        };
      }
    }

    await db.collection<McpServerDocument>('mcp_servers').updateOne(filter, { $set: updateFields });

    // Bump configVersion
    await db.collection<SystemStateDocument>('system_state').updateOne(
      { _id: 'config' },
      { $inc: { configVersion: 1 }, $set: { updatedAt: now } },
      { upsert: true },
    );

    // Record admin event
    const action = data.enabled !== undefined
      ? (data.enabled ? 'server.enable' : 'server.disable')
      : 'server.update';

    await db.collection<AdminEventDocument>('admin_events').insertOne({
      ts: now,
      actorId: principal.userId,
      actorEmail,
      action,
      target: { type: 'server', id: server._id?.toString() ?? server.slug, label: server.slug },
      details: {
        updatedFields: Object.keys(updateFields).filter((k) => k !== 'auth'),
      },
      requestId: request.id,
      ip: request.ip,
    });

    const updated = await db.collection<McpServerDocument>('mcp_servers').findOne(filter);
    if (updated) {
      await upstreamManager.upsertServerState(updated);
    }

    reply.send({
      id: server._id?.toString() ?? server.slug,
      slug: updated?.slug,
      displayName: updated?.displayName,
      enabled: updated?.enabled,
      hasCredential: Boolean(updated?.auth.ciphertext),
      authType: updated?.auth.type,
    });
  });

  // 4. DELETE /api/servers/:id (admin only)
  fastify.delete('/servers/:id', { preHandler: [requireAuth(db, config), requireRole('admin')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const objId = toObjectId(id);
    const filter = objId ? { _id: objId } : { slug: id };

    const server = await db.collection<McpServerDocument>('mcp_servers').findOne(filter);
    if (!server) {
      reply.status(404).send({ error: 'Not Found', message: 'Server not found' });
      return;
    }

    if (server.system) {
      reply.status(403).send({
        error: 'Forbidden',
        message: 'System servers cannot be deleted',
      });
      return;
    }

    const serverId = server._id?.toString() ?? server.slug;
    const principal = request.principal!;
    const userObjId = toObjectId(principal.userId);
    const user = userObjId ? await db.collection<UserDocument>('users').findOne({ _id: userObjId }) : null;
    const actorEmail = request.principal?.email ?? user?.email ?? 'admin@conduit.localhost';
    const now = new Date();

    await db.collection<McpServerDocument>('mcp_servers').deleteOne(filter);
    await db.collection<ToolCatalogDocument>('tool_catalog').deleteMany({ serverId });

    // Bump configVersion
    await db.collection<SystemStateDocument>('system_state').updateOne(
      { _id: 'config' },
      { $inc: { configVersion: 1 }, $set: { updatedAt: now } },
      { upsert: true },
    );

    // Record admin event
    await db.collection<AdminEventDocument>('admin_events').insertOne({
      ts: now,
      actorId: principal.userId,
      actorEmail,
      action: 'server.remove',
      target: { type: 'server', id: serverId, label: server.slug },
      details: { slug: server.slug },
      requestId: request.id,
      ip: request.ip,
    });

    reply.send({ ok: true, deletedId: serverId });
  });

  // 5. POST /api/servers/test (admin only, ephemeral test connection)
  fastify.post('/servers/test', { preHandler: [requireAuth(db, config), requireRole('admin')] }, async (request, reply) => {
    const testSchema = z.object({
      url: z.string().url(),
      auth: authPayloadSchema.default({ type: 'none' }),
    });

    const parsed = testSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(422).send({
        error: 'Validation Failed',
        message: 'Invalid test payload',
        issues: parsed.error.issues,
      });
      return;
    }

    const { url, auth } = parsed.data;
    await assertValidServerUrl(url);

    const headers: Record<string, string> = {};
    if (auth.credential) {
      if (auth.type === 'bearer') {
        headers['Authorization'] = `Bearer ${auth.credential}`;
      } else if (auth.type === 'header' && auth.headerName) {
        headers[auth.headerName] = auth.credential;
      }
    }

    const transport = new StreamableHTTPClientTransport(new URL(url), {
      fetch: createSecureFetch(),
      requestInit: { headers, redirect: 'error' },
      redirectPolicy: 'same-origin',
    });

    const client = new Client(
      { name: 'conduit-gateway-test', version: '0.1.0' },
      { capabilities: {} },
    );

    try {
      await client.connect(transport);
      const toolsResult = await client.listTools();
      reply.send({
        ok: true,
        toolsCount: toolsResult.tools.length,
        tools: toolsResult.tools.map((t) => ({
          name: t.name,
          description: t.description,
        })),
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      reply.status(502).send({
        ok: false,
        error: 'Upstream connection test failed',
        message: msg,
      });
    }
  });

  // 6. GET /api/servers/:id/tools (admin & member)
  fastify.get('/servers/:id/tools', { preHandler: [requireAuth(db, config)] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const objId = toObjectId(id);
    const filter = objId ? { _id: objId } : { slug: id };

    const server = await db.collection<McpServerDocument>('mcp_servers').findOne(filter);
    if (!server) {
      reply.status(404).send({ error: 'Not Found', message: 'Server not found' });
      return;
    }

    const serverId = server._id?.toString() ?? server.slug;
    const principal = request.principal!;
    const isAdmin = principal.role === 'admin';

    // Member: approved tools only
    // Admin: tools with approval state, description, descriptionRaw, hash status
    const query = isAdmin
      ? { serverId, removedAt: null }
      : { serverId, 'approval.status': 'approved', removedAt: null };

    const tools = await db.collection<ToolCatalogDocument>('tool_catalog').find(query).toArray();

    reply.send({
      tools: tools.map((t) => ({
        name: t.name,
        exposedName: t.exposedName,
        description: t.description,
        ...(isAdmin
          ? {
              descriptionRaw: t.descriptionRaw ?? t.description,
              approval: t.approval,
              hash: t.hash,
              lastSeenAt: t.lastSeenAt,
            }
          : {}),
        inputSchema: t.inputSchema,
      })),
    });
  });

  // 7. POST /api/servers/:id/tools/approve (admin only)
  fastify.post('/servers/:id/tools/approve', { preHandler: [requireAuth(db, config), requireRole('admin')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const objId = toObjectId(id);
    const filter = objId ? { _id: objId } : { slug: id };

    const server = await db.collection<McpServerDocument>('mcp_servers').findOne(filter);
    if (!server) {
      reply.status(404).send({ error: 'Not Found', message: 'Server not found' });
      return;
    }

    const approveSchema = z.object({
      toolName: z.string().min(1),
    });

    const parsed = approveSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.status(422).send({
        error: 'Validation Failed',
        message: 'toolName is required',
      });
      return;
    }

    const serverId = server._id?.toString() ?? server.slug;
    const principal = request.principal!;
    const userObjId = toObjectId(principal.userId);
    const user = userObjId ? await db.collection<UserDocument>('users').findOne({ _id: userObjId }) : null;
    const actorEmail = request.principal?.email ?? user?.email ?? 'admin@conduit.localhost';

    const approvedTool = await catalogService.approveTool(
      serverId,
      parsed.data.toolName,
      principal.userId,
      actorEmail,
    );

    if (!approvedTool) {
      reply.status(404).send({
        error: 'Not Found',
        message: `Tool "${parsed.data.toolName}" not found on server`,
      });
      return;
    }

    reply.send({ ok: true, tool: approvedTool });
  });
};
