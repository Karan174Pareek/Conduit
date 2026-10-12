import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ToolRouter, Principal } from '../router/tool-router.js';

/**
 * Creates a fresh, stateless MCP SDK Server instance per request bound to the authenticated Principal.
 * Uses low-level request handlers to pass through dynamic raw JSON Schemas from the upstream catalog.
 */
export async function handleMcpStatelessRequest(
  req: IncomingMessage,
  res: ServerResponse,
  parsedBody: unknown,
  principal: Principal,
  toolRouter: ToolRouter,
): Promise<void> {
  const server = new Server(
    { name: 'conduit-gateway', version: '0.1.0' },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // 1. List tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = await toolRouter.list(principal);
    return {
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        annotations: t.annotations,
      })),
    };
  });

  // 2. Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await toolRouter.call(principal, name, (args as Record<string, unknown>) ?? {});
      return {
        content: result.content,
        isError: result.isError,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith('Unknown tool')) {
        throw new McpError(ErrorCode.MethodNotFound, message);
      }
      return {
        content: [{ type: 'text', text: message }],
        isError: true,
      };
    }
  });

  // Stateless mode transport: sessionIdGenerator set to undefined
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, parsedBody);
}
