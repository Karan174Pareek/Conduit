import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ToolRouter, type Principal } from '../src/router/tool-router.js';
import type { Db } from 'mongodb';

describe('ToolRouter', () => {
  let mockDb: any;
  let mockUpstreamManager: any;
  let mockAuditSink: any;
  let router: ToolRouter;

  const adminPrincipal: Principal = {
    userId: 'usr_admin',
    role: 'admin',
    via: 'apikey',
  };

  const memberPrincipal: Principal = {
    userId: 'usr_member',
    role: 'member',
    via: 'apikey',
  };

  beforeEach(() => {
    mockDb = {
      collection: vi.fn(),
    };
    mockUpstreamManager = {
      getAllServerStates: vi.fn(),
      getServerState: vi.fn(),
      invokeTool: vi.fn(),
    };
    mockAuditSink = {
      record: vi.fn().mockResolvedValue(undefined),
    };

    router = new ToolRouter(
      mockDb as unknown as Db,
      mockUpstreamManager,
      undefined,
      undefined,
      mockAuditSink,
    );
  });

  it('aggregates tools with slug prefixes and displayName prefixes', async () => {
    mockUpstreamManager.getAllServerStates.mockReturnValue([
      {
        server: {
          slug: 'woo',
          displayName: 'WooCommerce',
          enabled: true,
        },
        breaker: { phase: 'closed' },
      },
    ]);

    mockDb.collection.mockReturnValue({
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([
          {
            name: 'list_products',
            exposedName: 'woo__list_products',
            description: 'List products with filters',
            inputSchema: { type: 'object' },
            annotations: { readOnly: true },
            approval: { status: 'approved' },
          },
        ]),
      }),
    });

    const tools = await router.list(memberPrincipal);
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('woo__list_products');
    expect(tools[0]?.description).toBe('[WooCommerce] List products with filters');
  });

  it('returns identical "Unknown tool" error for non-existent, disabled, and quarantined tools', async () => {
    mockUpstreamManager.getServerState.mockReturnValue(null);

    // 1. Non-existent server
    await expect(router.call(memberPrincipal, 'unknown__tool', {})).rejects.toThrow('Unknown tool "unknown__tool"');
    expect(mockAuditSink.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'denied', exposedName: 'unknown__tool' }),
    );

    // 2. Disabled server
    mockUpstreamManager.getServerState.mockReturnValue({
      server: { slug: 'disabled-srv', enabled: false },
    });
    await expect(router.call(memberPrincipal, 'disabled-srv__tool', {})).rejects.toThrow('Unknown tool "disabled-srv__tool"');

    // 3. Quarantined (changed hash) tool
    mockUpstreamManager.getServerState.mockReturnValue({
      server: { slug: 'woo', enabled: true },
    });
    mockDb.collection.mockReturnValue({
      findOne: vi.fn().mockResolvedValue({
        name: 'unapproved_tool',
        exposedName: 'woo__unapproved_tool',
        approval: { status: 'changed' }, // quarantined
      }),
    });
    await expect(router.call(memberPrincipal, 'woo__unapproved_tool', {})).rejects.toThrow('Unknown tool "woo__unapproved_tool"');
    expect(mockAuditSink.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'quarantined', exposedName: 'woo__unapproved_tool' }),
    );
  });

  it('routes valid tool call and records audit record', async () => {
    mockUpstreamManager.getServerState.mockReturnValue({
      server: { slug: 'woo', enabled: true },
    });
    mockDb.collection.mockReturnValue({
      findOne: vi.fn().mockResolvedValue({
        name: 'list_orders',
        exposedName: 'woo__list_orders',
        approval: { status: 'approved' },
      }),
    });
    mockUpstreamManager.invokeTool.mockResolvedValue({
      content: [{ type: 'text', text: 'orders: []' }],
      isError: false,
    });

    const res = await router.call(adminPrincipal, 'woo__list_orders', { page: 1 });
    expect(res.content[0]?.text).toBe('orders: []');

    expect(mockAuditSink.record).toHaveBeenCalledWith(
      expect.objectContaining({
        serverSlug: 'woo',
        toolName: 'list_orders',
        exposedName: 'woo__list_orders',
        outcome: 'success',
      }),
    );
  });
});
