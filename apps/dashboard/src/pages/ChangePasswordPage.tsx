import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../api/client';
import { Button } from '../components/ui/Button';
import { FormInput } from '../components/ui/FormInput';
import { useToast } from '../components/ui/Toast';
import { EyeIcon, EyeOffIcon, AlertTriangleIcon } from '../components/ui/Icons';

export const ChangePasswordPage: React.FC = () => {
  const { user, refreshUser, logout } = useAuth();
  const navigate = useNavigate();
  const { success } = useToast();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
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
      setError(err?.message || 'Failed to change password');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-canvas flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8 text-txt-primary">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <div className="w-12 h-12 rounded-xl bg-brand mx-auto flex items-center justify-center font-bold text-2xl text-brand-text shadow-card mb-4">
          C
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-txt-primary">
          {user?.mustChangePassword ? 'Password Change Required' : 'Change Password'}
        </h1>
        <p className="mt-2 text-sm text-txt-secondary">
          {user?.mustChangePassword
            ? 'Your account requires an immediate password update before accessing the platform.'
            : 'Update your account password. Must be at least 12 characters.'}
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

          <form onSubmit={handleSubmit} className="space-y-5" noValidate>
            <FormInput
              id="change-current-password"
              label="Current Password"
              type={showCurrentPassword ? 'text' : 'password'}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="••••••••••••"
              autoComplete="current-password"
              required
              autoFocus
              rightAction={
                <button
                  type="button"
                  onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                  className="text-xs text-txt-secondary hover:text-txt-primary flex items-center gap-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand rounded p-0.5"
                  aria-label={showCurrentPassword ? 'Hide current password' : 'Show current password'}
                >
                  {showCurrentPassword ? <EyeOffIcon className="w-3.5 h-3.5" /> : <EyeIcon className="w-3.5 h-3.5" />}
                  <span>{showCurrentPassword ? 'Hide' : 'Show'}</span>
                </button>
              }
            />

            <FormInput
              id="change-new-password"
              label="New Password"
              type={showNewPassword ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Minimum 12 characters"
              autoComplete="new-password"
              helperText="Must be >= 12 chars and not in the common passwords deny list"
              required
              rightAction={
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="text-xs text-txt-secondary hover:text-txt-primary flex items-center gap-1 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand rounded p-0.5"
                  aria-label={showNewPassword ? 'Hide new password' : 'Show new password'}
                >
                  {showNewPassword ? <EyeOffIcon className="w-3.5 h-3.5" /> : <EyeIcon className="w-3.5 h-3.5" />}
                  <span>{showNewPassword ? 'Hide' : 'Show'}</span>
                </button>
              }
            />

            <FormInput
              id="change-confirm-password"
              label="Confirm New Password"
              type={showNewPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              autoComplete="new-password"
              required
            />

            <div className="pt-2 flex flex-col space-y-3">
              <Button type="submit" variant="primary" fullWidth loading={isSubmitting}>
                Update Password
              </Button>

              <Button
                type="button"
                variant="secondary"
                fullWidth
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
    </main>
  );
};
