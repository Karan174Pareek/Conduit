import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import crypto from 'node:crypto';

export interface NoteItem {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export function createNotesServer(port = 3200, host = '0.0.0.0', bearerToken?: string) {
  // In-memory store pre-seeded with helpful sample notes
  const notesStore = new Map<string, NoteItem>([
    [
      'note-1',
      {
        id: 'note-1',
        title: 'WooCommerce Fulfillment Standard Operating Procedures',
        content: 'All orders over $100 require signature confirmation. Backordered items must be flagged to inventory manager.',
        tags: ['operations', 'shipping', 'sop'],
        createdAt: new Date(Date.now() - 86400000).toISOString(),
        updatedAt: new Date(Date.now() - 86400000).toISOString(),
      },
    ],
    [
      'note-2',
      {
        id: 'note-2',
        title: 'Customer Support Escalation Contacts',
        content: 'Tier 2 support lead: support-lead@conduit.localhost. Emergency pagerduty service: #incident-response.',
        tags: ['support', 'contacts'],
        createdAt: new Date(Date.now() - 43200000).toISOString(),
        updatedAt: new Date(Date.now() - 43200000).toISOString(),
      },
    ],
  ]);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method ?? 'GET';

    if (method === 'GET' && (pathname === '/healthz' || pathname === '/readyz')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', notesCount: notesStore.size }));
      return;
    }

    if (pathname === '/mcp') {
      if (method !== 'POST' && method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method Not Allowed' }));
        return;
      }

      if (bearerToken) {
        const authHeader = req.headers.authorization;
        const expected = `Bearer ${bearerToken}`;
        if (!authHeader || authHeader !== expected) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Unauthorized: invalid bearer token' }));
          return;
        }
      }

      try {
        const mcpServer = new McpServer({
          name: 'conduit-demo-notes-mcp',
          version: '0.1.0',
        });

        // 1. notes_create
        mcpServer.registerTool(
          'notes_create',
          {
            title: 'Create Note',
            description: 'Create a new team note with title, content, and optional tags.',
            inputSchema: {
              title: z.string().min(1).describe('Title of the note'),
              content: z.string().min(1).describe('Detailed text content of the note'),
              tags: z.array(z.string()).optional().default([]).describe('Tags for categorizing the note'),
            } as any,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
            },
          },
          async (args: any) => {
            const id = `note-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
            const note: NoteItem = {
              id,
              title: args.title,
              content: args.content,
              tags: args.tags || [],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            notesStore.set(id, note);
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(note, null, 2) }],
            };
          },
        );

        // 2. notes_list
        mcpServer.registerTool(
          'notes_list',
          {
            title: 'List Notes',
            description: 'List all team notes with optional tag filtering.',
            inputSchema: {
              tag: z.string().optional().describe('Filter notes matching a specific tag'),
            } as any,
            annotations: {
              readOnlyHint: true,
            },
          },
          async (args: any) => {
            let list = Array.from(notesStore.values());
            if (args.tag) {
              const filterTag = args.tag.toLowerCase();
              list = list.filter((n) => n.tags.some((t) => t.toLowerCase() === filterTag));
            }
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(list, null, 2) }],
            };
          },
        );

        // 3. notes_get
        mcpServer.registerTool(
          'notes_get',
          {
            title: 'Get Note',
            description: 'Retrieve a specific note by ID.',
            inputSchema: {
              id: z.string().min(1).describe('Unique ID of the note'),
            } as any,
            annotations: {
              readOnlyHint: true,
            },
          },
          async (args: any) => {
            const note = notesStore.get(args.id);
            if (!note) {
              return {
                isError: true,
                content: [{ type: 'text' as const, text: `Note with id "${args.id}" not found.` }],
              };
            }
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(note, null, 2) }],
            };
          },
        );

        // 4. notes_search
        mcpServer.registerTool(
          'notes_search',
          {
            title: 'Search Notes',
            description: 'Search notes by keyword across title, content, and tags.',
            inputSchema: {
              query: z.string().min(1).describe('Search keyword or phrase'),
            } as any,
            annotations: {
              readOnlyHint: true,
            },
          },
          async (args: any) => {
            const q = args.query.toLowerCase();
            const matched = Array.from(notesStore.values()).filter(
              (n) =>
                n.title.toLowerCase().includes(q) ||
                n.content.toLowerCase().includes(q) ||
                n.tags.some((t) => t.toLowerCase().includes(q)),
            );
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(matched, null, 2) }],
            };
          },
        );

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });

        await mcpServer.connect(transport);
        await transport.handleRequest(req, res);
      } catch (err: any) {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message || 'Internal MCP Error' }));
        }
      }
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  return {
    server,
    start: () =>
      new Promise<void>((resolve) => {
        server.listen(port, host, () => {
          resolve();
        });
      }),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
