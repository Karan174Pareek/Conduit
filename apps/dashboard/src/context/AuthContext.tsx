import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiFetch, setCsrfToken } from '../api/client';

export interface User {
  id: string;
  email: string;
  name?: string;
  role: 'admin' | 'member';
  mustChangePassword?: boolean;
}

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const refreshUser = useCallback(async () => {
    try {
      const data = await apiFetch<{ user: User; csrfToken?: string }>('/api/auth/me');
      if (data.user) {
        setUser(data.user);
        if (data.csrfToken) {
          setCsrfToken(data.csrfToken);
        }
      }
    } catch {
      setUser(null);
      setCsrfToken(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = async (email: string, password: string): Promise<User> => {
    const data = await apiFetch<{ user: User; csrfToken: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });

    if (data.csrfToken) {
      setCsrfToken(data.csrfToken);
    }
    setUser(data.user);
    return data.user;
  };

  const logout = async (): Promise<void> => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } finally {
      setCsrfToken(null);
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
