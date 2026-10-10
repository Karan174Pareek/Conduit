import { describe, it, expect, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerWooTools } from '../src/tools/index.js';
import { WooStoreClient } from '../src/store-client.js';
import type { Config } from '../src/config.js';

describe('registerWooTools', () => {
  const mockConfig: Config = {
    PORT: 3100,
    HOST: '0.0.0.0',
    MCP_BEARER_TOKEN: 'secret-token-12345',
    WP_CONSUMER_KEY: 'ck_key',
    WP_CONSUMER_SECRET: 'cs_secret',
    WORDPRESS_URL: 'http://wordpress.local',
    STORE_TIMEZONE: 'Asia/Kolkata',
    REQUEST_TIMEOUT_MS: 1000,
  };

  it('registers all 8 expected tools with annotations', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const client = new WooStoreClient(mockConfig);

    registerWooTools(server, client, 'Asia/Kolkata');

    const registeredTools = (server as any)._registeredTools;
    expect(registeredTools).toBeDefined();

    const expectedTools = [
      'list_products',
      'get_product',
      'create_product',
      'update_product',
      'list_orders',
      'get_order',
      'update_order_status',
      'sales_summary',
    ];

    for (const toolName of expectedTools) {
      expect(registeredTools[toolName]).toBeDefined();
    }

    // Verify annotations
    expect(registeredTools['list_products'].annotations?.readOnlyHint).toBe(true);
    expect(registeredTools['get_product'].annotations?.readOnlyHint).toBe(true);
    expect(registeredTools['create_product'].annotations?.readOnlyHint).toBe(false);
    expect(registeredTools['list_orders'].annotations?.readOnlyHint).toBe(true);
    expect(registeredTools['update_order_status'].annotations?.destructiveHint).toBe(true);
    expect(registeredTools['sales_summary'].annotations?.readOnlyHint).toBe(true);
  });

  it('trims product output to necessary fields only', async () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const client = new WooStoreClient(mockConfig);

    vi.spyOn(client, 'getProduct').mockResolvedValue({
      id: 10,
      name: 'Conduit Edge Node',
      slug: 'conduit-edge-node',
      status: 'publish',
      description: '<p>Powerful edge node.</p>',
      short_description: '<p>Edge hardware</p>',
      price: '249.00',
      regular_price: '249.00',
      sale_price: '',
      sku: 'EDGE-01',
      stock_status: 'instock',
      stock_quantity: 15,
      categories: [{ id: 1, name: 'Hardware' }],
      // Fields that should be trimmed:
      meta_data: [{ key: 'internal_debug', value: 'secret' }],
      _links: {},
    });

    registerWooTools(server, client, 'Asia/Kolkata');

    const tool = (server as any)._registeredTools['get_product'];
    const result = await tool.handler({ id: 10 });

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.id).toBe(10);
    expect(parsed.name).toBe('Conduit Edge Node');
    expect(parsed.description).toBe('Powerful edge node.');
    expect(parsed.meta_data).toBeUndefined();
    expect(parsed._links).toBeUndefined();
  });
});
