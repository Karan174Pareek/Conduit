import { z } from 'zod';

export const configSchema = z.object({
  PORT: z.coerce.number().default(3100),
  HOST: z.string().default('0.0.0.0'),
  MCP_BEARER_TOKEN: z.string().min(8, 'MCP_BEARER_TOKEN must be at least 8 characters'),
  WP_CONSUMER_KEY: z.string().min(1, 'WP_CONSUMER_KEY is required'),
  WP_CONSUMER_SECRET: z.string().min(1, 'WP_CONSUMER_SECRET is required'),
  WORDPRESS_URL: z.string().url().default('http://store-woocommerce-store-wordpress.store-default.svc.cluster.local'),
  STORE_TIMEZONE: z.string().default('Asia/Kolkata'),
  REQUEST_TIMEOUT_MS: z.coerce.number().default(10000),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(env = process.env): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const errorDetails = result.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new Error(`Invalid woo-mcp configuration: ${errorDetails}`);
  }
  return result.data;
}
