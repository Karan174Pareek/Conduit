import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { ToolRouter } from '../src/router/tool-router.js';
import { getIsolatedTestDbUri } from './test-db-helper.js';
import { MongoClient, type Db } from 'mongodb';

function createFakeMcpServer(serverName: string, port: number) {
  const mcpServer = new McpServer({
    name: serverName,
    version: '1.0.0',
  });

  // Both servers register the IDENTICAL tool name: "search"
  mcpServer.registerTool(
    'search',
    {
      title: `${serverName} Search Tool`,
      description: `Search query tool on ${serverName}`,
      inputSchema: {
        query: z.string().describe('Search query string'),
      } as any,
    },
    async (args: any) => {
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ originServer: serverName, query: args.query, found: true }),
          },
        ],
      };
    },
  );

  const server = http.createServer(async (req, res) => {
    if (req.url === '/mcp' && req.method === 'POST') {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res);
      return;
    }
    res.writeHead(404);
    res.end();
  });

  return {
    start: () =>
      new Promise<void>((resolve) => {
        server.listen(port, '127.0.0.1', () => resolve());
      }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

describe('MCP Upstream Tool Name Collision Handling', () => {
  let mongoClient: MongoClient;
  let db: Db;
  let srvA: ReturnType<typeof createFakeMcpServer>;
  let srvB: ReturnType<typeof createFakeMcpServer>;

  beforeEach(async () => {
    const { uri, dbName } = getIsolatedTestDbUri('name_collision_test');
    mongoClient = new MongoClient(uri);
    await mongoClient.connect();
    db = mongoClient.db(dbName);

    // Start Server A on port 3381 and Server B on port 3382
    srvA = createFakeMcpServer('alpha-mcp', 3381);
    srvB = createFakeMcpServer('beta-mcp', 3382);
    await srvA.start();
    await srvB.start();
  });

  afterEach(async () => {
    await srvA.close();
    await srvB.close();
    await db.dropDatabase();
    await mongoClient.close();
  });

  it('proves two upstreams with identical tool names ("search") are namespaced and callable without colliding', async () => {
    const mockUpstreamManager: any = {
      getAllServerStates: () => [
        {
          server: { slug: 'alpha', displayName: 'Alpha Server', enabled: true, status: { state: 'connected' } },
          breaker: { phase: 'closed' },
        },
        {
          server: { slug: 'beta', displayName: 'Beta Server', enabled: true, status: { state: 'connected' } },
          breaker: { phase: 'closed' },
        },
      ],
      getServerState: (slug: string) => ({
        server: { slug, displayName: `${slug} Server`, enabled: true, status: { state: 'connected' } },
        breaker: { phase: 'closed' },
      }),
      invokeTool: async (slug: string, toolName: string, args: any) => {
        return {
          content: [{ type: 'text', text: JSON.stringify({ originServer: slug, toolName, query: args.query }) }],
        };
      },
    };

    // Store tools in database (tool_catalog collection)
    await db.collection('tool_catalog').insertMany([
      {
        serverId: 'alpha',
        name: 'search',
        exposedName: 'alpha__search',
        description: 'Search on alpha server',
        inputSchema: { type: 'object' },
        approval: { status: 'approved' },
        removedAt: null,
      },
      {
        serverId: 'beta',
        name: 'search',
        exposedName: 'beta__search',
        description: 'Search on beta server',
        inputSchema: { type: 'object' },
        approval: { status: 'approved' },
        removedAt: null,
      },
    ]);

    const router = new ToolRouter(db, mockUpstreamManager, undefined, undefined, undefined);
    const principal: any = { userId: 'u1', role: 'member', via: 'apikey' };

    // 1. List tools: both must appear with prefix
    const tools = await router.list(principal);
    expect(tools).toHaveLength(2);

    const alphaTool = tools.find((t) => t.name === 'alpha__search');
    const betaTool = tools.find((t) => t.name === 'beta__search');

    expect(alphaTool).toBeDefined();
    expect(betaTool).toBeDefined();
    expect(alphaTool?.name).toBe('alpha__search');
    expect(betaTool?.name).toBe('beta__search');

    // 2. Call alpha tool: routes strictly to alpha
    const resA: any = await router.call(principal, 'alpha__search', { query: 'test-alpha' });
    const parsedA = JSON.parse(resA.content[0].text);
    expect(parsedA.originServer).toBe('alpha');
    expect(parsedA.toolName).toBe('search');
    expect(parsedA.query).toBe('test-alpha');

    // 3. Call beta tool: routes strictly to beta
    const resB: any = await router.call(principal, 'beta__search', { query: 'test-beta' });
    const parsedB = JSON.parse(resB.content[0].text);
    expect(parsedB.originServer).toBe('beta');
    expect(parsedB.toolName).toBe('search');
    expect(parsedB.query).toBe('test-beta');
  });
});
