import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../api/client';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Badge } from '../components/ui/Badge';
import { useToast } from '../components/ui/Toast';

export const AccountPage: React.FC = () => {
  const { user, refreshUser } = useAuth();
  const { success } = useToast();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
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
      setError(err.message || 'Failed to update password');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Account Settings</h1>
        <p className="text-sm text-slate-400 mt-1">Manage your identity credentials and security preferences.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Profile Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-lg p-6 space-y-4">
          <h2 className="text-lg font-semibold text-white">Profile Details</h2>
          <div className="space-y-3 text-sm">
            <div>
              <span className="text-slate-400 block text-xs">Email Address</span>
              <span className="text-slate-200 font-medium">{user?.email}</span>
            </div>
            <div>
              <span className="text-slate-400 block text-xs">System Role</span>
              <div className="mt-1">
                <Badge variant={user?.role === 'admin' ? 'info' : 'default'} size="sm">
                  {user?.role}
                </Badge>
              </div>
            </div>
            <div>
              <span className="text-slate-400 block text-xs">User ID</span>
              <span className="text-slate-400 font-mono text-xs break-all">{user?.id}</span>
            </div>
          </div>
        </div>

        {/* Change Password Card */}
        <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-lg p-6 space-y-6">
          <div>
            <h2 className="text-lg font-semibold text-white">Security & Password</h2>
            <p className="text-xs text-slate-400 mt-1">
              Updating your password revokes all active sessions on other devices.
            </p>
          </div>

          {error && (
            <div className="rounded-md bg-rose-500/10 border border-rose-500/20 p-4 text-sm text-rose-400">
              {error}
            </div>
          )}

          <form onSubmit={handlePasswordChange} className="space-y-4 max-w-md">
            <Input
              label="Current Password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="••••••••••••"
              required
            />

            <Input
              label="New Password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Min 12 characters"
              helperText="Must be >= 12 characters and not in the deny list"
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

            <div className="pt-2">
              <Button type="submit" variant="primary" disabled={isSubmitting}>
                {isSubmitting ? 'Updating...' : 'Change Password'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
