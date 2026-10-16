import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';

export const LoginPage: React.FC = () => {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // If already logged in, redirect
  React.useEffect(() => {
    if (user) {
      const from = (location.state as any)?.from?.pathname || '/servers';
      navigate(from, { replace: true });
    }
  }, [user, navigate, location]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      await login(email, password);
      const from = (location.state as any)?.from?.pathname || '/servers';
      navigate(from, { replace: true });
    } catch (err: any) {
      setError(err?.message || 'Login failed. Please verify your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 text-slate-100">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="w-12 h-12 rounded-xl bg-cyan-600 mx-auto flex items-center justify-center font-bold text-2xl text-white shadow-lg mb-4">
          C
        </div>
        <h2 className="text-3xl font-extrabold tracking-tight text-white">Sign in to Conduit</h2>
        <p className="mt-2 text-sm text-slate-400">Enterprise MCP Gateway Management</p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-slate-900 py-8 px-4 shadow-xl border border-slate-800 sm:rounded-lg sm:px-10">
          {error && (
            <div className="mb-6 p-4 rounded-md bg-rose-950/50 border border-rose-800 text-rose-200 text-sm flex items-start space-x-2">
              <span>{error}</span>
            </div>
          )}

          <form className="space-y-6" onSubmit={handleSubmit}>
            <Input
              id="login-email"
              label="Email address"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />

            <Input
              id="login-password"
              label="Password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            <div>
              <Button type="submit" fullWidth isLoading={loading}>
                Sign In
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
