import type { Db } from 'mongodb';
import { CredentialCrypto } from './crypto.js';
import type { McpServerDocument } from '../db/types.js';
import type { FastifyBaseLogger } from 'fastify';

export interface SeedOptions {
  wooMcpUrl: string;
  wooMcpBearerToken?: string;
}

/**
 * Idempotently seeds the default first-party WooCommerce MCP server.
 * Re-running changes nothing unless the URL or Secret changed.
 */
export async function seedDefaultServers(
  db: Db,
  crypto: CredentialCrypto,
  options: SeedOptions,
  logger?: FastifyBaseLogger,
): Promise<void> {
  const collection = db.collection<McpServerDocument>('mcp_servers');
  const existing = await collection.findOne({ slug: 'woo' });

  const url = options.wooMcpUrl || 'http://store-woocommerce-store-woo-mcp.store-default.svc.cluster.local:3100/mcp';
  const rawToken = options.wooMcpBearerToken?.trim() || '';

  if (!existing) {
    logger?.info({ slug: 'woo', url }, 'Seeding default WooCommerce MCP server');
    const auth = rawToken
      ? crypto.encryptCredential('woo', rawToken, 'bearer')
      : { type: 'none' as const };

    const doc: McpServerDocument = {
      slug: 'woo',
      displayName: 'WooCommerce (default store)',
      url,
      enabled: true,
      trusted: true,
      system: true,
      origin: 'seed',
      auth,
      callTimeoutMs: 30000,
      maxConcurrent: 8,
      approveOnAdd: false,
      status: {
        state: 'connected',
        reasonCode: null,
        reason: null,
        checkedAt: null,
        lastSuccessAt: null,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await collection.insertOne(doc);
    return;
  }

  // If already exists, verify if URL or token changed
  let tokenChanged = false;
  if (rawToken) {
    try {
      const currentToken = crypto.decryptCredential('woo', existing.auth);
      if (currentToken !== rawToken) {
        tokenChanged = true;
      }
    } catch {
      tokenChanged = true;
    }
  }

  const urlChanged = existing.url !== url;

  if (urlChanged || tokenChanged) {
    logger?.info({ slug: 'woo', urlChanged, tokenChanged }, 'Updating seeded WooCommerce MCP server configuration');
    const updateFields: Partial<McpServerDocument> = {
      updatedAt: new Date(),
    };

    if (urlChanged) {
      updateFields.url = url;
    }

    if (tokenChanged && rawToken) {
      updateFields.auth = crypto.encryptCredential('woo', rawToken, 'bearer');
    }

    await collection.updateOne({ slug: 'woo' }, { $set: updateFields });
  }
}
