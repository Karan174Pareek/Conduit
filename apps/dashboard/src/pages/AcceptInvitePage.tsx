import React, { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { Button } from '../components/ui/Button';
import { FormInput } from '../components/ui/FormInput';
import { EyeIcon, EyeOffIcon, AlertTriangleIcon, CheckCircleIcon } from '../components/ui/Icons';

export const AcceptInvitePage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!token) {
      setError('Missing invitation token in URL.');
      return;
    }

    if (password.length < 12) {
      setError('Password must be at least 12 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);

    try {
      await apiClient.post('/api/auth/accept-invite', {
        token,
        name: displayName.trim() || 'Team Member',
        password,
      });
      setSuccess(true);
      setTimeout(() => {
        navigate('/login');
      }, 2000);
    } catch (err: any) {
      setError(err?.message || 'Failed to accept invitation. Token may be invalid or expired.');
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
          Join Conduit Team
        </h1>
        <p className="mt-2 text-sm text-txt-secondary">
          Set up your team member account to access the gateway
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

          {success ? (
            <div
              role="status"
              className="p-5 rounded-lg bg-status-success-bg border border-status-success-border text-status-success-text text-sm text-center space-y-3"
            >
              <div className="flex items-center justify-center">
                <CheckCircleIcon className="w-8 h-8 text-brand" />
              </div>
              <p className="font-semibold text-base">Invitation accepted successfully!</p>
              <p className="text-xs text-txt-secondary">Redirecting to login...</p>
              <Link to="/login" className="inline-block text-brand hover:underline text-xs font-medium">
                Click here if not redirected automatically
              </Link>
            </div>
          ) : (
            <form className="space-y-5" onSubmit={handleSubmit} noValidate>
              <FormInput
                id="invite-name"
                label="Display Name"
                type="text"
                autoComplete="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Jane Doe"
              />

              <FormInput
                id="invite-password"
                label="New Password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                helperText="Minimum 12 characters. Checked against common password denylists."
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

              <FormInput
                id="invite-confirm-password"
                label="Confirm Password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />

              <div className="pt-2">
                <Button type="submit" variant="primary" fullWidth loading={loading} disabled={!token}>
                  Complete Setup & Join
                </Button>
              </div>
            </form>
          )}
        </div>
      </div>
    </main>
  );
};
