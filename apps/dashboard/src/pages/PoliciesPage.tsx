import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/Toast';
import { Button } from '../components/ui/Button';
import { PageHeader } from '../components/ui/PageHeader';
import { DataTable, Column } from '../components/ui/DataTable';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { FormInput, FormSelect } from '../components/ui/FormInput';
import { EmptyState } from '../components/ui/EmptyState';
import {
  ShieldIcon,
  PlusIcon,
  TrashIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  XCircleIcon,
} from '../components/ui/Icons';

interface PolicyItem {
  id: string;
  scope: 'role' | 'user';
  role?: 'admin' | 'member';
  subjectId?: string;
  serverId: string;
  toolPattern: string;
  effect: 'allow' | 'deny';
  readOnlyOnly?: boolean;
  createdAt: string;
  updatedAt: string;
}

interface PolicyResponse {
  policies: PolicyItem[];
  settings: {
    membersReadOnly: boolean;
  };
}

export const PoliciesPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { addToast } = useToast();
  const queryClient = useQueryClient();

  const [showAddModal, setShowAddModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PolicyItem | null>(null);

  // Form State
  const [formScope, setFormScope] = useState<'role' | 'user'>('role');
  const [formRole, setFormRole] = useState<'admin' | 'member'>('member');
  const [formSubjectId, setFormSubjectId] = useState('');
  const [formServerId, setFormServerId] = useState('*');
  const [formToolPattern, setFormToolPattern] = useState('*');
  const [formEffect, setFormEffect] = useState<'allow' | 'deny'>('allow');
  const [formReadOnlyOnly, setFormReadOnlyOnly] = useState(false);

  // 1. Fetch policies & settings
  const { data, isLoading } = useQuery<PolicyResponse>({
    queryKey: ['policies'],
    queryFn: async () => {
      return apiClient.get<PolicyResponse>('/api/policies');
    },
  });

  // 2. Fetch server list for dropdown
  const { data: serversData } = useQuery<{ servers: any[] }>({
    queryKey: ['servers-lookup'],
    queryFn: async () => {
      return apiClient.get<{ servers: any[] }>('/api/servers');
    },
  });

  // 3. Update global "members read-only" setting
  const updateSettingsMutation = useMutation({
    mutationFn: async (membersReadOnly: boolean) => {
      return apiClient.put('/api/policies/settings', { membersReadOnly });
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      addToast(
        `Members read-only enforcement ${vars ? 'enabled' : 'disabled'}`,
        'success'
      );
    },
    onError: (err: any) => {
      addToast(err?.message || 'Failed to update policy settings', 'error');
    },
  });

  // 4. Create Policy Mutation
  const createPolicyMutation = useMutation({
    mutationFn: async () => {
      return apiClient.post('/api/policies', {
        scope: formScope,
        role: formScope === 'role' ? formRole : undefined,
        subjectId: formScope === 'user' ? formSubjectId : undefined,
        serverId: formServerId,
        toolPattern: formToolPattern,
        effect: formEffect,
        readOnlyOnly: formReadOnlyOnly,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      addToast('Policy rule created successfully', 'success');
      setShowAddModal(false);
      resetForm();
    },
    onError: (err: any) => {
      addToast(err?.message || 'Failed to create policy', 'error');
    },
  });

  // 5. Delete Policy Mutation
  const deletePolicyMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiClient.delete(`/api/policies/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policies'] });
      addToast('Policy rule deleted', 'success');
      setDeleteTarget(null);
    },
    onError: (err: any) => {
      addToast(err?.message || 'Failed to delete policy', 'error');
    },
  });

  const resetForm = () => {
    setFormScope('role');
    setFormRole('member');
    setFormSubjectId('');
    setFormServerId('*');
    setFormToolPattern('*');
    setFormEffect('allow');
    setFormReadOnlyOnly(false);
  };

  const columns: Column<PolicyItem>[] = [
    {
      key: 'scope',
      header: 'Scope / Target',
      render: (p: PolicyItem) => (
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-text-primary capitalize">
              {p.scope === 'role' ? `Role: ${p.role}` : 'Specific User'}
            </span>
          </div>
          {p.subjectId && (
            <div className="text-xs font-mono text-text-muted mt-0.5">{p.subjectId}</div>
          )}
        </div>
      ),
    },
    {
      key: 'serverId',
      header: 'Target Server',
      render: (p: PolicyItem) => (
        <span className="font-mono text-xs text-text-secondary">
          {p.serverId === '*' ? 'All Upstream Servers (*)' : p.serverId}
        </span>
      ),
    },
    {
      key: 'toolPattern',
      header: 'Tool Pattern',
      render: (p: PolicyItem) => (
        <span className="font-mono text-xs font-semibold text-brand">
          {p.toolPattern}
        </span>
      ),
    },
    {
      key: 'effect',
      header: 'Rule Effect',
      render: (p: PolicyItem) => (
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-xs font-bold uppercase tracking-wider ${
            p.effect === 'allow'
              ? 'bg-surface-success text-text-success border border-border-success'
              : 'bg-surface-danger text-text-danger border border-border-danger'
          }`}
        >
          {p.effect === 'allow' ? (
            <CheckCircleIcon className="w-3.5 h-3.5" />
          ) : (
            <XCircleIcon className="w-3.5 h-3.5" />
          )}
          {p.effect}
        </span>
      ),
    },
    {
      key: 'readOnlyOnly',
      header: 'Restrictions',
      render: (p: PolicyItem) => (
        <span className="text-xs text-text-muted">
          {p.readOnlyOnly ? (
            <span className="text-brand font-medium">Read-Only Tools Only</span>
          ) : (
            'None'
          )}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (p: PolicyItem) => (
        <div className="flex justify-end">
          {isAdmin && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => setDeleteTarget(p)}
              leftIcon={<TrashIcon className="w-3.5 h-3.5" />}
            >
              Delete
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Tool Access Policies"
        description="Fine-grained authorization rules governing which roles and principals can execute upstream MCP tools."
        breadcrumbs={[{ label: 'Dashboard' }, { label: 'Policies' }]}
        actions={
          isAdmin ? (
            <Button
              onClick={() => {
                resetForm();
                setShowAddModal(true);
              }}
              leftIcon={<PlusIcon className="w-4 h-4" />}
            >
              Add Access Policy
            </Button>
          ) : undefined
        }
      />

      {/* Global Safety Shortcut: Members Read-Only Enforcement */}
      <div className="p-6 rounded-xl border border-border-default bg-surface-subtle space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ShieldIcon className="w-5 h-5 text-brand" />
              <h2 className="text-base font-bold text-text-primary">
                Global Safeguard: Members Read-Only Mode
              </h2>
              <span
                className={`text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border ${
                  data?.settings.membersReadOnly
                    ? 'bg-surface-success border-border-success text-text-success'
                    : 'bg-surface-panel border-border-default text-text-muted'
                }`}
              >
                {data?.settings.membersReadOnly ? 'Active & Enforcing' : 'Disabled'}
              </span>
            </div>
            <p className="text-xs text-text-secondary leading-relaxed max-w-2xl">
              When enabled, team members with the <span className="font-semibold text-text-primary">Member</span> role
              are automatically restricted from invoking state-mutating tools (orders, edits, deletions). Only safe query
              tools (e.g. read, list, describe) are permitted regardless of upstream server rules.
            </p>
          </div>

          {isAdmin && (
            <Button
              variant={data?.settings.membersReadOnly ? 'secondary' : 'primary'}
              onClick={() =>
                updateSettingsMutation.mutate(!data?.settings.membersReadOnly)
              }
              isLoading={updateSettingsMutation.isPending}
            >
              {data?.settings.membersReadOnly
                ? 'Disable Read-Only Mode'
                : 'Enforce Members Read-Only'}
            </Button>
          )}
        </div>
      </div>

      {/* Policies DataTable */}
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-text-primary tracking-tight">Active Policy Rules</h2>
          <p className="text-xs text-text-secondary mt-0.5">
            Evaluated in sequence at tool invocation time. Deny rules take precedence over allow rules.
          </p>
        </div>

        <DataTable<PolicyItem>
          columns={columns}
          data={data?.policies || []}
          keyExtractor={(item) => item.id}
          isLoading={isLoading}
          emptyState={
            <EmptyState
              icon={<ShieldIcon className="w-10 h-10 text-text-muted" />}
              title="No Custom Policy Rules Defined"
              description="Default role permissions are currently in effect across all connected MCP servers."
              action={
                isAdmin ? (
                  <Button
                    onClick={() => {
                      resetForm();
                      setShowAddModal(true);
                    }}
                    leftIcon={<PlusIcon className="w-4 h-4" />}
                  >
                    Add Access Policy
                  </Button>
                ) : undefined
              }
            />
          }
        />
      </div>

      {/* Add Policy Modal */}
      {showAddModal && (
        <Modal
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
          title="Create Access Control Policy"
          size="lg"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createPolicyMutation.mutate();
            }}
            className="space-y-5"
          >
            <FormSelect
              id="pol-scope"
              label="Policy Scope"
              value={formScope}
              onChange={(e) => setFormScope(e.target.value as any)}
              options={[
                { value: 'role', label: 'By Role (e.g. Member or Admin)' },
                { value: 'user', label: 'By Specific User ID' },
              ]}
            />

            {formScope === 'role' ? (
              <FormSelect
                id="pol-role"
                label="Target Role"
                value={formRole}
                onChange={(e) => setFormRole(e.target.value as any)}
                options={[
                  { value: 'member', label: 'Member' },
                  { value: 'admin', label: 'Admin' },
                ]}
              />
            ) : (
              <FormInput
                id="pol-user-id"
                label="Target User ID"
                required
                value={formSubjectId}
                onChange={(e) => setFormSubjectId(e.target.value)}
                placeholder="usr_123456"
              />
            )}

            <FormSelect
              id="pol-server"
              label="Upstream Server"
              value={formServerId}
              onChange={(e) => setFormServerId(e.target.value)}
              options={[
                { value: '*', label: 'All Connected Servers (*)' },
                ...(serversData?.servers || []).map((s: any) => ({
                  value: s.slug || s.id,
                  label: `${s.displayName || s.name || s.slug} (${s.slug})`,
                })),
              ]}
            />

            <FormInput
              id="pol-pattern"
              label="Tool Pattern"
              required
              value={formToolPattern}
              onChange={(e) => setFormToolPattern(e.target.value)}
              placeholder="e.g. * or woo_* or *_read"
              helperText="Glob pattern matching tool names. Use '*' to match all tools on the server."
            />

            <FormSelect
              id="pol-effect"
              label="Authorization Effect"
              value={formEffect}
              onChange={(e) => setFormEffect(e.target.value as any)}
              options={[
                { value: 'allow', label: 'ALLOW — Permit tool execution' },
                { value: 'deny', label: 'DENY — Block tool execution' },
              ]}
            />

            <div className="flex items-center gap-2 p-3 rounded-lg bg-surface-subtle border border-border-default">
              <input
                type="checkbox"
                id="pol-readonly"
                checked={formReadOnlyOnly}
                onChange={(e) => setFormReadOnlyOnly(e.target.checked)}
                className="rounded bg-surface-panel border-border-default text-brand focus:ring-brand h-4 w-4"
              />
              <label
                htmlFor="pol-readonly"
                className="text-xs text-text-primary cursor-pointer select-none font-medium"
              >
                Restrict effect to read-only tools only
              </label>
            </div>

            {/* Destructive Effects Preview */}
            <div
              className={`p-4 rounded-lg text-xs space-y-1.5 border ${
                formEffect === 'deny'
                  ? 'bg-surface-danger border-border-danger text-text-danger'
                  : 'bg-surface-success border-border-success text-text-success'
              }`}
            >
              <div className="flex items-center gap-1.5 font-bold">
                <AlertTriangleIcon className="w-4 h-4 flex-shrink-0" />
                <span>Effect Impact Preview</span>
              </div>
              <p className="leading-relaxed">
                {formEffect === 'deny'
                  ? `Destructive / Deny: Any tool matching "${formToolPattern}" on "${formServerId}" called by ${
                      formScope === 'role' ? `role "${formRole}"` : `user "${formSubjectId || 'ID'}"`
                    } will be REJECTED at the gateway with code policy_denied.`
                  : `Permissive / Allow: Principals with ${
                      formScope === 'role' ? `role "${formRole}"` : `user "${formSubjectId || 'ID'}"`
                    } will be PERMITTED to invoke matching "${formToolPattern}" tools.`}
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-border-default">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowAddModal(false)}
              >
                Cancel
              </Button>
              <Button type="submit" isLoading={createPolicyMutation.isPending}>
                Create Policy Rule
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteTarget && (
        <ConfirmDialog
          isOpen={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => deletePolicyMutation.mutate(deleteTarget.id)}
          title="Delete Policy Rule"
          message={`Are you sure you want to remove the ${deleteTarget.effect.toUpperCase()} policy rule for tool pattern "${deleteTarget.toolPattern}" on server "${deleteTarget.serverId}"?`}
          confirmText="Delete Policy"
          variant="danger"
          isLoading={deletePolicyMutation.isPending}
        />
      )}
    </div>
  );
};
