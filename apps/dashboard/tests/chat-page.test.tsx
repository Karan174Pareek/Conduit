// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppLayout } from '../src/components/layout/AppLayout';
import { ChatPage } from '../src/pages/ChatPage';
import * as AuthContextModule from '../src/context/AuthContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../src/components/ui/Toast';

describe('Chat Page & Navigation Component Tests', () => {
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

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(AuthContextModule, 'useAuth').mockReturnValue({
      user: { id: 'u1', email: 'admin@conduit.localhost', role: 'admin' },
      isLoading: false,
      login: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });
  });

  it('renders enabled Chat link in AppLayout navbar', () => {
    render(
      <MemoryRouter>
        <AppLayout />
      </MemoryRouter>
    );

    const chatLink = screen.getByRole('link', { name: /^Chat$/i });
    expect(chatLink).toBeDefined();
    expect(chatLink.getAttribute('href')).toBe('/chat');
    expect(chatLink.hasAttribute('disabled')).toBe(false);
  });

  it('renders ChatPage hero state with starter prompts and active input composer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/conversations')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            headers: new Headers(),
            json: async () => [
              {
                id: 'conv-1',
                title: 'WooCommerce Order Inspection',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers(),
          json: async () => ({}),
        });
      })
    );

    const Wrapper = createWrapper();
    render(<ChatPage />, { wrapper: Wrapper });

    // Verify conversation from sidebar
    expect(await screen.findByText('WooCommerce Order Inspection')).toBeDefined();

    // Verify hero empty state elements
    expect(screen.getByText('Conduit AI Assistant')).toBeDefined();
    expect(screen.getByText(/"List all WooCommerce products with prices"/i)).toBeDefined();

    // Verify composer input
    const textarea = screen.getByPlaceholderText(/Ask Conduit Assistant/i);
    expect(textarea).toBeDefined();

    // Verify Send button is initially disabled for empty text
    const sendBtn = screen.getByRole('button', { name: /Send/i });
    expect(sendBtn.hasAttribute('disabled')).toBe(true);

    // Typing enables send button
    fireEvent.change(textarea, { target: { value: 'Show orders' } });
    expect(sendBtn.hasAttribute('disabled')).toBe(false);
  });
});
