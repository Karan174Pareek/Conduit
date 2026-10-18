import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

export interface NoteItem {
  id: string;
  title: string;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export const MAX_NOTES_COUNT = 500;
export const MAX_TITLE_LENGTH = 200;
export const MAX_CONTENT_LENGTH = 20000;
export const MAX_TAGS_COUNT = 20;
export const MAX_TAG_LENGTH = 50;

function loadNotesFromDisk(filePath: string): Map<string, NoteItem> {
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const map = new Map<string, NoteItem>();
        for (const item of parsed) {
          if (item && item.id && item.title) {
            map.set(item.id, item);
          }
        }
        return map;
      }
    }
  } catch (err) {
    process.stderr.write(`[notes-mcp] Notice: Could not read existing notes from ${filePath}: ${err}\n`);
  }
  return new Map();
}

function saveNotesToDisk(filePath: string, notes: NoteItem[]): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${filePath}.tmp.${Date.now()}.${crypto.randomBytes(3).toString('hex')}`;
  const data = JSON.stringify(notes, null, 2);
  const fd = fs.openSync(tmpPath, 'w');
  try {
    fs.writeSync(fd, data, 0, 'utf-8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmpPath, filePath);
}

export function createNotesServer(
  port = 3200,
  host = '0.0.0.0',
  bearerToken?: string,
  storagePath = process.env.NOTES_FILE_PATH || '/data/notes.json',
) {
  // Shared team notes stored in persistent JSON file backed by PVC
  const notesStore = loadNotesFromDisk(storagePath);

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
          name: 'conduit-notes-mcp',
          version: '1.0.0',
        });

        // 1. notes_create
        mcpServer.registerTool(
          'notes_create',
          {
            title: 'Create Team Note',
            description: 'Create a new team note with title, content, and optional tags.',
            inputSchema: {
              title: z
                .string()
                .min(1, 'Title cannot be empty')
                .max(MAX_TITLE_LENGTH, `Title cannot exceed ${MAX_TITLE_LENGTH} characters`)
                .describe('Title of the note'),
              content: z
                .string()
                .min(1, 'Content cannot be empty')
                .max(MAX_CONTENT_LENGTH, `Content cannot exceed ${MAX_CONTENT_LENGTH} characters`)
                .describe('Detailed text content of the note'),
              tags: z
                .array(z.string().max(MAX_TAG_LENGTH, `Tag cannot exceed ${MAX_TAG_LENGTH} characters`))
                .max(MAX_TAGS_COUNT, `Cannot have more than ${MAX_TAGS_COUNT} tags`)
                .optional()
                .default([])
                .describe('Tags for categorizing the note'),
            } as any,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
            },
          },
          async (args: any) => {
            if (notesStore.size >= MAX_NOTES_COUNT) {
              return {
                isError: true,
                content: [
                  {
                    type: 'text' as const,
                    text: `Storage limit exceeded: maximum ${MAX_NOTES_COUNT} notes allowed.`,
                  },
                ],
              };
            }

            const id = `note-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
            const note: NoteItem = {
              id,
              title: args.title.trim(),
              content: args.content.trim(),
              tags: (args.tags || []).map((t: string) => t.trim().toLowerCase()),
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
            notesStore.set(id, note);
            saveNotesToDisk(storagePath, Array.from(notesStore.values()));

            return {
              content: [{ type: 'text' as const, text: JSON.stringify(note, null, 2) }],
            };
          },
        );

        // 2. notes_list
        mcpServer.registerTool(
          'notes_list',
          {
            title: 'List Team Notes',
            description: 'List all shared team notes with optional tag filtering.',
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
            title: 'Get Team Note',
            description: 'Retrieve a specific team note by ID.',
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
            title: 'Search Team Notes',
            description: 'Search shared notes by keyword across title, content, and tags.',
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

        // 5. notes_delete
        mcpServer.registerTool(
          'notes_delete',
          {
            title: 'Delete Team Note',
            description: 'Delete a team note by unique ID.',
            inputSchema: {
              id: z.string().min(1).describe('Unique ID of the note to delete'),
            } as any,
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
            },
          },
          async (args: any) => {
            if (!notesStore.has(args.id)) {
              return {
                isError: true,
                content: [{ type: 'text' as const, text: `Note with id "${args.id}" not found.` }],
              };
            }
            notesStore.delete(args.id);
            saveNotesToDisk(storagePath, Array.from(notesStore.values()));
            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ deleted: true, id: args.id }) }],
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
    notesStore,
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
