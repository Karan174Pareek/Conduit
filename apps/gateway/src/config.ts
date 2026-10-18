import { z } from 'zod';

export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  API_KEY_PEPPER: z.string().min(32, 'API_KEY_PEPPER must be at least 32 characters'),
  CREDENTIAL_ENC_KEYS: z
    .string()
    .min(1, 'CREDENTIAL_ENC_KEYS is required')
    .refine(
      (val) => {
        const parts = val.split(',');
        return parts.every((p) => {
          const colonIdx = p.indexOf(':');
          if (colonIdx === -1) return false;
          const b64 = p.slice(colonIdx + 1);
          try {
            const buf = Buffer.from(b64, 'base64');
            return buf.length === 32;
          } catch {
            return false;
          }
        });
      },
      'CREDENTIAL_ENC_KEYS must be kid:base64 where base64 decodes to 32 bytes (comma-separated)',
    ),
  BOOTSTRAP_ADMIN_EMAIL: z.string().email('BOOTSTRAP_ADMIN_EMAIL must be a valid email'),
  BOOTSTRAP_ADMIN_PASSWORD: z
    .string()
    .min(8, 'BOOTSTRAP_ADMIN_PASSWORD must be at least 8 characters'),
  GEMINI_API_KEY: z.string().optional().default(''),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  PUBLIC_DASHBOARD_URL: z.string().default('http://dashboard.localhost'),
  PUBLIC_GATEWAY_URL: z.string().default('http://gateway.localhost'),
  ALLOWED_ORIGINS: z.string().default('http://dashboard.localhost'),
  WOO_MCP_URL: z
    .string()
    .default('http://store-woocommerce-store-woo-mcp.store-default.svc.cluster.local:3100/mcp'),
  WOO_MCP_BEARER_TOKEN: z.string().optional().default(''),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  METRICS_PORT: z.coerce.number().default(9090),
  SSRF_ALLOWED_HOSTS: z.string().default('store-woocommerce-store-woo-mcp.store-default.svc.cluster.local'),
});

export type Config = z.infer<typeof configSchema>;

export interface EncryptionKey {
  kid: string;
  keyBuffer: Buffer;
}

export function parseEncryptionKeys(keysString: string): EncryptionKey[] {
  const parts = keysString.split(',').map((p) => p.trim()).filter(Boolean);
  return parts.map((part) => {
    const colonIdx = part.indexOf(':');
    const kid = part.slice(0, colonIdx);
    const b64 = part.slice(colonIdx + 1);
    const keyBuffer = Buffer.from(b64, 'base64');
    return { kid, keyBuffer };
  });
}

const PLACEHOLDER_PATTERNS = ['changeme', 'placeholder', 'secret', 'password', '12345678', 'admin'];

export function validateProductionConfig(config: Config, env: NodeJS.ProcessEnv = process.env): void {
  const isProd = env.NODE_ENV === 'production';

  // 1. Secrets check (>= 32 bytes and not placeholders)
  const secretsToCheck: [string, string][] = [
    ['SESSION_SECRET', config.SESSION_SECRET],
    ['API_KEY_PEPPER', config.API_KEY_PEPPER],
  ];

  for (const [name, val] of secretsToCheck) {
    if (val.length < 32) {
      console.error(`Fatal config error: ${name} must be at least 32 characters long`);
      process.exit(1);
    }
    const lower = val.toLowerCase();
    for (const ph of PLACEHOLDER_PATTERNS) {
      if (lower.includes(ph)) {
        console.error(`Fatal config error: ${name} contains insecure placeholder value "${ph}"`);
        process.exit(1);
      }
    }
  }

  // 2. Production URL and Origin checks
  if (isProd) {
    const isLocalCluster = config.PUBLIC_GATEWAY_URL.includes('.localhost');
    if (!isLocalCluster) {
      if (!config.PUBLIC_GATEWAY_URL.startsWith('https://')) {
        console.error('Fatal config error: In production, PUBLIC_GATEWAY_URL must use https://');
        process.exit(1);
      }
      if (!config.PUBLIC_DASHBOARD_URL.startsWith('https://')) {
        console.error('Fatal config error: In production, PUBLIC_DASHBOARD_URL must use https://');
        process.exit(1);
      }
      const origins = config.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
      if (origins.length === 0 || origins.some((o) => !o.startsWith('https://') || o.includes('localhost'))) {
        console.error('Fatal config error: In production, ALLOWED_ORIGINS must be explicit https:// origins (no localhost)');
        process.exit(1);
      }
    }
    if (env.CHAT_LLM === 'fake') {
      console.error('Fatal config error: In production, CHAT_LLM cannot be "fake"');
      process.exit(1);
    }
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    console.error(`Fatal config error: ${issues}`);
    process.exit(1);
  }
  validateProductionConfig(result.data, env);
  return result.data;
}
