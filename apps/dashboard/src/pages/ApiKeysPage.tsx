import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/Toast';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { PageHeader } from '../components/ui/PageHeader';
import { DataTable, Column } from '../components/ui/DataTable';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { FormInput } from '../components/ui/FormInput';
import { EmptyState } from '../components/ui/EmptyState';
import { Tabs } from '../components/ui/Tabs';
import {
  KeyIcon,
  PlusIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  TrashIcon,
} from '../components/ui/Icons';

interface ApiKeyItem {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt?: string;
  revokedAt?: string;
  ownerId: string;
}

export const ApiKeysPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { addToast } = useToast();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<'my' | 'all'>('my');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');

  // One-time reveal state - auto-cleared upon closing
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [savedCheckbox, setSavedCheckbox] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  // Revocation state
  const [keyToRevoke, setKeyToRevoke] = useState<ApiKeyItem | null>(null);

  // 1. Fetch API Keys
  const { data: keysData, isLoading: loadingKeys } = useQuery<ApiKeyItem[]>({
    queryKey: ['api-keys'],
    queryFn: async () => {
      const res = await apiClient.get<{ keys: ApiKeyItem[] }>('/api/keys');
      return res.keys || [];
    },
  });

  // 2. Create Key Mutation
  const createKeyMutation = useMutation({
    mutationFn: async (name: string) => {
      return apiClient.post<{ key: string; item: ApiKeyItem }>('/api/keys', { name });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      setShowCreateModal(false);
      setNewKeyName('');
      // Open reveal modal
      setRevealedKey(data.key);
      setSavedCheckbox(false);
      setCopiedKey(false);
      addToast('API Key created successfully', 'success');
    },
    onError: (err: any) => {
      addToast(err?.message || 'Failed to create API key', 'error');
    },
  });

  // 3. Revoke Key Mutation
  const revokeKeyMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiClient.delete(`/api/keys/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      addToast('API Key revoked successfully', 'success');
      setKeyToRevoke(null);
    },
    onError: (err: any) => {
      addToast(err?.message || 'Failed to revoke API key', 'error');
    },
  });

  // Safe close that wipes the revealed secret from memory completely
  const closeRevealModal = () => {
    setRevealedKey(null);
    setSavedCheckbox(false);
    setCopiedKey(false);
  };

  const copyKeyToClipboard = () => {
    if (revealedKey) {
      navigator.clipboard.writeText(revealedKey);
      setCopiedKey(true);
      addToast('Copied API key to clipboard', 'info');
    }
  };

  const displayedKeys: ApiKeyItem[] = (keysData || []).filter((k: ApiKeyItem) => {
    if (!isAdmin || activeTab === 'my') {
      return k.ownerId === user?.id;
    }
    return true; // Admin 'all' tab
  });

  const columns: Column<ApiKeyItem>[] = [
    {
      key: 'name',
      header: 'Key Name & Prefix',
      render: (k: ApiKeyItem) => (
        <div>
          <div className="font-semibold text-text-primary">{k.name}</div>
          <div className="text-xs font-mono text-text-muted mt-0.5">
            Prefix: <span className="text-brand font-semibold">{k.prefix}</span>••••••••
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (k: ApiKeyItem) => (
        <StatusBadge
          status={k.revokedAt ? 'disabled' : 'connected'}
          label={k.revokedAt ? 'Revoked' : 'Active'}
        />
      ),
    },
    ...(isAdmin && activeTab === 'all'
      ? [
          {
            key: 'ownerId',
            header: 'Owner Principal',
            render: (k: ApiKeyItem) => (
              <span className="text-xs font-mono text-text-secondary">{k.ownerId}</span>
            ),
          },
        ]
      : []),
    {
      key: 'lastUsedAt',
      header: 'Last Active',
      render: (k: ApiKeyItem) => (
        <span className="text-xs text-text-muted">
          {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'Never used'}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: 'Created On',
      render: (k: ApiKeyItem) => (
        <span className="text-xs text-text-muted">
          {new Date(k.createdAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (k: ApiKeyItem) => (
        <div className="flex justify-end">
          {!k.revokedAt ? (
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                if (window.confirm(`Revoke API Key "${k.name}"? This action cannot be undone.`)) {
                  revokeKeyMutation.mutate(k.id);
                }
              }}
              isLoading={revokeKeyMutation.isPending}
              leftIcon={<TrashIcon className="w-3.5 h-3.5" />}
            >
              Revoke
            </Button>
          ) : (
            <span className="text-xs text-text-muted italic">Revoked</span>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="API Keys"
        description="Bearer authentication tokens for MCP clients (Cursor, Claude Code, MCP Inspector)."
        breadcrumbs={[{ label: 'Dashboard' }, { label: 'API Keys' }]}
        actions={
          <Button
            onClick={() => setShowCreateModal(true)}
            leftIcon={<PlusIcon className="w-4 h-4" />}
          >
            Create API Key
          </Button>
        }
      />

      {/* Admin Tabs */}
      {isAdmin && (
        <Tabs
          tabs={[
            { id: 'my', label: 'My API Keys' },
            { id: 'all', label: 'All Organization Keys (Admin Audit)' },
          ]}
          activeTab={activeTab}
          onChange={(id) => setActiveTab(id as 'my' | 'all')}
        />
      )}

      <DataTable<ApiKeyItem>
        columns={columns}
        data={displayedKeys}
        keyExtractor={(item) => item.id}
        isLoading={loadingKeys}
        emptyState={
          <EmptyState
            icon={<KeyIcon className="w-10 h-10 text-text-muted" />}
            title={activeTab === 'my' ? 'No API Keys Generated' : 'No API Keys In System'}
            description="Create an API key to connect your local development tools to the Conduit MCP gateway."
            action={
              <Button
                onClick={() => setShowCreateModal(true)}
                leftIcon={<PlusIcon className="w-4 h-4" />}
              >
                Create API Key
              </Button>
            }
          />
        }
      />

      {/* Create Key Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create New API Key"
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (newKeyName.trim()) {
              createKeyMutation.mutate(newKeyName.trim());
            }
          }}
          className="space-y-4"
        >
          <FormInput
            id="key-name"
            label="Key Name / Description"
            required
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="e.g. Cursor MacBook Pro, Claude Code Dev"
            helperText="A descriptive label so you can recognize this credential in audit logs."
          />

          <div className="flex justify-end gap-3 pt-4 border-t border-border-default">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowCreateModal(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              isLoading={createKeyMutation.isPending}
              onClick={() => {
                if (newKeyName.trim()) {
                  createKeyMutation.mutate(newKeyName.trim());
                }
              }}
            >
              Generate Key
            </Button>
          </div>
        </form>
      </Modal>

      {/* One-Time Reveal Modal */}
      <Modal
        isOpen={!!revealedKey}
        onClose={() => {
          if (savedCheckbox) {
            closeRevealModal();
          }
        }}
        title="Your New API Key"
        size="lg"
        footer={
          <div className="flex justify-end">
            <Button
              variant="primary"
              disabled={!savedCheckbox}
              onClick={closeRevealModal}
            >
              Done & Close
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          {/* Unmissable Warning Banner */}
          <div className="p-4 bg-surface-warning border-2 border-border-warning rounded-lg text-text-warning text-xs space-y-1.5">
            <div className="flex items-center gap-2 font-bold text-sm">
              <AlertTriangleIcon className="w-5 h-5 flex-shrink-0" />
              <span>One-Time Secret Key Display</span>
            </div>
            <p className="leading-relaxed">
              This secret credential will <strong>never be shown again</strong>. Conduit stores only a
              cryptographic hash (SHA-256) of your API key in accordance with our security model.
              If you lose this key, you must revoke it and generate a new one.
            </p>
          </div>

          <div>
            <label
              htmlFor="revealed-key-input"
              className="block text-xs font-bold text-text-secondary uppercase tracking-wider mb-2"
            >
              Secret API Key
            </label>
            <div className="flex items-center gap-2">
              <input
                id="revealed-key-input"
                type="text"
                readOnly
                value={revealedKey || ''}
                className="flex-1 bg-surface-subtle border-2 border-brand/40 rounded-lg px-3 py-2.5 text-xs font-mono text-brand font-semibold select-all focus:outline-none focus:ring-2 focus:ring-brand"
              />
              <Button
                variant={copiedKey ? 'secondary' : 'primary'}
                onClick={copyKeyToClipboard}
                leftIcon={copiedKey ? <CheckCircleIcon className="w-4 h-4 text-text-success" /> : undefined}
              >
                {copiedKey ? 'Copied!' : 'Copy'}
              </Button>
            </div>
          </div>

          <div className="flex items-start gap-3 p-3 rounded-lg bg-surface-subtle border border-border-default">
            <input
              type="checkbox"
              id="saved-check"
              checked={savedCheckbox}
              onChange={(e) => setSavedCheckbox(e.target.checked)}
              className="mt-0.5 rounded bg-surface-panel border-border-default text-brand focus:ring-brand h-4 w-4"
            />
            <label
              htmlFor="saved-check"
              className="text-xs text-text-primary select-none cursor-pointer font-medium leading-relaxed"
            >
              I have saved this API key in a secure location
            </label>
          </div>
        </div>
      </Modal>

      {/* Revocation ConfirmDialog */}
      {keyToRevoke && (
        <ConfirmDialog
          isOpen={!!keyToRevoke}
          onClose={() => setKeyToRevoke(null)}
          onConfirm={() => revokeKeyMutation.mutate(keyToRevoke.id)}
          title={`Revoke API Key: ${keyToRevoke.name}`}
          message={`Are you sure you want to revoke key "${keyToRevoke.name}" (prefix: ${keyToRevoke.prefix})? Any active MCP client or session using this key will immediately be denied access.`}
          confirmText="Revoke API Key"
          variant="danger"
          isLoading={revokeKeyMutation.isPending}
        />
      )}
    </div>
  );
};
