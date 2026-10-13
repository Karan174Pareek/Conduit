import type { FastifyPluginAsync } from 'fastify';
import type { Db } from 'mongodb';
import { z } from 'zod';
import type { Config } from '../config.js';
import { toObjectId, type UserDocument, type AdminEventDocument, type SessionDocument } from '../db/types.js';
import { verifyPassword, verifyDummy } from '../services/password.js';
import { createSession, destroySession } from '../services/sessions.js';
import { requireAuth } from '../middleware/authenticator.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const authRoutes = (db: Db, config: Config): FastifyPluginAsync => async (fastify) => {
  // POST /api/auth/login
  fastify.post('/login', async (req, reply) => {
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        code: 'invalid_request',
        message: 'Invalid email or password format',
        statusCode: 400,
      });
    }

    const { email, password } = parseResult.data;
    const normalizedEmail = email.toLowerCase();
    const user = await db.collection('users').findOne({ email: normalizedEmail });

    // Constant-time path if user does not exist
    if (!user) {
      await verifyDummy(password);
      return reply.status(401).send({
        code: 'unauthorized',
        message: 'Invalid email or password',
        statusCode: 401,
      });
    }

    // Check account lockout (10 failed attempts -> 15 min lock)
    const now = new Date();
    if (user.lockedUntil && new Date(user.lockedUntil) > now) {
      return reply.status(429).send({
        code: 'rate_limited',
        message: 'Account is temporarily locked due to too many failed login attempts. Please try again later.',
        statusCode: 429,
      });
    }

    const isPasswordValid = await verifyPassword(user.passwordHash, password);

    if (!isPasswordValid) {
      const attempts = (user.failedLoginAttempts || 0) + 1;
      const updateData: { failedLoginAttempts: number; lockedUntil?: Date } = { failedLoginAttempts: attempts };

      if (attempts >= 10) {
        updateData.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
      }

      await db.collection('users').updateOne(
        { _id: user._id },
        { $set: updateData },
      );

      await db.collection<AdminEventDocument>('admin_events').insertOne({
        ts: now,
        actorId: user._id.toString(),
        actorEmail: user.email,
        action: 'login.fail',
        target: { type: 'user', id: user._id.toString(), label: user.email },
        details: { email: user.email, attempts, reason: 'invalid_credentials' },
        requestId: req.id,
        ip: req.ip,
      });

      if (attempts >= 10) {
        await db.collection<AdminEventDocument>('admin_events').insertOne({
          ts: now,
          actorId: user._id.toString(),
          actorEmail: user.email,
          action: 'login.lockout',
          target: { type: 'user', id: user._id.toString(), label: user.email },
          details: { email: user.email, attempts, lockedUntil: updateData.lockedUntil },
          requestId: req.id,
          ip: req.ip,
        });
      }

      return reply.status(401).send({
        code: 'unauthorized',
        message: 'Invalid email or password',
        statusCode: 401,
      });
    }

    // Reset failed attempts on success
    if (user.failedLoginAttempts || user.lockedUntil) {
      await db.collection('users').updateOne(
        { _id: user._id },
        { $set: { failedLoginAttempts: 0, lockedUntil: null } },
      );
    }

    // Create session
    const { sessionId, csrfToken, expiresAt } = await createSession(db, user._id.toString());

    // Determine cookie security
    const isTls = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';

    reply.setCookie('session_id', sessionId, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: isTls,
      expires: expiresAt,
    });

    return reply.status(200).send({
      user: {
        id: user._id.toString(),
        email: user.email,
        role: user.role,
      },
      csrfToken,
    });
  });

  // POST /api/auth/logout
  fastify.post('/logout', async (req, reply) => {
    const sessionId = req.cookies?.['session_id'];
    if (sessionId) {
      await destroySession(db, sessionId);
    }

    const isTls = req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https';
    reply.clearCookie('session_id', {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: isTls,
    });

    return reply.status(200).send({ ok: true });
  });

  // GET /api/auth/me
  fastify.get('/me', { preHandler: requireAuth(db, config) }, async (req, reply) => {
    const principal = req.principal!;
    const objId = toObjectId(principal.userId);
    const user = objId ? await db.collection<UserDocument>('users').findOne({ _id: objId }) : null;

    if (!user) {
      return reply.status(401).send({
        code: 'unauthorized',
        message: 'User no longer exists',
        statusCode: 401,
      });
    }

    let csrfToken: string | undefined;
    const sessionId = req.cookies?.['session_id'];
    if (sessionId) {
      const session = await db.collection<SessionDocument>('sessions').findOne({ sessionId });
      if (session) {
        csrfToken = session.csrfToken;
      }
    }

    return reply.status(200).send({
      user: {
        id: user._id.toString(),
        email: user.email,
        role: user.role,
      },
      ...(csrfToken ? { csrfToken } : {}),
    });
  });
};
