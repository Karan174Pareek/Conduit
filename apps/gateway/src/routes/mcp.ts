import type { FastifyPluginAsync } from 'fastify';
import type { Db } from 'mongodb';
import type { Config } from '../config.js';
import { verifyApiKey } from '../services/api-keys.js';
import { handleMcpStatelessRequest } from '../mcp/server.js';
import type { ToolRouter, Principal } from '../router/tool-router.js';

export interface McpRouteOptions {
  db: Db;
  config: Config;
  toolRouter: ToolRouter;
}

export const mcpRoutes: FastifyPluginAsync<McpRouteOptions> = async (
  fastify,
  opts,
) => {
  const { db, config, toolRouter } = opts;

  const allowedOrigins = config.ALLOWED_ORIGINS.split(',').map((o) => o.trim());

  // 1. POST /mcp: stateless Streamable HTTP front door
  fastify.post('/mcp', async (request, reply) => {
    // DNS rebinding protection: validate Origin when present
    const origin = request.headers['origin'];
    if (origin && !allowedOrigins.includes(origin)) {
      reply.status(403).send({
        error: 'Forbidden',
        message: 'Origin not allowed',
      });
      return;
    }

    // Auth: Bearer API key only (session cookies are NOT accepted on /mcp)
    const authHeader = request.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      reply.header('WWW-Authenticate', 'Bearer');
      reply.status(401).send({
        error: 'Unauthorized',
        message: 'Invalid or missing API key',
      });
      return;
    }

    const token = authHeader.slice(7).trim();
    const verified = await verifyApiKey(db, config.API_KEY_PEPPER, token);

    if (!verified) {
      reply.header('WWW-Authenticate', 'Bearer');
      reply.status(401).send({
        error: 'Unauthorized',
        message: 'Invalid or missing API key',
      });
      return;
    }

    const { user, key } = verified;

    if (user.mustChangePassword) {
      reply.status(403).send({
        error: 'Forbidden',
        code: 'password_change_required',
        message: 'Password change is required before accessing MCP',
      });
      return;
    }

    const principal: Principal = {
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
      via: 'apikey',
      keyId: key._id?.toString(),
      source: 'mcp',
      mustChangePassword: !!user.mustChangePassword,
    };

    // Low-level MCP SDK handler takes control of the HTTP response
    reply.hijack();
    await handleMcpStatelessRequest(
      request.raw,
      reply.raw,
      request.body,
      principal,
      toolRouter,
    );
  });

  // 2. GET /mcp: 405 Method Not Allowed
  fastify.get('/mcp', async (_request, reply) => {
    reply.status(405).send({
      error: 'Method Not Allowed',
      message: 'GET /mcp is not supported in stateless mode',
    });
  });

  // 3. DELETE /mcp: 405 Method Not Allowed
  fastify.delete('/mcp', async (_request, reply) => {
    reply.status(405).send({
      error: 'Method Not Allowed',
      message: 'Session termination is not applicable in stateless mode',
    });
  });
};
