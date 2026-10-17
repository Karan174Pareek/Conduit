import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../api/client';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { useToast } from '../components/ui/Toast';

export const ChangePasswordPage: React.FC = () => {
  const { user, refreshUser, logout } = useAuth();
  const navigate = useNavigate();
  const { success } = useToast();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!currentPassword) {
      setError('Current password is required');
      return;
    }

    if (newPassword.length < 12) {
      setError('New password must be at least 12 characters long');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('New passwords do not match');
      return;
    }

    setIsSubmitting(true);
    try {
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      success('Your password has been changed successfully. Other sessions have been revoked.');

      await refreshUser();
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Failed to change password');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <div className="w-12 h-12 rounded-lg bg-cyan-600 flex items-center justify-center font-bold text-white text-xl shadow-lg">
            C
          </div>
        </div>
        <h2 className="mt-4 text-center text-2xl font-bold tracking-tight text-white">
          {user?.mustChangePassword ? 'Password Change Required' : 'Change Password'}
        </h2>
        <p className="mt-2 text-center text-sm text-slate-400">
          {user?.mustChangePassword
            ? 'Your account requires an immediate password update before proceeding.'
            : 'Update your account password. Must be at least 12 characters.'}
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-slate-900 py-8 px-4 shadow-xl border border-slate-800 sm:rounded-lg sm:px-10">
          {error && (
            <div className="mb-6 rounded-md bg-rose-500/10 border border-rose-500/20 p-4 text-sm text-rose-400">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <Input
              label="Current Password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="••••••••••••"
              required
              autoFocus
            />

            <Input
              label="New Password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Minimum 12 characters"
              helperText="Must be >= 12 chars and not in the common passwords deny list"
              required
            />

            <Input
              label="Confirm New Password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              required
            />

            <div className="pt-2 flex flex-col space-y-3">
              <Button type="submit" variant="primary" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? 'Updating Password...' : 'Update Password'}
              </Button>

              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={async () => {
                  await logout();
                  navigate('/login');
                }}
              >
                Log Out
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
