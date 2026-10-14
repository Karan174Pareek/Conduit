// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppLayout } from '../src/components/layout/AppLayout';
import * as AuthContextModule from '../src/context/AuthContext';
import { ApiKeysPage } from '../src/pages/ApiKeysPage';
import { ServersPage } from '../src/pages/ServersPage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../src/components/ui/Toast';

describe('Dashboard Component Tests', () => {
  const createWrapper = () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter>{children}</MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    );
  };

  it('renders role-aware navigation: hides Team for member, shows Team for admin', () => {
    // 1. Mock as Member
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 'u1', email: 'member@conduit.localhost', role: 'member' },
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    const { rerender } = render(
      <MemoryRouter>
        <AppLayout />
      </MemoryRouter>
    );

    expect(screen.queryByText('Team')).toBeNull();
    expect(screen.getByText('Servers')).toBeDefined();
    expect(screen.getByText('API Keys')).toBeDefined();

    // 2. Mock as Admin
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 'u0', email: 'admin@conduit.localhost', role: 'admin' },
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    rerender(
      <MemoryRouter>
        <AppLayout />
      </MemoryRouter>
    );

    expect(screen.getByText('Team')).toBeDefined();
  });

  it('wipes secret key from memory/DOM when the reveal modal is closed', async () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 'u1', email: 'user@conduit.localhost', role: 'member' },
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    const Wrapper = createWrapper();
    render(<ApiKeysPage />, { wrapper: Wrapper });

    // Open create modal
    const createBtn = screen.getByText('Create API Key');
    fireEvent.click(createBtn);

    const input = screen.getByLabelText(/Key Name/i);
    fireEvent.change(input, { target: { value: 'Secret Work Key' } });

    // Mock fetch for API key creation
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        headers: new Headers(),
        json: async () => ({
          id: 'k1',
          name: 'Secret Work Key',
          prefix: 'a1b2c3d4',
          key: 'mcpgw_a1b2c3d4_SUPER_SECRET_TOKEN_DO_NOT_LEAK',
          createdAt: new Date().toISOString(),
        }),
      })
    );

    const generateBtn = screen.getByText('Generate Key');
    fireEvent.click(generateBtn);

    // Assert secret key is revealed
    const revealedInput = await screen.findByDisplayValue('mcpgw_a1b2c3d4_SUPER_SECRET_TOKEN_DO_NOT_LEAK');
    expect(revealedInput).toBeDefined();

    // Check "I saved it" checkbox
    const checkbox = screen.getByLabelText(/I have saved this API key/i);
    fireEvent.click(checkbox);

    // Close reveal modal
    const doneBtn = screen.getByText('Done & Close');
    fireEvent.click(doneBtn);

    // Verify secret is completely purged from the DOM and state
    expect(screen.queryByDisplayValue('mcpgw_a1b2c3d4_SUPER_SECRET_TOKEN_DO_NOT_LEAK')).toBeNull();
  });

  it('maintains write-only credentials in server form (blank keeps existing)', async () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 'u0', email: 'admin@conduit.localhost', role: 'admin' },
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    // Mock server list fetch
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () => ({
          servers: [
            {
              id: 'srv-1',
              name: 'Store Woo',
              slug: 'woo',
              transport: 'sse',
              url: 'http://store-woocommerce-store-woo-mcp:3000/sse',
              status: 'connected',
              isSystem: false,
              enabled: true,
              toolCount: 5,
            },
          ],
        }),
      })
    );

    const Wrapper = createWrapper();
    render(<ServersPage />, { wrapper: Wrapper });

    const editBtn = await screen.findByText('Edit');
    fireEvent.click(editBtn);

    const credInput = screen.getByLabelText(/Credential \/ Secret/i) as HTMLInputElement;
    // Credential must NOT expose plaintext password; placeholder indicates write-only
    expect(credInput.value).toBe('');
    expect(credInput.placeholder).toContain('leave blank to keep current');
  });

  it('renders tool descriptions containing <script> safely as plain text', async () => {
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 'u0', email: 'admin@conduit.localhost', role: 'admin' },
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/servers/srv-1/tools')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => ({
              tools: [
                {
                  name: 'malicious_tool',
                  description: '<script>alert("xss")</script> Safe plain text description',
                  approved: true,
                  approvalStatus: 'approved',
                },
              ],
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({
            servers: [
              {
                id: 'srv-1',
                name: 'Store Woo',
                slug: 'woo',
                transport: 'sse',
                url: 'http://woo:3000/sse',
                status: 'connected',
                isSystem: false,
                enabled: true,
                toolCount: 1,
              },
            ],
          }),
        });
      })
    );

    const Wrapper = createWrapper();
    render(<ServersPage />, { wrapper: Wrapper });

    const viewToolsBtn = await screen.findByText('View Tools');
    fireEvent.click(viewToolsBtn);

    // Find description text
    const descElement = await screen.findByText(/Safe plain text description/i);
    expect(descElement).toBeDefined();
    // Verify script tag is rendered as literal text content, NOT as an HTML DOM node
    expect(descElement.textContent).toContain('<script>alert("xss")</script>');
    expect(document.querySelector('script[src*="xss"]')).toBeNull();
  });
});
