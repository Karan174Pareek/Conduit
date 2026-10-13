import type { FastifyPluginAsync } from 'fastify';
import type { Db } from 'mongodb';
import { z } from 'zod';
import type { Config } from '../config.js';
import { requireAuth } from '../middleware/authenticator.js';
import { requireRole } from '../middleware/roles.js';
import { toObjectId, type UserDocument, type AdminEventDocument } from '../db/types.js';

export interface UserRouteOptions {
  db: Db;
  config: Config;
}

const updateUserSchema = z.object({
  role: z.enum(['admin', 'member']).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

export const userRoutes: FastifyPluginAsync<UserRouteOptions> = async (
  fastify,
  opts,
) => {
  const { db, config } = opts;

  // 1. GET /api/users - List team members (admin only, passwordHash excluded)
  fastify.get('/users', { preHandler: [requireAuth(db, config), requireRole('admin', db)] }, async (_request, reply) => {
    const users = await db
      .collection<UserDocument>('users')
      .find()
      .sort({ createdAt: -1 })
      .toArray();

    reply.send({
      users: users.map((u) => ({
        id: u._id.toString(),
        email: u.email,
        name: u.name ?? '',
        role: u.role,
        status: u.status ?? (u.disabled ? 'disabled' : 'active'),
        disabled: Boolean(u.disabled),
        disabledAt: u.disabledAt ?? null,
        lastLoginAt: u.lastLoginAt ?? null,
        createdAt: u.createdAt,
        updatedAt: u.updatedAt,
      })),
    });
  });

  // 2. PATCH /api/users/:id - Update user role or status with self-demote and last-admin protections
  fastify.patch('/users/:id', { preHandler: [requireAuth(db, config), requireRole('admin', db)] }, async (request, reply) => {
    const principal = request.principal!;
    const { id } = request.params as { id: string };
    const body = updateUserSchema.parse(request.body);

    const objId = toObjectId(id);
    if (!objId) {
      reply.status(400).send({ error: 'Bad Request', message: 'Invalid user ID' });
      return;
    }

    const collection = db.collection<UserDocument>('users');
    const targetUser = await collection.findOne({ _id: objId });

    if (!targetUser) {
      reply.status(404).send({ error: 'Not Found', message: 'User not found' });
      return;
    }

    const isSelf = targetUser._id.toString() === principal.userId;

    // Safety Rule 1: Prevent self-demotion
    if (isSelf && body.role === 'member') {
      reply.status(400).send({
        error: 'Bad Request',
        message: 'Cannot demote yourself from admin',
      });
      return;
    }

    // Safety Rule 2: Prevent self-disabling
    if (isSelf && body.status === 'disabled') {
      reply.status(400).send({
        error: 'Bad Request',
        message: 'Cannot disable your own administrator account',
      });
      return;
    }

    // Safety Rule 3: Last active admin protection
    const isTargetActiveAdmin =
      targetUser.role === 'admin' &&
      targetUser.status !== 'disabled' &&
      !targetUser.disabled;

    const willDemoteOrDisable =
      body.role === 'member' || body.status === 'disabled';

    if (isTargetActiveAdmin && willDemoteOrDisable) {
      const activeAdminCount = await collection.countDocuments({
        role: 'admin',
        status: { $ne: 'disabled' },
        disabled: { $ne: true },
      });

      if (activeAdminCount <= 1) {
        reply.status(400).send({
          error: 'Bad Request',
          message: 'Cannot demote or disable the last active administrator',
        });
        return;
      }
    }

    const now = new Date();
    const updateDoc: Record<string, unknown> = {
      updatedAt: now,
    };

    if (body.role) {
      updateDoc.role = body.role;
    }

    if (body.status) {
      updateDoc.status = body.status;
      updateDoc.disabled = body.status === 'disabled';
      updateDoc.disabledAt = body.status === 'disabled' ? now : null;
    }

    await collection.updateOne({ _id: objId }, { $set: updateDoc });

    const updatedUser = await collection.findOne({ _id: objId });

    await db.collection<AdminEventDocument>('admin_events').insertOne({
      ts: now,
      actorId: principal.userId,
      actorEmail: (request as any).user?.email ?? principal.userId,
      action: body.status === 'disabled' ? 'user.disable' : body.role ? 'user.role_change' : 'user.update',
      target: { type: 'user', id: targetUser._id.toString(), label: targetUser.email },
      details: { role: body.role, status: body.status },
    });

    reply.send({
      id: updatedUser!._id.toString(),
      email: updatedUser!.email,
      name: updatedUser!.name ?? '',
      role: updatedUser!.role,
      status: updatedUser!.status ?? (updatedUser!.disabled ? 'disabled' : 'active'),
      disabled: Boolean(updatedUser!.disabled),
      disabledAt: updatedUser!.disabledAt ?? null,
      updatedAt: updatedUser!.updatedAt,
    });
  });
};
