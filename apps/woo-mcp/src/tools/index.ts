import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WooStoreClient } from '../store-client.js';
import { computeDatePresetRange, type DatePreset } from '../dates.js';

export function registerWooTools(
  server: McpServer,
  client: WooStoreClient,
  storeTimezone = 'Asia/Kolkata',
) {
  // 1. list_products
  server.registerTool(
    'list_products',
    {
      title: 'List Products',
      description: 'List products in the store with optional filtering by status or search keyword.',
      inputSchema: {
        search: z.string().optional().describe('Keyword search on product title and content'),
        status: z
          .enum(['draft', 'pending', 'private', 'publish', 'any'])
          .optional()
          .describe('Filter by product status'),
        per_page: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(10)
          .describe('Results per page (max 50)'),
        page: z.number().int().min(1).default(1).describe('Page number'),
      } as any,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (args: any) => {
      try {
        const raw = await client.listProducts({
          search: args.search,
          status: args.status,
          per_page: args.per_page,
          page: args.page,
        });

        const products = raw.map((p) => ({
          id: p.id,
          name: p.name,
          status: p.status,
          price: p.price,
          regular_price: p.regular_price,
          sale_price: p.sale_price,
          stock_status: p.stock_status,
          stock_quantity: p.stock_quantity,
          categories: Array.isArray(p.categories) ? p.categories.map((c: any) => c.name) : [],
        }));

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(products, null, 2) }],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `[gateway:upstream_tool_error] ${err.message}` }],
        };
      }
    },
  );

  // 2. get_product
  server.registerTool(
    'get_product',
    {
      title: 'Get Product',
      description: 'Get product details by ID.',
      inputSchema: {
        id: z.number().int().positive().describe('Unique WooCommerce product ID'),
      } as any,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (args: any) => {
      try {
        const p = await client.getProduct(args.id);
        const product = {
          id: p.id,
          name: p.name,
          slug: p.slug,
          status: p.status,
          description: (p.description || '').replace(/<[^>]+>/g, '').trim(),
          short_description: (p.short_description || '').replace(/<[^>]+>/g, '').trim(),
          price: p.price,
          regular_price: p.regular_price,
          sale_price: p.sale_price,
          sku: p.sku,
          stock_status: p.stock_status,
          stock_quantity: p.stock_quantity,
          categories: Array.isArray(p.categories) ? p.categories.map((c: any) => c.name) : [],
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(product, null, 2) }],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `[gateway:upstream_tool_error] ${err.message}` }],
        };
      }
    },
  );

  // 3. create_product
  server.registerTool(
    'create_product',
    {
      title: 'Create Product',
      description: 'Create a new product in the store.',
      inputSchema: {
        name: z.string().min(1).describe('Product name'),
        regular_price: z
          .string()
          .regex(/^\d+(\.\d{1,2})?$/, 'Must be a valid decimal string (e.g. "19.99")')
          .describe('Regular price as decimal string'),
        description: z.string().optional().describe('Product description'),
        status: z.enum(['draft', 'publish']).default('publish').describe('Product status'),
        sku: z.string().optional().describe('Unique SKU code'),
        client_reference: z.string().optional().describe('Optional idempotency/client reference'),
      } as any,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async (args: any) => {
      try {
        const p = await client.createProduct({
          name: args.name,
          regular_price: args.regular_price,
          description: args.description,
          status: args.status,
          sku: args.sku,
          client_reference: args.client_reference,
        });

        const created = {
          id: p.id,
          name: p.name,
          price: p.price,
          status: p.status,
          permalink: p.permalink,
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(created, null, 2) }],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `[gateway:upstream_tool_error] ${err.message}` }],
        };
      }
    },
  );

  // 4. update_product
  server.registerTool(
    'update_product',
    {
      title: 'Update Product',
      description: 'Partially update an existing product in the store.',
      inputSchema: {
        id: z.number().int().positive().describe('Unique WooCommerce product ID'),
        name: z.string().optional().describe('Updated product name'),
        regular_price: z
          .string()
          .regex(/^\d+(\.\d{1,2})?$/, 'Must be a valid decimal string (e.g. "19.99")')
          .optional()
          .describe('Updated regular price'),
        description: z.string().optional().describe('Updated product description'),
        status: z.enum(['draft', 'publish', 'trash']).optional().describe('Updated status'),
        sku: z.string().optional().describe('Updated SKU code'),
      } as any,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
      },
    },
    async (args: any) => {
      try {
        const p = await client.updateProduct(args.id, {
          name: args.name,
          regular_price: args.regular_price,
          description: args.description,
          status: args.status,
          sku: args.sku,
        });

        const updated = {
          id: p.id,
          name: p.name,
          price: p.price,
          status: p.status,
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(updated, null, 2) }],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `[gateway:upstream_tool_error] ${err.message}` }],
        };
      }
    },
  );

  // 5. list_orders
  server.registerTool(
    'list_orders',
    {
      title: 'List Orders',
      description: 'List store orders with optional date presets, status, or date ranges.',
      inputSchema: {
        status: z
          .enum(['pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed', 'any'])
          .optional()
          .describe('Filter by order status'),
        after: z.string().optional().describe('Limit to orders after ISO 8601 date'),
        before: z.string().optional().describe('Limit to orders before ISO 8601 date'),
        date_preset: z
          .enum(['today', 'yesterday', 'last_7_days'])
          .optional()
          .describe('Convenient date preset calculated in store timezone'),
        per_page: z
          .number()
          .int()
          .min(1)
          .max(50)
          .default(10)
          .describe('Orders per page (max 50)'),
        page: z.number().int().min(1).default(1).describe('Page number'),
      } as any,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (args: any) => {
      try {
        let after: string | undefined = args.after;
        let before: string | undefined = args.before;

        if (args.date_preset) {
          const range = computeDatePresetRange(args.date_preset as DatePreset, storeTimezone);
          after = range.after;
          before = range.before;
        }

        const raw = await client.listOrders({
          status: args.status,
          after,
          before,
          per_page: args.per_page,
          page: args.page,
        });

        const orders = raw.map((o) => ({
          id: o.id,
          status: o.status,
          date_created: o.date_created,
          total: o.total,
          currency: o.currency,
          payment_method_title: o.payment_method_title,
          customer: {
            first_name: o.billing?.first_name || '',
            last_name: o.billing?.last_name || '',
            email: o.billing?.email || '',
          },
          line_items: Array.isArray(o.line_items)
            ? o.line_items.map((i: any) => ({
                id: i.id,
                name: i.name,
                quantity: i.quantity,
                total: i.total,
              }))
            : [],
        }));

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(orders, null, 2) }],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `[gateway:upstream_tool_error] ${err.message}` }],
        };
      }
    },
  );

  // 6. get_order
  server.registerTool(
    'get_order',
    {
      title: 'Get Order',
      description: 'Get detailed order information by ID.',
      inputSchema: {
        id: z.number().int().positive().describe('Unique WooCommerce order ID'),
      } as any,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (args: any) => {
      try {
        const o = await client.getOrder(args.id);
        const order = {
          id: o.id,
          status: o.status,
          date_created: o.date_created,
          total: o.total,
          currency: o.currency,
          payment_method_title: o.payment_method_title,
          billing: {
            first_name: o.billing?.first_name || '',
            last_name: o.billing?.last_name || '',
            email: o.billing?.email || '',
            phone: o.billing?.phone || '',
          },
          shipping: {
            first_name: o.shipping?.first_name || '',
            last_name: o.shipping?.last_name || '',
            address_1: o.shipping?.address_1 || '',
            city: o.shipping?.city || '',
            state: o.shipping?.state || '',
            postcode: o.shipping?.postcode || '',
            country: o.shipping?.country || '',
          },
          line_items: Array.isArray(o.line_items)
            ? o.line_items.map((i: any) => ({
                id: i.id,
                name: i.name,
                product_id: i.product_id,
                quantity: i.quantity,
                subtotal: i.subtotal,
                total: i.total,
              }))
            : [],
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(order, null, 2) }],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `[gateway:upstream_tool_error] ${err.message}` }],
        };
      }
    },
  );

  // 7. update_order_status
  server.registerTool(
    'update_order_status',
    {
      title: 'Update Order Status',
      description: 'Update the processing status of an order.',
      inputSchema: {
        id: z.number().int().positive().describe('Unique WooCommerce order ID'),
        status: z
          .enum(['pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed'])
          .describe('New WooCommerce order status'),
      } as any,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
      },
    },
    async (args: any) => {
      try {
        const o = await client.updateOrderStatus(args.id, args.status);
        const updated = {
          id: o.id,
          status: o.status,
          date_modified: o.date_modified,
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(updated, null, 2) }],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `[gateway:upstream_tool_error] ${err.message}` }],
        };
      }
    },
  );

  // 8. sales_summary
  server.registerTool(
    'sales_summary',
    {
      title: 'Sales Summary',
      description: 'Get sales and order totals computed for a preset period.',
      inputSchema: {
        date_preset: z
          .enum(['today', 'yesterday', 'last_7_days'])
          .default('today')
          .describe('Period preset computed in store timezone'),
      } as any,
      annotations: {
        readOnlyHint: true,
      },
    },
    async (args: any) => {
      try {
        const preset = (args.date_preset || 'today') as DatePreset;
        const range = computeDatePresetRange(preset, storeTimezone);
        const orders = await client.listOrders({
          after: range.after,
          before: range.before,
          per_page: 50,
        });

        let totalSales = 0;
        let currency = 'USD';
        for (const order of orders) {
          totalSales += parseFloat(order.total || '0');
          if (order.currency) {
            currency = order.currency;
          }
        }

        const summary = {
          period: preset,
          timezone: storeTimezone,
          after: range.after,
          before: range.before,
          orders_count: orders.length,
          total_sales: totalSales.toFixed(2),
          currency,
        };

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(summary, null, 2) }],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: `[gateway:upstream_tool_error] ${err.message}` }],
        };
      }
    },
  );
}
