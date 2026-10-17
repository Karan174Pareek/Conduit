import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

/**
 * Safe Recursive Descent Math Parser without eval() or Function().
 * Supports +, -, *, /, ^, parentheses, negative numbers.
 */
export function safeEvaluateMath(expr: string): number {
  const sanitized = expr.replace(/\s+/g, '');
  if (!/^[-+*/^().0-9]+$/.test(sanitized)) {
    throw new Error('Invalid mathematical expression. Only numbers and +, -, *, /, ^, () are allowed.');
  }

  let pos = 0;

  function peek(): string {
    return sanitized[pos] || '';
  }

  function get(): string {
    return sanitized[pos++] || '';
  }

  function parseNumber(): number {
    const start = pos;
    if (peek() === '-') {
      get();
    }
    while (/[0-9.]/.test(peek())) {
      get();
    }
    const numStr = sanitized.slice(start, pos);
    const val = parseFloat(numStr);
    if (isNaN(val)) {
      throw new Error(`Expected number at position ${start}`);
    }
    return val;
  }

  function parsePrimary(): number {
    if (peek() === '(') {
      get(); // consume '('
      const val = parseExpression();
      if (get() !== ')') {
        throw new Error('Mismatched parentheses: expected ")"');
      }
      return val;
    }
    if (peek() === '+') {
      get();
      return parsePrimary();
    }
    if (peek() === '-') {
      get();
      return -parsePrimary();
    }
    return parseNumber();
  }

  function parseFactor(): number {
    let base = parsePrimary();
    if (peek() === '^') {
      get();
      const exp = parseFactor();
      base = Math.pow(base, exp);
    }
    return base;
  }

  function parseTerm(): number {
    let val = parseFactor();
    while (peek() === '*' || peek() === '/') {
      const op = get();
      const next = parseFactor();
      if (op === '*') {
        val *= next;
      } else {
        if (next === 0) {
          throw new Error('Division by zero');
        }
        val /= next;
      }
    }
    return val;
  }

  function parseExpression(): number {
    let val = parseTerm();
    while (peek() === '+' || peek() === '-') {
      const op = get();
      const next = parseTerm();
      if (op === '+') {
        val += next;
      } else {
        val -= next;
      }
    }
    return val;
  }

  const result = parseExpression();
  if (pos < sanitized.length) {
    throw new Error(`Unexpected character "${sanitized[pos]}" at index ${pos}`);
  }
  return result;
}

export function createUtilsServer(port = 3300, host = '0.0.0.0', bearerToken?: string) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method ?? 'GET';

    if (method === 'GET' && (pathname === '/healthz' || pathname === '/readyz')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
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
          name: 'conduit-utils-mcp',
          version: '1.0.0',
        });

        // 1. utils_calculate
        mcpServer.registerTool(
          'utils_calculate',
          {
            title: 'Calculate Arithmetic Expression',
            description: 'Safely evaluate an arithmetic math expression (e.g. "12.50 * 4 + (15 / 3)"). Never uses eval.',
            inputSchema: {
              expression: z.string().min(1).describe('Mathematical expression to calculate'),
            } as any,
            annotations: {
              readOnlyHint: true,
            },
          },
          async (args: any) => {
            try {
              const result = safeEvaluateMath(args.expression);
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: JSON.stringify({ expression: args.expression, result, formatted: Number(result.toFixed(4)) }, null, 2),
                  },
                ],
              };
            } catch (err: any) {
              return {
                isError: true,
                content: [{ type: 'text' as const, text: `Calculation error: ${err.message}` }],
              };
            }
          },
        );

        // 2. utils_format_date
        mcpServer.registerTool(
          'utils_format_date',
          {
            title: 'Format Date & Time',
            description: 'Format an ISO date string into human-readable representations and localized time.',
            inputSchema: {
              isoDate: z.string().describe('ISO 8601 date string, or "now" for current timestamp'),
              timezone: z.string().optional().default('UTC').describe('IANA timezone, e.g. "Asia/Kolkata", "America/New_York", "UTC"'),
            } as any,
            annotations: {
              readOnlyHint: true,
            },
          },
          async (args: any) => {
            try {
              const date = args.isoDate === 'now' ? new Date() : new Date(args.isoDate);
              if (isNaN(date.getTime())) {
                throw new Error('Invalid ISO date format');
              }
              const tz = args.timezone || 'UTC';
              const formatted = {
                iso: date.toISOString(),
                utcString: date.toUTCString(),
                localized: date.toLocaleString('en-US', { timeZone: tz }),
                dateOnly: date.toLocaleDateString('en-US', { timeZone: tz }),
                timeOnly: date.toLocaleTimeString('en-US', { timeZone: tz }),
                unixTimestamp: Math.floor(date.getTime() / 1000),
                timezone: tz,
              };
              return {
                content: [{ type: 'text' as const, text: JSON.stringify(formatted, null, 2) }],
              };
            } catch (err: any) {
              return {
                isError: true,
                content: [{ type: 'text' as const, text: `Date formatting error: ${err.message}` }],
              };
            }
          },
        );

        // 3. utils_text_transform
        mcpServer.registerTool(
          'utils_text_transform',
          {
            title: 'Text Transformation & Statistics',
            description: 'Transform text (uppercase, lowercase, slugify, reverse) or compute word and character statistics.',
            inputSchema: {
              text: z.string().describe('Input string to process'),
              action: z
                .enum(['uppercase', 'lowercase', 'slugify', 'reverse', 'stats'])
                .default('stats')
                .describe('Transformation or analysis action'),
            } as any,
            annotations: {
              readOnlyHint: true,
            },
          },
          async (args: any) => {
            const input = String(args.text || '');
            let output: unknown;

            switch (args.action) {
              case 'uppercase':
                output = input.toUpperCase();
                break;
              case 'lowercase':
                output = input.toLowerCase();
                break;
              case 'slugify':
                output = input
                  .toLowerCase()
                  .trim()
                  .replace(/[^\w\s-]/g, '')
                  .replace(/[\s_-]+/g, '-')
                  .replace(/^-+|-+$/g, '');
                break;
              case 'reverse':
                output = input.split('').reverse().join('');
                break;
              case 'stats':
              default: {
                const words = input.trim() ? input.trim().split(/\s+/).length : 0;
                output = {
                  length: input.length,
                  words,
                  lines: input.split('\n').length,
                };
                break;
              }
            }

            return {
              content: [{ type: 'text' as const, text: JSON.stringify({ action: args.action, result: output }, null, 2) }],
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
