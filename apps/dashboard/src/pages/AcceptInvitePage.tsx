import React, { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { apiClient } from '../api/client';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';

export const AcceptInvitePage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';
  const navigate = useNavigate();

  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
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

    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
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
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8 text-slate-100">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="w-12 h-12 rounded-xl bg-cyan-600 mx-auto flex items-center justify-center font-bold text-2xl text-white shadow-lg mb-4">
          C
        </div>
        <h2 className="text-3xl font-extrabold tracking-tight text-white">Join Conduit Team</h2>
        <p className="mt-2 text-sm text-slate-400">Set up your account to access the gateway</p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-slate-900 py-8 px-4 shadow-xl border border-slate-800 sm:rounded-lg sm:px-10">
          {error && (
            <div className="mb-6 p-4 rounded-md bg-rose-950/50 border border-rose-800 text-rose-200 text-sm">
              {error}
            </div>
          )}

          {success ? (
            <div className="p-4 rounded-md bg-emerald-950/50 border border-emerald-800 text-emerald-200 text-sm text-center space-y-3">
              <p className="font-semibold">Invitation accepted successfully!</p>
              <p className="text-xs text-emerald-300">Redirecting to login...</p>
              <Link to="/login" className="inline-block text-cyan-400 hover:underline text-xs">
                Click here if not redirected automatically
              </Link>
            </div>
          ) : (
            <form className="space-y-5" onSubmit={handleSubmit}>
              <Input
                id="invite-name"
                label="Display Name"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Jane Doe"
              />

              <Input
                id="invite-password"
                label="Password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                helperText="Minimum 8 characters"
              />

              <Input
                id="invite-confirm-password"
                label="Confirm Password"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />

              <Button type="submit" fullWidth isLoading={loading} disabled={!token}>
                Complete Setup & Join
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
