import type { FastifyPluginAsync } from 'fastify';
import type { Db } from 'mongodb';
import { z } from 'zod';
import type { Config } from '../config.js';
import { requireAuth } from '../middleware/authenticator.js';
import type { ChatService } from '../chat/service.js';

export interface ChatRouteOptions {
  db: Db;
  config: Config;
  chatService?: ChatService;
}

const chatMessageSchema = z.object({
  message: z.string().min(1, 'Message is required').max(8192, 'Message cannot exceed 8192 characters'),
  conversationId: z.string().optional(),
  confirmedToolCalls: z.array(z.string()).optional(),
});

export const chatRoutes: FastifyPluginAsync<ChatRouteOptions> = async (app, opts) => {
  const { db, config, chatService } = opts;

  // GET /api/conversations - list current user's conversations
  app.get('/conversations', { preHandler: [requireAuth(db, config)] }, async (req, reply) => {
    if (!chatService) {
      return reply.status(503).send({ code: 'llm_unavailable', message: 'Chat service is not configured' });
    }
    const convs = await chatService.getConversations(req.principal!.userId);
    return convs.map((c) => ({
      id: c._id.toHexString(),
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));
  });

  // GET /api/conversations/:id - get conversation & messages
  app.get<{ Params: { id: string } }>('/conversations/:id', { preHandler: [requireAuth(db, config)] }, async (req, reply) => {
    if (!chatService) {
      return reply.status(503).send({ code: 'llm_unavailable', message: 'Chat service is not configured' });
    }
    const data = await chatService.getConversation(req.params.id, req.principal!.userId);
    if (!data) {
      return reply.status(404).send({ code: 'not_found', message: 'Conversation not found' });
    }
    return {
      conversation: {
        id: data.conversation._id.toHexString(),
        title: data.conversation.title,
        createdAt: data.conversation.createdAt,
        updatedAt: data.conversation.updatedAt,
      },
      messages: data.messages.map((m) => ({
        id: m._id.toHexString(),
        role: m.role,
        content: m.content,
        toolCalls: m.toolCalls,
        createdAt: m.createdAt,
      })),
    };
  });

  // DELETE /api/conversations/:id - delete conversation
  app.delete<{ Params: { id: string } }>('/conversations/:id', { preHandler: [requireAuth(db, config)] }, async (req, reply) => {
    if (!chatService) {
      return reply.status(503).send({ code: 'llm_unavailable', message: 'Chat service is not configured' });
    }
    const deleted = await chatService.deleteConversation(req.params.id, req.principal!.userId);
    if (!deleted) {
      return reply.status(404).send({ code: 'not_found', message: 'Conversation not found' });
    }
    return { ok: true };
  });

  // POST /api/chat - stream SSE response
  app.post('/chat', { preHandler: [requireAuth(db, config)] }, async (req, reply) => {
    if (!chatService) {
      return reply.status(503).send({ code: 'llm_unavailable', message: 'Chat service is not configured' });
    }

    const parseResult = chatMessageSchema.safeParse(req.body);
    if (!parseResult.success) {
      return reply.status(400).send({
        code: 'validation_error',
        message: 'Invalid request body',
        errors: parseResult.error.errors,
      });
    }

    const userId = req.principal!.userId;
    if (chatService.isTurnInProgress(userId)) {
      return reply.status(409).send({
        code: 'turn_in_progress',
        message: 'Another chat turn is already in progress for this user',
      });
    }

    // Set SSE headers
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache, no-transform');
    reply.raw.setHeader('Connection', 'keep-alive');
    reply.raw.setHeader('X-Accel-Buffering', 'no');
    reply.raw.flushHeaders?.();

    const abortController = new AbortController();
    req.raw.on('close', () => {
      if (!reply.raw.writableEnded) {
        abortController.abort();
      }
    });

    const sendSse = (event: string, data: any) => {
      if (!reply.raw.writableEnded) {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      }
    };

    const userEmail = req.principal!.email ?? '';
    const userName = (userEmail ? userEmail.split('@')[0] : '') || 'User';

    try {
      await chatService.executeTurn({
        userId,
        userEmail,
        userName,
        userRole: req.principal!.role,
        conversationId: parseResult.data.conversationId,
        message: parseResult.data.message,
        confirmedToolCalls: parseResult.data.confirmedToolCalls,
        signal: abortController.signal,
        callbacks: {
          onTurnStart: (d) => sendSse('turn_start', d),
          onTextDelta: (d) => sendSse('text_delta', d),
          onToolCall: (d) => sendSse('tool_call', d),
          onToolResult: (d) => sendSse('tool_result', d),
          onConfirmRequired: (d) => sendSse('confirm_required', d),
          onError: (d) => sendSse('error', d),
          onDone: (d) => sendSse('done', d),
        },
      });
    } catch (err: any) {
      sendSse('error', { code: err.code || 'internal_error', message: err.message });
    } finally {
      if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
    }
  });
};
