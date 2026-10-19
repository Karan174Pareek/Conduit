import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './components/ui/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppLayout } from './components/layout/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { AccountPage } from './pages/AccountPage';
import { ServersPage } from './pages/ServersPage';
import { ApiKeysPage } from './pages/ApiKeysPage';
import { AuditPage } from './pages/AuditPage';
import { TeamPage } from './pages/TeamPage';
import { ConnectPage } from './pages/ConnectPage';
import { ChatPage } from './pages/ChatPage';
import { PoliciesPage } from './pages/PoliciesPage';
import { ForbiddenPage } from './pages/ForbiddenPage';
import { NotFoundPage } from './pages/NotFoundPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface-panel flex items-center justify-center text-text-muted text-sm">
        Authenticating session...
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Force password change screen when flagged
  if (user.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }

  return <>{children}</>;
};

const AdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface-panel flex items-center justify-center text-text-muted text-sm">
        Authenticating session...
      </div>
    );
  }

  if (!user || user.role !== 'admin') {
    return <ForbiddenPage />;
  }

  return <>{children}</>;
};

export const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ToastProvider>
            <BrowserRouter>
              <Routes>
                {/* Public Auth Routes */}
                <Route path="/login" element={<LoginPage />} />
                <Route path="/accept-invite" element={<AcceptInvitePage />} />

                {/* Mandatory Password Change Route */}
                <Route
                  path="/change-password"
                  element={
                    <ProtectedRoute>
                      <ChangePasswordPage />
                    </ProtectedRoute>
                  }
                />

                {/* Authenticated Application Shell */}
                <Route
                  path="/"
                  element={
                    <ProtectedRoute>
                      <AppLayout />
                    </ProtectedRoute>
                  }
                >
                  <Route index element={<Navigate to="/servers" replace />} />
                  <Route path="servers" element={<ServersPage />} />
                  <Route path="keys" element={<ApiKeysPage />} />
                  <Route path="audit" element={<AuditPage />} />
                  <Route
                    path="team"
                    element={
                      <AdminRoute>
                        <TeamPage />
                      </AdminRoute>
                    }
                  />
                  <Route
                    path="policies"
                    element={
                      <AdminRoute>
                        <PoliciesPage />
                      </AdminRoute>
                    }
                  />
                  <Route path="connect" element={<ConnectPage />} />
                  <Route path="chat" element={<ChatPage />} />
                  <Route path="account" element={<AccountPage />} />
                  <Route path="403" element={<ForbiddenPage />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Route>
              </Routes>
            </BrowserRouter>
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
};
