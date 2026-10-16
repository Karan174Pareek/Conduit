import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/Toast';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Table, Column } from '../components/ui/Table';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';

interface ApiKeyItem {
  id: string;
  name: string;
  prefix: string;
  last4?: string;
  ownerId: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

interface CreatedKeyResponse {
  id: string;
  name: string;
  prefix: string;
  key: string;
  createdAt: string;
}

export const ApiKeysPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { addToast } = useToast();
  const queryClient = useQueryClient();

  // Active view tab for admins: 'my' vs 'all'
  const [activeTab, setActiveTab] = useState<'my' | 'all'>('my');

  // Create Key modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');

  // One-time reveal modal state
  const [revealedKey, setRevealedKey] = useState<string | null>(null);
  const [savedCheckbox, setSavedCheckbox] = useState(false);

  // 1. Fetch Keys
  const { data: keysData, isLoading: loadingKeys } = useQuery({
    queryKey: ['api-keys'],
    queryFn: async () => {
      const res = await apiClient.get<{ keys: ApiKeyItem[] }>('/api/keys');
      return res.keys;
    },
  });

  // 2. Create Key Mutation
  const createKeyMutation = useMutation({
    mutationFn: async (name: string) => {
      return apiClient.post<CreatedKeyResponse>('/api/keys', { name });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      setShowCreateModal(false);
      setNewKeyName('');
      // Open reveal modal
      setRevealedKey(data.key);
      setSavedCheckbox(false);
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
      addToast('API Key revoked', 'success');
    },
    onError: (err: any) => {
      addToast(err?.message || 'Failed to revoke API key', 'error');
    },
  });

  // Safe close that clears the revealed secret from memory completely
  const closeRevealModal = () => {
    setRevealedKey(null);
    setSavedCheckbox(false);
  };

  const copyKeyToClipboard = () => {
    if (revealedKey) {
      navigator.clipboard.writeText(revealedKey);
      addToast('Copied API key to clipboard!', 'info');
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
      header: 'Key Name',
      render: (k: ApiKeyItem) => (
        <div>
          <div className="font-medium text-white">{k.name}</div>
          <div className="text-xs font-mono text-slate-400">Prefix: {k.prefix}...</div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (k: ApiKeyItem) => (
        <Badge variant={k.revokedAt ? 'danger' : 'success'}>
          {k.revokedAt ? 'Revoked' : 'Active'}
        </Badge>
      ),
    },
    ...(isAdmin && activeTab === 'all'
      ? [
          {
            key: 'ownerId',
            header: 'Owner ID',
            render: (k: ApiKeyItem) => (
              <span className="text-xs font-mono text-slate-400">{k.ownerId}</span>
            ),
          },
        ]
      : []),
    {
      key: 'lastUsedAt',
      header: 'Last Used',
      render: (k: ApiKeyItem) => (
        <span className="text-xs text-slate-400">
          {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'Never'}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: 'Created',
      render: (k: ApiKeyItem) => (
        <span className="text-xs text-slate-400">
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
              onClick={() => revokeKeyMutation.mutate(k.id)}
              isLoading={revokeKeyMutation.isPending}
            >
              Revoke
            </Button>
          ) : (
            <span className="text-xs text-slate-500 italic">Revoked</span>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">API Keys</h1>
          <p className="text-sm text-slate-400 mt-1">
            Authentication credentials for MCP clients (Cursor, Claude Code, MCP Inspector).
          </p>
        </div>
        <Button onClick={() => setShowCreateModal(true)}>Create API Key</Button>
      </div>

      {/* Admin Tabs */}
      {isAdmin && (
        <div className="flex space-x-2 border-b border-slate-800 pb-2">
          <button
            type="button"
            onClick={() => setActiveTab('my')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'my'
                ? 'bg-slate-800 text-white font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            My API Keys
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('all')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'all'
                ? 'bg-slate-800 text-white font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            All Keys (Admin Overview)
          </button>
        </div>
      )}

      <Table<ApiKeyItem>
        columns={columns}
        data={displayedKeys}
        keyExtractor={(item: ApiKeyItem) => item.id}
        isLoading={loadingKeys}
        emptyMessage={
          activeTab === 'my'
            ? 'You have not created any API keys yet.'
            : 'No API keys exist in the system.'
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
          <Input
            id="key-name"
            label="Key Name / Description"
            required
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="e.g. Cursor Work Laptop, Claude Code Dev"
            helperText="A descriptive label so you can identify where this key is used."
          />

          <div className="flex justify-end space-x-3 pt-4 border-t border-slate-800">
            <Button type="button" variant="secondary" onClick={() => setShowCreateModal(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={createKeyMutation.isPending}>
              Generate Key
            </Button>
          </div>
        </form>
      </Modal>

      {/* One-Time Reveal Modal */}
      <Modal
        isOpen={!!revealedKey}
        onClose={closeRevealModal}
        title="Your New API Key"
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
        <div className="space-y-4">
          <div className="p-3 bg-amber-950/40 border border-amber-800 rounded-lg text-amber-200 text-xs">
            <strong>Important:</strong> Please copy your API key now. For security, it will{' '}
            <span className="underline">never</span> be shown again.
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
              Secret API Key
            </label>
            <div className="flex items-center space-x-2">
              <input
                type="text"
                readOnly
                value={revealedKey || ''}
                className="flex-1 bg-slate-900 border border-cyan-800 rounded-lg px-3 py-2 text-xs font-mono text-cyan-300 select-all"
              />
              <Button size="sm" onClick={copyKeyToClipboard}>
                Copy
              </Button>
            </div>
          </div>

          <div className="flex items-center space-x-2 pt-2">
            <input
              type="checkbox"
              id="saved-check"
              checked={savedCheckbox}
              onChange={(e) => setSavedCheckbox(e.target.checked)}
              className="rounded bg-slate-900 border-slate-700 text-cyan-600 focus:ring-cyan-500 h-4 w-4"
            />
            <label htmlFor="saved-check" className="text-xs text-slate-300 select-none cursor-pointer">
              I have saved this API key in a secure location
            </label>
          </div>
        </div>
      </Modal>
    </div>
  );
};
