import type { FastifyPluginAsync } from 'fastify';
import type { Db } from 'mongodb';
import { z } from 'zod';
import type { Config } from '../config.js';
import { requireAuth } from '../middleware/authenticator.js';
import { requireRole } from '../middleware/roles.js';
import type { PolicyDocument, AdminEventDocument, SystemStateDocument } from '../db/types.js';
import { toObjectId } from '../db/types.js';

export interface PolicyRouteOptions {
  db: Db;
  config: Config;
}

const CreatePolicySchema = z.object({
  scope: z.enum(['role', 'user']),
  role: z.enum(['admin', 'member']).optional(),
  subjectId: z.string().optional(),
  serverId: z.string().min(1),
  toolPattern: z.string().min(1),
  effect: z.enum(['allow', 'deny']),
  readOnlyOnly: z.boolean().optional(),
});

const PolicySettingsSchema = z.object({
  membersReadOnly: z.boolean(),
});

export const policiesRoutes: FastifyPluginAsync<PolicyRouteOptions> = async (fastify, { db, config }) => {
  // GET /api/policies - List all policies
  fastify.get('/', { preHandler: [requireAuth(db, config)] }, async (_req, reply) => {
    const policies = await db
      .collection<PolicyDocument>('policies')
      .find({})
      .sort({ createdAt: -1 })
      .toArray();

    const systemState = await db.collection<SystemStateDocument>('system_state').findOne({});
    const membersReadOnly =
      Boolean((systemState as any)?.membersReadOnlyPolicy) ||
      process.env.POLICY_MEMBERS_READ_ONLY === 'true';

    reply.send({
      policies: policies.map((p) => ({
        id: p._id?.toString(),
        scope: p.scope,
        role: p.role,
        subjectId: p.subjectId,
        serverId: p.serverId,
        toolPattern: p.toolPattern,
        effect: p.effect,
        readOnlyOnly: p.readOnlyOnly,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      })),
      settings: {
        membersReadOnly,
      },
    });
  });

  // POST /api/policies - Create policy (admin only)
  fastify.post('/', { preHandler: [requireAuth(db, config), requireRole('admin', db)] }, async (req, reply) => {
    const parseRes = CreatePolicySchema.safeParse(req.body);
    if (!parseRes.success) {
      return reply.status(400).send({
        error: 'validation_error',
        message: 'Invalid policy data',
        issues: parseRes.error.issues,
      });
    }

    const data = parseRes.data;
    if (data.scope === 'role' && !data.role) {
      return reply.status(400).send({
        error: 'validation_error',
        message: 'Role is required when scope is role',
      });
    }
    if (data.scope === 'user' && !data.subjectId) {
      return reply.status(400).send({
        error: 'validation_error',
        message: 'SubjectId is required when scope is user',
      });
    }

    const principal = req.principal!;
    const now = new Date();
    const doc: PolicyDocument = {
      scope: data.scope,
      role: data.role,
      subjectId: data.subjectId,
      serverId: data.serverId,
      toolPattern: data.toolPattern,
      effect: data.effect,
      readOnlyOnly: data.readOnlyOnly,
      createdAt: now,
      updatedAt: now,
      createdBy: principal.userId,
    };

    const insertRes = await db.collection<PolicyDocument>('policies').insertOne(doc);

    // Bump configVersion
    await db.collection<SystemStateDocument>('system_state').updateOne(
      {},
      { $inc: { configVersion: 1 }, $set: { updatedAt: now } },
      { upsert: true },
    );

    // Admin event
    await db.collection<AdminEventDocument>('admin_events').insertOne({
      ts: now,
      actorId: principal.userId,
      actorEmail: principal.email ?? '',
      action: 'policy_create',
      target: {
        type: 'policy',
        id: insertRes.insertedId.toString(),
        label: `${doc.scope}:${doc.serverId}:${doc.toolPattern}`,
      },
      details: {
        scope: doc.scope,
        role: doc.role,
        subjectId: doc.subjectId,
        serverId: doc.serverId,
        toolPattern: doc.toolPattern,
        effect: doc.effect,
      },
    });

    reply.status(201).send({
      id: insertRes.insertedId.toString(),
      ...doc,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    });
  });

  // DELETE /api/policies/:id - Delete policy (admin only)
  fastify.delete('/:id', { preHandler: [requireAuth(db, config), requireRole('admin', db)] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const objId = toObjectId(id);
    if (!objId) {
      return reply.status(404).send({ error: 'not_found', message: 'Policy not found' });
    }

    const policy = await db.collection<PolicyDocument>('policies').findOne({ _id: objId });
    if (!policy) {
      return reply.status(404).send({ error: 'not_found', message: 'Policy not found' });
    }

    await db.collection<PolicyDocument>('policies').deleteOne({ _id: objId });

    const principal = req.principal!;
    const now = new Date();
    await db.collection<SystemStateDocument>('system_state').updateOne(
      {},
      { $inc: { configVersion: 1 }, $set: { updatedAt: now } },
      { upsert: true },
    );

    await db.collection<AdminEventDocument>('admin_events').insertOne({
      ts: now,
      actorId: principal.userId,
      actorEmail: principal.email ?? '',
      action: 'policy_delete',
      target: {
        type: 'policy',
        id,
        label: `${policy.scope}:${policy.serverId}:${policy.toolPattern}`,
      },
      details: {
        scope: policy.scope,
        role: policy.role,
        toolPattern: policy.toolPattern,
      },
    });

    reply.send({ ok: true, deletedId: id });
  });

  // POST /api/policies/settings - Update policy settings (admin only)
  fastify.post('/settings', { preHandler: [requireAuth(db, config), requireRole('admin', db)] }, async (req, reply) => {
    const parseRes = PolicySettingsSchema.safeParse(req.body);
    if (!parseRes.success) {
      return reply.status(400).send({
        error: 'validation_error',
        message: 'Invalid policy settings',
        issues: parseRes.error.issues,
      });
    }

    const { membersReadOnly } = parseRes.data;
    const principal = req.principal!;
    const now = new Date();

    await db.collection('system_state').updateOne(
      {},
      {
        $inc: { configVersion: 1 },
        $set: { membersReadOnlyPolicy: membersReadOnly, updatedAt: now },
      },
      { upsert: true },
    );

    // Also sync role-level convenience policy
    if (membersReadOnly) {
      await db.collection<PolicyDocument>('policies').updateOne(
        { scope: 'role', role: 'member', serverId: '*', readOnlyOnly: true },
        {
          $set: {
            scope: 'role',
            role: 'member',
            serverId: '*',
            toolPattern: '*',
            effect: 'allow',
            readOnlyOnly: true,
            updatedAt: now,
            createdBy: principal.userId,
          },
          $setOnInsert: {
            createdAt: now,
          },
        },
        { upsert: true },
      );
    } else {
      await db.collection<PolicyDocument>('policies').deleteMany({
        scope: 'role',
        role: 'member',
        readOnlyOnly: true,
      });
    }

    await db.collection<AdminEventDocument>('admin_events').insertOne({
      ts: now,
      actorId: principal.userId,
      actorEmail: principal.email ?? '',
      action: 'policy_settings_update',
      target: {
        type: 'settings',
        id: 'policy',
        label: 'membersReadOnly',
      },
      details: { membersReadOnly },
    });

    reply.send({ ok: true, membersReadOnly });
  });
};
