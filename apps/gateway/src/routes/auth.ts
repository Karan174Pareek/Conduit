import type { FastifyPluginAsync } from 'fastify';
import type { Db } from 'mongodb';
import { z } from 'zod';
import type { Config } from '../config.js';
import { toObjectId, type UserDocument, type SessionDocument } from '../db/types.js';
import { verifyPassword, verifyDummy, hashPassword } from '../services/password.js';
import { createSession, destroySession, hashSessionToken } from '../services/sessions.js';
import { requireAuth } from '../middleware/authenticator.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(12, 'New password must be at least 12 characters long'),
});

const WEAK_PASSWORDS_DENY_LIST = new Set([
  'password1234',
  'password12345',
  'admin1234567',
  'admin12345678',
  'changeme1234',
  'changeme12345',
  '123456789012',
  '1234567890123',
  'conduit12345',
  'qwertyuiopas',
  'administrator',
  'rootpassword',
]);

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
    const user = await db.collection<UserDocument>('users').findOne({ email: normalizedEmail });

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
        mustChangePassword: !!user.mustChangePassword,
      },
      csrfToken,
    });
  });

  // POST /api/auth/logout
  fastify.post('/logout', { preHandler: requireAuth(db, config) }, async (req, reply) => {
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
    if (req.sessionDoc?.csrfToken) {
      csrfToken = req.sessionDoc.csrfToken;
    } else {
      const sessionId = req.cookies?.['session_id'];
      if (sessionId) {
        const tokenHash = hashSessionToken(sessionId);
        const session = await db.collection<SessionDocument>('sessions').findOne({ tokenHash });
        if (session) {
          csrfToken = session.csrfToken;
        }
      }
    }

    return reply.status(200).send({
      user: {
        id: user._id.toString(),
        email: user.email,
        role: user.role,
        mustChangePassword: !!user.mustChangePassword,
      },
      ...(csrfToken ? { csrfToken } : {}),
    });
  });

  // POST /api/auth/change-password
  fastify.post('/change-password', { preHandler: requireAuth(db, config) }, async (req, reply) => {
    const parseResult = changePasswordSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        code: 'validation_failed',
        message: parseResult.error.errors[0]?.message || 'Invalid password payload',
        statusCode: 400,
      });
    }

    const { currentPassword, newPassword } = parseResult.data;
    const principal = req.principal!;
    const objId = toObjectId(principal.userId);
    if (!objId) {
      return reply.status(401).send({ code: 'unauthorized', message: 'User not found' });
    }

    const user = await db.collection<UserDocument>('users').findOne({ _id: objId });
    if (!user) {
      return reply.status(401).send({ code: 'unauthorized', message: 'User not found' });
    }

    // Policy 1: Verify current password
    const isCurrentValid = await verifyPassword(user.passwordHash, currentPassword);
    if (!isCurrentValid) {
      return reply.status(400).send({
        code: 'invalid_password',
        message: 'Current password is incorrect',
        statusCode: 400,
      });
    }

    // Policy 2: New password must not match current password
    if (currentPassword === newPassword) {
      return reply.status(400).send({
        code: 'validation_failed',
        message: 'New password cannot be the same as current password',
        statusCode: 400,
      });
    }

    // Policy 3: Deny list and identity check
    const normalizedNew = newPassword.toLowerCase();
    if (WEAK_PASSWORDS_DENY_LIST.has(normalizedNew)) {
      return reply.status(400).send({
        code: 'validation_failed',
        message: 'Chosen password is in the common passwords deny list. Choose a stronger password.',
        statusCode: 400,
      });
    }

    const emailPrefix = user.email.split('@')[0]?.toLowerCase();
    if (emailPrefix && emailPrefix.length >= 3 && normalizedNew.includes(emailPrefix)) {
      return reply.status(400).send({
        code: 'validation_failed',
        message: 'Password cannot contain parts of your email address.',
        statusCode: 400,
      });
    }

    // Hash new password
    const newPasswordHash = await hashPassword(newPassword);

    // Update user document
    await db.collection<UserDocument>('users').updateOne(
      { _id: user._id },
      {
        $set: {
          passwordHash: newPasswordHash,
          mustChangePassword: false,
          updatedAt: new Date(),
        },
      },
    );

    // Revoke all OTHER sessions for this user
    const currentSessionId = req.cookies?.['session_id'];
    const currentTokenHash = currentSessionId ? hashSessionToken(currentSessionId) : null;
    const sessionFilter: Record<string, unknown> = { userId: user._id.toString() };
    if (currentTokenHash) {
      sessionFilter['tokenHash'] = { $ne: currentTokenHash };
    }
    await db.collection<SessionDocument>('sessions').deleteMany(sessionFilter);

    // Write audit event to admin_events
    await db.collection('admin_events').insertOne({
      ts: new Date(),
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'auth.password_changed',
      target: { type: 'user', id: user._id.toString(), label: user.email },
      details: { reason: 'user_action' },
      ip: req.ip,
    });

    return reply.status(200).send({ ok: true, message: 'Password changed successfully' });
  });
};
