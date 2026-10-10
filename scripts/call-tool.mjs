import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const toolName = process.argv[2];
let argsJson = process.argv[3] || '{}';

if (fs.existsSync(argsJson)) {
  argsJson = fs.readFileSync(argsJson, 'utf8');
}

const tokenBase64 = execFileSync('kubectl', [
  'get',
  'secret',
  'store-secrets',
  '-n',
  'store-default',
  '-o',
  'jsonpath={.data.WOO_MCP_BEARER_TOKEN}',
]).toString().trim();

const token = Buffer.from(tokenBase64, 'base64').toString('utf8');

const inspectorPath = path.join(
  process.env.LOCALAPPDATA || '',
  'npm-cache',
  '_npx',
  '5a9d879542beca3a',
  'node_modules',
  '@modelcontextprotocol',
  'inspector',
  'clients',
  'launcher',
  'build',
  'index.js',
);

const result = execFileSync(
  process.execPath,
  [
    inspectorPath,
    '--cli',
    '--server-url',
    'http://127.0.0.1:3100/mcp',
    '--transport',
    'http',
    '--header',
    `Authorization: Bearer ${token}`,
    '--method',
    'tools/call',
    '--tool-name',
    toolName,
    '--tool-args-json',
    argsJson,
  ],
  { encoding: 'utf8' },
);

process.stdout.write(result);
