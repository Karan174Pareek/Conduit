import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Config } from './config.js';
import { verifyBearerToken } from './auth.js';
import { WooStoreClient } from './store-client.js';
import { registerWooTools } from './tools/index.js';

export function createServer(config: Config) {
  const client = new WooStoreClient(config);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method ?? 'GET';

    // 1. Liveness probe (no token needed)
    if (method === 'GET' && pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    // 2. Readiness probe (checks store reachable, cached 5s, no token needed)
    if (method === 'GET' && pathname === '/readyz') {
      const isReady = await client.checkReadiness();
      if (isReady) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ready' }));
      } else {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'unready', error: 'WooCommerce store is unreachable' }));
      }
      return;
    }

    // 3. MCP Streamable HTTP endpoint
    if (pathname === '/mcp') {
      // Streamable HTTP allows POST for requests and GET for SSE streaming if supported,
      // but MCP specification uses POST for stateless JSON-RPC requests.
      if (method !== 'POST' && method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method Not Allowed' }));
        return;
      }

      // Check Bearer token with constant-time comparison
      const authHeader = req.headers.authorization;
      if (!verifyBearerToken(authHeader, config.MCP_BEARER_TOKEN)) {
        res.writeHead(401, {
          'Content-Type': 'application/json',
          'WWW-Authenticate': 'Bearer error="invalid_token"',
        });
        res.end(JSON.stringify({ error: 'Unauthorized: valid MCP bearer token required' }));
        return;
      }

      try {
        // Stateless: new server instance and transport per request
        const mcpServer = new McpServer({
          name: 'conduit-woo-mcp',
          version: '0.1.0',
        });

        registerWooTools(mcpServer, client, config.STORE_TIMEZONE);

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined, // Stateless mode
        });

        await mcpServer.connect(transport);
        await transport.handleRequest(req, res);
      } catch {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal MCP Server Error' }));
        }
      }
      return;
    }

    // 4. Default 404 for unknown endpoints
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  return {
    server,
    client,
    start: () =>
      new Promise<void>((resolve) => {
        server.listen(config.PORT, config.HOST, () => {
          resolve();
        });
      }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
