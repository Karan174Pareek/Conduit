import type { FastifyPluginAsync } from 'fastify';
import crypto from 'node:crypto';
import type { Db } from 'mongodb';
import { z } from 'zod';
import type { Config } from '../config.js';
import { requireAuth } from '../middleware/authenticator.js';
import { requireRole } from '../middleware/roles.js';
import { hashPassword } from '../services/password.js';
import type { InviteDocument, UserDocument, AdminEventDocument } from '../db/types.js';

export interface InviteRouteOptions {
  db: Db;
  config: Config;
}

const createInviteSchema = z.object({
  email: z.string().email().transform((e) => e.toLowerCase()),
  role: z.enum(['admin', 'member']).default('member'),
});

const acceptInviteSchema = z.object({
  token: z.string().min(1, 'Token is required'),
  name: z.string().min(1, 'Name is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const inviteRoutes: FastifyPluginAsync<InviteRouteOptions> = async (
  fastify,
  opts,
) => {
  const { db, config } = opts;

  // 1. POST /api/invites - Create single-use 72h invite token (admin only)
  fastify.post('/invites', { preHandler: [requireAuth(db, config), requireRole('admin', db)] }, async (request, reply) => {
    const principal = request.principal!;
    const body = createInviteSchema.parse(request.body);

    const users = db.collection<UserDocument>('users');
    const existingUser = await users.findOne({ email: body.email });

    if (existingUser && existingUser.status === 'active') {
      reply.status(409).send({
        error: 'Conflict',
        message: 'A user with this email address already exists and is active',
      });
      return;
    }

    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
    const now = new Date();

    const inviteDoc: InviteDocument = {
      email: body.email,
      role: body.role,
      tokenHash,
      invitedBy: principal.userId,
      expiresAt,
      usedAt: null,
      createdAt: now,
    };

    const inserted = await db.collection<InviteDocument>('invites').insertOne(inviteDoc);

    // Upsert placeholder invited user document
    await users.updateOne(
      { email: body.email },
      {
        $set: {
          email: body.email,
          role: body.role,
          status: 'invited',
          updatedAt: now,
        },
        $setOnInsert: {
          passwordHash: '',
          createdAt: now,
        },
      },
      { upsert: true },
    );

    await db.collection<AdminEventDocument>('admin_events').insertOne({
      ts: now,
      actorId: principal.userId,
      actorEmail: (request as any).user?.email ?? principal.userId,
      action: 'user.invite',
      target: { type: 'invite', id: inserted.insertedId.toString(), label: body.email },
      details: { email: body.email, role: body.role, expiresAt },
    });

    reply.status(201).send({
      id: inserted.insertedId.toString(),
      email: body.email,
      role: body.role,
      token: rawToken,
      expiresAt,
    });
  });

  // 2. POST /api/invites/accept - Single-use acceptance with Argon2id password hashing
  fastify.post('/invites/accept', async (request, reply) => {
    const body = acceptInviteSchema.parse(request.body);
    const tokenHash = crypto.createHash('sha256').update(body.token).digest('hex');

    const invites = db.collection<InviteDocument>('invites');
    const invite = await invites.findOne({
      tokenHash,
      usedAt: null,
      expiresAt: { $gt: new Date() },
    });

    if (!invite) {
      reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid or expired invite token',
      });
      return;
    }

    const now = new Date();

    // Mark invite as used atomically
    const updateResult = await invites.updateOne(
      { _id: invite._id, usedAt: null },
      { $set: { usedAt: now } },
    );

    if (updateResult.modifiedCount === 0) {
      reply.status(400).send({
        error: 'Bad Request',
        message: 'Invite token has already been used',
      });
      return;
    }

    const passwordHash = await hashPassword(body.password);
    const users = db.collection<UserDocument>('users');

    await users.updateOne(
      { email: invite.email },
      {
        $set: {
          email: invite.email,
          name: body.name,
          role: invite.role,
          passwordHash,
          status: 'active',
          disabled: false,
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { upsert: true },
    );

    await db.collection<AdminEventDocument>('admin_events').insertOne({
      ts: now,
      actorId: 'anonymous',
      actorEmail: invite.email,
      action: 'user.accept_invite',
      target: { type: 'user', id: invite.email, label: body.name },
      details: { email: invite.email, role: invite.role },
    });

    reply.send({
      message: 'Invite accepted successfully',
      email: invite.email,
    });
  });
};
