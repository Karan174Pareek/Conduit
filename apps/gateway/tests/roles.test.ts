import { describe, it, expect, vi } from 'vitest';
import { requireRole } from '../src/middleware/roles.js';

describe('Role Authorization Guard', () => {
  it('allows request when principal has the required role', async () => {
    const guard = requireRole('admin');
    const req: any = {
      principal: {
        userId: 'user123',
        role: 'admin',
        via: 'session',
        source: 'chat',
      },
    };
    const reply: any = {
      status: vi.fn().mockReturnThis(),
      send: vi.fn(),
    };

    await guard(req, reply);
    expect(reply.status).not.toHaveBeenCalled();
    expect(reply.send).not.toHaveBeenCalled();
  });

  it('rejects with 403 when principal has member role but admin is required', async () => {
    const guard = requireRole('admin');
    const req: any = {
      principal: {
        userId: 'user123',
        role: 'member',
        via: 'session',
        source: 'chat',
      },
    };
    let sentBody: any;
    const reply: any = {
      status: vi.fn().mockImplementation((code: number) => {
        expect(code).toBe(403);
        return {
          send: (body: any) => {
            sentBody = body;
          },
        };
      }),
    };

    await guard(req, reply);
    expect(reply.status).toHaveBeenCalledWith(403);
    expect(sentBody?.code).toBe('forbidden');
  });

  it('rejects with 401 when principal is missing', async () => {
    const guard = requireRole('admin');
    const req: any = {};
    const reply: any = {
      status: vi.fn().mockReturnValue({ send: vi.fn() }),
    };

    await guard(req, reply);
    expect(reply.status).toHaveBeenCalledWith(401);
  });
});
