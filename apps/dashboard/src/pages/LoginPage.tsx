import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/Button';
import { FormInput } from '../components/ui/FormInput';
import { EyeIcon, EyeOffIcon, AlertTriangleIcon } from '../components/ui/Icons';

export const LoginPage: React.FC = () => {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
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
    } catch {
      // Security: Do not leak whether an email exists or not
      setError('Invalid email or password. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-canvas flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 text-txt-primary">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="w-12 h-12 rounded-xl bg-brand mx-auto flex items-center justify-center font-bold text-2xl text-brand-text shadow-card mb-4">
          C
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-txt-primary">
          Sign in to Conduit
        </h1>
        <p className="mt-2 text-sm text-txt-secondary">
          Team MCP Gateway & Tool Access Control Plane
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-card py-8 px-5 sm:px-10 shadow-card border border-border rounded-xl">
          {error && (
            <div
              role="alert"
              className="mb-6 p-4 rounded-lg bg-status-error-bg border border-status-error-border text-status-error-text text-sm flex items-start gap-3"
            >
              <AlertTriangleIcon className="w-5 h-5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form className="space-y-5" onSubmit={handleSubmit} noValidate>
            <FormInput
              id="login-email"
              label="Email address"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@conduit.localhost"
            />

            <FormInput
              id="login-password"
              label="Password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              rightAction={
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="text-xs text-txt-secondary hover:text-txt-primary flex items-center gap-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand rounded p-0.5"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOffIcon className="w-3.5 h-3.5" /> : <EyeIcon className="w-3.5 h-3.5" />}
                  <span>{showPassword ? 'Hide' : 'Show'}</span>
                </button>
              }
            />

            <div className="pt-2">
              <Button type="submit" variant="primary" fullWidth loading={loading}>
                Sign In
              </Button>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
};
