import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../api/client';
import { Button } from '../components/ui/Button';
import { FormInput } from '../components/ui/FormInput';
import { StatusBadge } from '../components/ui/StatusBadge';
import { PageHeader } from '../components/ui/PageHeader';
import { useToast } from '../components/ui/Toast';
import { EyeIcon, EyeOffIcon, AlertTriangleIcon, ShieldIcon } from '../components/ui/Icons';

export const AccountPage: React.FC = () => {
  const { user, refreshUser } = useAuth();
  const { success } = useToast();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handlePasswordChange = async (e: React.FormEvent) => {
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

      success('Your password was changed. All other sessions have been revoked.');

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      await refreshUser();
    } catch (err: any) {
      setError(err?.message || 'Failed to update password');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Account Settings"
        description="Manage your identity credentials and security preferences."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Card */}
        <div className="bg-card border border-border rounded-xl p-6 space-y-4 shadow-card">
          <div className="flex items-center gap-2 pb-3 border-b border-border">
            <ShieldIcon className="w-5 h-5 text-brand" />
            <h2 className="text-base font-semibold text-txt-primary">Profile Details</h2>
          </div>
          <div className="space-y-3.5 text-sm">
            <div>
              <span className="text-txt-muted block text-xs font-medium">Email Address</span>
              <span className="text-txt-primary font-medium">{user?.email}</span>
            </div>
            <div>
              <span className="text-txt-muted block text-xs font-medium mb-1">System Role</span>
              <StatusBadge status={user?.role || 'member'} />
            </div>
            <div>
              <span className="text-txt-muted block text-xs font-medium">User ID</span>
              <span className="text-txt-secondary font-mono text-xs break-all select-all">{user?.id}</span>
            </div>
          </div>
        </div>

        {/* Change Password Card */}
        <div className="lg:col-span-2 bg-card border border-border rounded-xl p-6 space-y-5 shadow-card">
          <div className="pb-3 border-b border-border">
            <h2 className="text-base font-semibold text-txt-primary">Security & Password</h2>
            <p className="text-xs text-txt-secondary mt-1">
              Updating your password revokes all active sessions on other devices.
            </p>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-lg bg-status-error-bg border border-status-error-border p-4 text-sm text-status-error-text flex items-start gap-3"
            >
              <AlertTriangleIcon className="w-5 h-5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handlePasswordChange} className="space-y-4 max-w-lg" noValidate>
            <FormInput
              id="account-current-password"
              label="Current Password"
              type={showCurrentPassword ? 'text' : 'password'}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="••••••••••••"
              autoComplete="current-password"
              required
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
              id="account-new-password"
              label="New Password"
              type={showNewPassword ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Minimum 12 characters"
              autoComplete="new-password"
              helperText="Must be >= 12 characters and not in the common passwords deny list"
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
              id="account-confirm-password"
              label="Confirm New Password"
              type={showNewPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              autoComplete="new-password"
              required
            />

            <div className="pt-2">
              <Button type="submit" variant="primary" loading={isSubmitting}>
                Change Password
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
