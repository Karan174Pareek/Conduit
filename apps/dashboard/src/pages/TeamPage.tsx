import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { useToast } from '../components/ui/Toast';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Table, Column } from '../components/ui/Table';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';

interface UserItem {
  id: string;
  email: string;
  displayName?: string;
  role: 'admin' | 'member';
  disabled: boolean;
  createdAt: string;
}

interface InviteItem {
  id: string;
  email: string;
  role: 'admin' | 'member';
  expiresAt: string;
  createdAt: string;
}

export const TeamPage: React.FC = () => {
  const { addToast } = useToast();
  const queryClient = useQueryClient();

  // Invite modal
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [createdInviteUrl, setCreatedInviteUrl] = useState<string | null>(null);

  // 1. Fetch Users
  const { data: usersData, isLoading: loadingUsers } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await apiClient.get<{ users: UserItem[] }>('/api/users');
      return res.users;
    },
  });

  // 2. Fetch Invites
  const { data: invitesData, isLoading: loadingInvites } = useQuery({
    queryKey: ['invites'],
    queryFn: async () => {
      const res = await apiClient.get<{ invites: InviteItem[] }>('/api/invites');
      return res.invites;
    },
  });

  // Mutations
  const updateRoleMutation = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: 'admin' | 'member' }) => {
      return apiClient.patch(`/api/users/${id}`, { role });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      addToast('User role updated successfully', 'success');
    },
    onError: (err: any) => {
      addToast(err?.message || 'Failed to update user role', 'error');
    },
  });

  const toggleUserMutation = useMutation({
    mutationFn: async ({ id, disable }: { id: string; disable: boolean }) => {
      return apiClient.patch(`/api/users/${id}`, { status: disable ? 'disabled' : 'active' });
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      addToast(`User ${vars.disable ? 'disabled' : 'enabled'} successfully`, 'success');
    },
    onError: (err: any) => {
      addToast(err?.message || 'Failed to update user status', 'error');
    },
  });

  const createInviteMutation = useMutation({
    mutationFn: async () => {
      return apiClient.post<{ invite: { id: string; email: string; token: string; inviteUrl?: string } }>('/api/invites', {
        email: inviteEmail.trim(),
        role: inviteRole,
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['invites'] });
      const inv = (data as any).invite || data; const fullUrl = inv.inviteUrl || `${window.location.origin}/accept-invite?token=${inv.token}`;
      setCreatedInviteUrl(fullUrl);
      addToast('Invitation created successfully', 'success');
    },
    onError: (err: any) => {
      addToast(err?.message || 'Failed to create invite', 'error');
    },
  });

  const revokeInviteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiClient.delete(`/api/invites/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invites'] });
      addToast('Invite revoked', 'success');
    },
    onError: (err: any) => {
      addToast(err?.message || 'Failed to revoke invite', 'error');
    },
  });

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    addToast('Copied to clipboard!', 'info');
  };

  const userColumns: Column<UserItem>[] = [
    {
      key: 'email',
      header: 'User',
      render: (u: UserItem) => (
        <div>
          <div className="font-medium text-white">{u.email}</div>
          {u.displayName && <div className="text-xs text-slate-400">{u.displayName}</div>}
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      render: (u: UserItem) => (
        <select
          className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-cyan-500"
          value={u.role}
          onChange={(e) => updateRoleMutation.mutate({ id: u.id, role: e.target.value as any })}
          disabled={updateRoleMutation.isPending}
        >
          <option value="admin">Admin</option>
          <option value="member">Member</option>
        </select>
      ),
    },
    {
      key: 'disabled',
      header: 'Status',
      render: (u: UserItem) => (
        <Badge variant={u.disabled ? 'danger' : 'success'}>
          {u.disabled ? 'Disabled' : 'Active'}
        </Badge>
      ),
    },
    {
      key: 'createdAt',
      header: 'Joined',
      render: (u: UserItem) => (
        <span className="text-xs text-slate-400">
          {new Date(u.createdAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (u: UserItem) => (
        <Button
          variant={u.disabled ? 'outline' : 'secondary'}
          size="sm"
          onClick={() => toggleUserMutation.mutate({ id: u.id, disable: !u.disabled })}
          isLoading={toggleUserMutation.isPending}
        >
          {u.disabled ? 'Enable' : 'Disable'}
        </Button>
      ),
    },
  ];

  const inviteColumns: Column<InviteItem>[] = [
    {
      key: 'email',
      header: 'Invited Email',
      render: (inv: InviteItem) => <span className="font-mono text-xs text-white">{inv.email}</span>,
    },
    {
      key: 'role',
      header: 'Role',
      render: (inv: InviteItem) => (
        <Badge variant={inv.role === 'admin' ? 'info' : 'neutral'} size="sm">
          {inv.role}
        </Badge>
      ),
    },
    {
      key: 'expiresAt',
      header: 'Expires',
      render: (inv: InviteItem) => (
        <span className="text-xs text-slate-400">
          {new Date(inv.expiresAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (inv: InviteItem) => (
        <Button
          variant="danger"
          size="sm"
          onClick={() => revokeInviteMutation.mutate(inv.id)}
          isLoading={revokeInviteMutation.isPending}
        >
          Revoke
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-10">
      {/* Users Section */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Team Management</h1>
            <p className="text-sm text-slate-400 mt-1">
              Manage member access, roles, and administrative privileges.
            </p>
          </div>
          <Button
            onClick={() => {
              setInviteEmail('');
              setInviteRole('member');
              setCreatedInviteUrl(null);
              setShowInviteModal(true);
            }}
          >
            Invite Member
          </Button>
        </div>

        <Table<UserItem>
          columns={userColumns}
          data={usersData || []}
          keyExtractor={(item: UserItem) => item.id}
          isLoading={loadingUsers}
          emptyMessage="No users found."
        />
      </div>

      {/* Pending Invites Section */}
      <div className="space-y-4 pt-6 border-t border-slate-800">
        <div>
          <h2 className="text-lg font-semibold text-white tracking-tight">Pending Invitations</h2>
          <p className="text-sm text-slate-400">
            Outstanding invites that have not yet been accepted.
          </p>
        </div>

        <Table<InviteItem>
          columns={inviteColumns}
          data={invitesData || []}
          keyExtractor={(item: InviteItem) => item.id}
          isLoading={loadingInvites}
          emptyMessage="No pending invitations."
        />
      </div>

      {/* Invite Modal */}
      <Modal
        isOpen={showInviteModal}
        onClose={() => {
          setShowInviteModal(false);
          setCreatedInviteUrl(null);
        }}
        title="Invite New Team Member"
        footer={
          createdInviteUrl ? (
            <Button
              variant="secondary"
              onClick={() => {
                setShowInviteModal(false);
                setCreatedInviteUrl(null);
              }}
            >
              Done
            </Button>
          ) : undefined
        }
      >
        {createdInviteUrl ? (
          <div className="space-y-4">
            <div className="p-3 bg-emerald-950/40 border border-emerald-800 rounded-lg text-emerald-200 text-xs">
              Invitation link generated. Send this link to the user; it will only be displayed once.
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
                Invitation URL
              </label>
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  readOnly
                  value={createdInviteUrl}
                  className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-cyan-300 select-all"
                />
                <Button size="sm" onClick={() => copyToClipboard(createdInviteUrl)}>
                  Copy
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createInviteMutation.mutate();
            }}
            className="space-y-4"
          >
            <Input
              id="inv-email"
              label="Email address"
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="colleague@example.com"
            />

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Role</label>
              <select
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as any)}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            <div className="flex justify-end space-x-3 pt-4 border-t border-slate-800">
              <Button type="button" variant="secondary" onClick={() => setShowInviteModal(false)}>
                Cancel
              </Button>
              <Button type="submit" isLoading={createInviteMutation.isPending}>
                Create Invitation Link
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};
