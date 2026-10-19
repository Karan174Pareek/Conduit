import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { useToast } from '../components/ui/Toast';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { PageHeader } from '../components/ui/PageHeader';
import { DataTable, Column } from '../components/ui/DataTable';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { FormInput, FormSelect } from '../components/ui/FormInput';
import { EmptyState } from '../components/ui/EmptyState';
import { CodeBlock } from '../components/ui/CodeBlock';
import {
  UsersIcon,
  UserPlusIcon,
  MailIcon,
  TrashIcon,
} from '../components/ui/Icons';

interface UserItem {
  id: string;
  email: string;
  role: 'admin' | 'member';
  disabled: boolean;
  displayName?: string;
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

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('member');
  const [createdInviteUrl, setCreatedInviteUrl] = useState<string | null>(null);
  const [revokeInviteTarget, setRevokeInviteTarget] = useState<InviteItem | null>(null);

  // 1. Fetch Users
  const { data: usersData, isLoading: loadingUsers } = useQuery<UserItem[]>({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await apiClient.get<{ users: UserItem[] }>('/api/users');
      return res.users || [];
    },
  });

  // 2. Fetch Invites
  const { data: invitesData, isLoading: loadingInvites } = useQuery<InviteItem[]>({
    queryKey: ['invites'],
    queryFn: async () => {
      const res = await apiClient.get<{ invites: InviteItem[] }>('/api/invites');
      return res.invites || [];
    },
  });

  // Mutations
  const updateRoleMutation = useMutation({
    mutationFn: async ({ id, role }: { id: string; role: 'admin' | 'member' }) => {
      return apiClient.put(`/api/users/${id}/role`, { role });
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
      return apiClient.post(`/api/users/${id}/${disable ? 'disable' : 'enable'}`);
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
      return apiClient.post<{ inviteUrl: string }>('/api/invites', {
        email: inviteEmail,
        role: inviteRole,
      });
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['invites'] });
      const token = data.token || data.invite?.token || '';
      const url = data.inviteUrl || `${window.location.origin}/accept-invite?token=${token}`;
      setCreatedInviteUrl(url);
      addToast('Invitation link generated', 'success');
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
      addToast('Invite revoked successfully', 'success');
      setRevokeInviteTarget(null);
    },
    onError: (err: any) => {
      addToast(err?.message || 'Failed to revoke invite', 'error');
    },
  });

  const userColumns: Column<UserItem>[] = [
    {
      key: 'email',
      header: 'Team Member',
      render: (u: UserItem) => (
        <div>
          <div className="font-semibold text-text-primary">{u.email}</div>
          {u.displayName && <div className="text-xs text-text-muted mt-0.5">{u.displayName}</div>}
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Access Role',
      render: (u: UserItem) => (
        <select
          aria-label={`Access role for ${u.email}`}
          className="bg-surface-panel border border-border-default rounded-md px-2.5 py-1 text-xs text-text-primary font-medium focus:outline-none focus:ring-2 focus:ring-brand min-h-[36px]"
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
        <StatusBadge
          status={u.disabled ? 'disabled' : 'connected'}
          label={u.disabled ? 'Disabled' : 'Active'}
        />
      ),
    },
    {
      key: 'createdAt',
      header: 'Member Since',
      render: (u: UserItem) => (
        <span className="text-xs text-text-muted">
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
          variant={u.disabled ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => toggleUserMutation.mutate({ id: u.id, disable: !u.disabled })}
          isLoading={toggleUserMutation.isPending}
        >
          {u.disabled ? 'Enable Account' : 'Disable Account'}
        </Button>
      ),
    },
  ];

  const inviteColumns: Column<InviteItem>[] = [
    {
      key: 'email',
      header: 'Invited Recipient',
      render: (inv: InviteItem) => (
        <span className="font-mono text-xs font-semibold text-text-primary">{inv.email}</span>
      ),
    },
    {
      key: 'role',
      header: 'Assigned Role',
      render: (inv: InviteItem) => (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium uppercase tracking-wider ${
            inv.role === 'admin'
              ? 'bg-brand/10 text-brand border border-brand/20'
              : 'bg-surface-subtle text-text-secondary border border-border-default'
          }`}
        >
          {inv.role}
        </span>
      ),
    },
    {
      key: 'expiresAt',
      header: 'Link Expiry',
      render: (inv: InviteItem) => (
        <span className="text-xs text-text-muted">
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
          onClick={() => setRevokeInviteTarget(inv)}
          isLoading={revokeInviteMutation.isPending}
          leftIcon={<TrashIcon className="w-3.5 h-3.5" />}
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
        <PageHeader
          title="Team Management"
          description="Manage member access, role assignments, and organizational privileges."
          breadcrumbs={[{ label: 'Dashboard' }, { label: 'Team' }]}
          actions={
            <Button
              onClick={() => {
                setInviteEmail('');
                setInviteRole('member');
                setCreatedInviteUrl(null);
                setShowInviteModal(true);
              }}
              leftIcon={<UserPlusIcon className="w-4 h-4" />}
            >
              Invite Member
            </Button>
          }
        />

        <DataTable<UserItem>
          columns={userColumns}
          data={usersData || []}
          keyExtractor={(item) => item.id}
          isLoading={loadingUsers}
          emptyState={
            <EmptyState
              icon={<UsersIcon className="w-10 h-10 text-text-muted" />}
              title="No Team Members Found"
              description="Invite team members to provide them access to Conduit."
            />
          }
        />
      </div>

      {/* Pending Invites Section */}
      <div className="space-y-4 pt-6 border-t border-border-default">
        <div>
          <h2 className="text-lg font-bold text-text-primary tracking-tight">Pending Invitations</h2>
          <p className="text-xs text-text-secondary mt-0.5">
            Outstanding single-use invitation tokens awaiting acceptance.
          </p>
        </div>

        <DataTable<InviteItem>
          columns={inviteColumns}
          data={invitesData || []}
          keyExtractor={(item) => item.id}
          isLoading={loadingInvites}
          emptyState={
            <EmptyState
              icon={<MailIcon className="w-8 h-8 text-text-muted" />}
              title="No Pending Invitations"
              description="All issued team invitations have either been accepted or revoked."
            />
          }
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
              variant="primary"
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
            <div className="p-3 bg-surface-success border border-border-success rounded-lg text-text-success text-xs">
              Single-use invitation link generated. Transmit this secure link to the recipient.
            </div>

            <div className="space-y-1.5">
              <span className="block text-xs font-semibold text-text-secondary uppercase tracking-wider">
                Invitation URL
              </span>
              <CodeBlock code={createdInviteUrl} language="text" />
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
            <FormInput
              id="inv-email"
              label="Recipient Email Address"
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="colleague@example.com"
              helperText="An onboarding invitation link will be created for this email."
            />

            <FormSelect
              id="inv-role"
              label="Role Assignment"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as any)}
              options={[
                { value: 'member', label: 'Member (Tool execution & Chat only)' },
                { value: 'admin', label: 'Admin (Full cluster & policy control)' },
              ]}
              helperText="Members cannot modify servers, audit logs, or system policies."
            />

            <div className="flex justify-end gap-3 pt-4 border-t border-border-default">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowInviteModal(false)}
              >
                Cancel
              </Button>
              <Button type="submit" isLoading={createInviteMutation.isPending}>
                Create Invitation Link
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Revoke Invite Confirmation Dialog */}
      {revokeInviteTarget && (
        <ConfirmDialog
          isOpen={!!revokeInviteTarget}
          onClose={() => setRevokeInviteTarget(null)}
          onConfirm={() => revokeInviteMutation.mutate(revokeInviteTarget.id)}
          title="Revoke Invitation"
          message={`Are you sure you want to revoke the pending invitation for ${revokeInviteTarget.email}? The invitation link will immediately become invalid.`}
          confirmText="Revoke Invitation"
          variant="danger"
          isLoading={revokeInviteMutation.isPending}
        />
      )}
    </div>
  );
};
