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
import { FormInput, FormSelect } from '../components/ui/FormInput';
import { EmptyState } from '../components/ui/EmptyState';
import {
  ServerIcon,
  PlusIcon,
  CheckCircleIcon,
  XCircleIcon,
  AlertTriangleIcon,
  RefreshCwIcon,
  WrenchIcon,
  EyeIcon,
  EditIcon,
  TrashIcon,
} from '../components/ui/Icons';

interface Server {
  id: string;
  name: string;
  slug: string;
  transport: string;
  url: string;
  status: 'connected' | 'unreachable' | 'disabled';
  lastStatusReason?: string;
  lastCheckedAt?: string;
  isSystem: boolean;
  enabled: boolean;
  toolCount: number;
}

interface ToolItem {
  name: string;
  description: string;
  descriptionRaw?: string;
  approved: boolean;
  approvalStatus: 'approved' | 'pending' | 'changed';
  previousDescription?: string;
}

export const ServersPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { addToast } = useToast();
  const queryClient = useQueryClient();

  // Selected server for tools drawer / modal
  const [selectedServer, setSelectedServer] = useState<Server | null>(null);

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [editServer, setEditServer] = useState<Server | null>(null);
  const [deleteServer, setDeleteServer] = useState<Server | null>(null);

  // Add / Edit form state
  const [formName, setFormName] = useState('');
  const [formSlug, setFormSlug] = useState('');
  const [formTransport, setFormTransport] = useState('sse');
  const [formUrl, setFormUrl] = useState('');
  const [formAuthType, setFormAuthType] = useState('none');
  const [formCredential, setFormCredential] = useState('');
  const [testingConnection, setTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // 1. Fetch servers with 10s auto-refresh
  const {
    data: serversData,
    isLoading: loadingServers,
    error: serversError,
    refetch: refetchServers,
  } = useQuery({
    queryKey: ['servers'],
    queryFn: async () => {
      const res = await apiClient.get<{ servers: any[] }>('/api/servers');
      return (res.servers || []).map((s: any) => {
        const raw = s.status;
        const state = typeof raw === 'object' && raw !== null ? raw.state : raw;
        const reason =
          typeof raw === 'object' && raw !== null
            ? raw.reason || raw.reasonCode
            : s.lastStatusReason;
        return {
          id: s.id || s._id || s.slug,
          name: s.displayName || s.name || s.slug,
          slug: s.slug,
          transport: s.transport || 'sse',
          url: s.url || '',
          status: !s.enabled ? 'disabled' : (state || 'unreachable'),
          lastStatusReason: reason,
          lastCheckedAt: s.lastCheckedAt || (typeof raw === 'object' && raw?.checkedAt) || s.updatedAt,
          isSystem: Boolean(s.system || s.isSystem),
          enabled: Boolean(s.enabled),
          toolCount: Array.isArray(s.tools) ? s.tools.length : s.toolCount || 0,
        } as Server;
      });
    },
    refetchInterval: 10000,
  });

  // 2. Fetch tools for selected server
  const { data: toolsData, isLoading: loadingTools } = useQuery({
    queryKey: ['server-tools', selectedServer?.id],
    queryFn: async () => {
      if (!selectedServer) return [];
      const res = await apiClient.get<{ tools: any[] }>(`/api/servers/${selectedServer.id}/tools`);
      return (res.tools || []).map((t) => ({
        name: t.name,
        description: t.description,
        descriptionRaw: t.descriptionRaw,
        approved: t.approval ? t.approval.status === 'approved' : true,
        approvalStatus: t.approval ? t.approval.status : 'approved',
        previousDescription: t.previousDescription,
      })) as ToolItem[];
    },
    enabled: !!selectedServer,
  });

  // Mutations
  const toggleServerMutation = useMutation({
    mutationFn: async ({ id, enable }: { id: string; enable: boolean }) => {
      return apiClient.post(`/api/servers/${id}/${enable ? 'enable' : 'disable'}`);
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      addToast(`Server ${vars.enable ? 'enabled' : 'disabled'} successfully`, 'success');
    },
    onError: (err: any) => {
      addToast(err?.message || 'Failed to update server status', 'error');
    },
  });

  const approveToolMutation = useMutation({
    mutationFn: async ({
      serverId,
      toolName,
    }: {
      serverId: string;
      toolName: string;
      approved?: boolean;
    }) => {
      return apiClient.post(`/api/servers/${serverId}/tools/approve`, { toolName });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['server-tools', selectedServer?.id] });
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      addToast('Tool approval status updated', 'success');
    },
    onError: (err: any) => {
      addToast(err?.message || 'Failed to update tool approval', 'error');
    },
  });

  const deleteServerMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiClient.delete(`/api/servers/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      addToast('Server deleted successfully', 'success');
      setDeleteServer(null);
    },
    onError: (err: any) => {
      addToast(err?.message || 'Failed to delete server', 'error');
    },
  });

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setTestResult(null);
    try {
      const res = await apiClient.post<{ ok: boolean; status: string; error?: string }>(
        '/api/servers/test',
        {
          url: formUrl,
          auth: { type: formAuthType, credential: formCredential || undefined },
        }
      );
      if (res.ok) {
        setTestResult({ ok: true, message: 'Connection test succeeded!' });
      } else {
        setTestResult({ ok: false, message: res.error || res.status || 'Connection failed' });
      }
    } catch (err: any) {
      setTestResult({ ok: false, message: err?.message || 'Connection test failed' });
    } finally {
      setTestingConnection(false);
    }
  };

  const handleSaveServer = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editServer) {
        await apiClient.put(`/api/servers/${editServer.id}`, {
          name: formName,
          url: formUrl,
          credential: formCredential ? formCredential : undefined,
        });
        addToast('Server updated successfully', 'success');
        setEditServer(null);
      } else {
        await apiClient.post('/api/servers', {
          displayName: formName,
          slug: formSlug,
          url: formUrl,
          auth: { type: formAuthType, credential: formCredential || undefined },
          enabled: true,
        });
        addToast('Server registered successfully', 'success');
        setShowAddModal(false);
      }
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      resetForm();
    } catch (err: any) {
      addToast(err?.message || 'Failed to save server', 'error');
    }
  };

  const resetForm = () => {
    setFormName('');
    setFormSlug('');
    setFormTransport('sse');
    setFormUrl('');
    setFormAuthType('none');
    setFormCredential('');
    setTestResult(null);
  };

  const openEdit = (server: Server) => {
    setEditServer(server);
    setFormName(server.name);
    setFormSlug(server.slug);
    setFormTransport(server.transport);
    setFormUrl(server.url);
    setFormAuthType('bearer');
    setFormCredential('');
    setTestResult(null);
  };

  const columns: Column<Server>[] = [
    {
      key: 'name',
      header: 'Server Name',
      render: (srv: Server) => (
        <div className="flex items-center gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-text-primary">{srv.name}</span>
              {srv.isSystem && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-brand/10 text-brand border border-brand/20">
                  System
                </span>
              )}
            </div>
            <div className="text-xs font-mono text-text-muted mt-0.5">{srv.slug}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Connectivity',
      render: (srv: Server) => (
        <div className="flex flex-col gap-1">
          <StatusBadge status={srv.status} />
          {srv.lastStatusReason && (
            <span className="text-xs text-text-muted truncate max-w-xs" title={srv.lastStatusReason}>
              {srv.lastStatusReason}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'toolCount',
      header: 'Discovered Tools',
      render: (srv: Server) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSelectedServer(srv)}
          leftIcon={<WrenchIcon className="w-4 h-4 text-brand" />}
        >
          {srv.toolCount} {srv.toolCount === 1 ? 'tool' : 'tools'}
        </Button>
      ),
    },
    {
      key: 'lastCheckedAt',
      header: 'Last Checked',
      render: (srv: Server) => (
        <span className="text-xs text-text-muted">
          {srv.lastCheckedAt ? new Date(srv.lastCheckedAt).toLocaleTimeString() : 'Never'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (srv: Server) => (
        <div className="flex items-center justify-end gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setSelectedServer(srv)}
            leftIcon={<EyeIcon className="w-3.5 h-3.5" />}
          >
            View Tools
          </Button>

          {isAdmin && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => openEdit(srv)}
                leftIcon={<EditIcon className="w-3.5 h-3.5" />}
              >
                Edit
              </Button>
              <Button
                variant={srv.enabled ? 'secondary' : 'primary'}
                size="sm"
                onClick={() => toggleServerMutation.mutate({ id: srv.id, enable: !srv.enabled })}
                isLoading={toggleServerMutation.isPending}
              >
                {srv.enabled ? 'Disable' : 'Enable'}
              </Button>
              {!srv.isSystem && (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setDeleteServer(srv)}
                  leftIcon={<TrashIcon className="w-3.5 h-3.5" />}
                >
                  Delete
                </Button>
              )}
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="MCP Upstream Servers"
        description="Registered tool providers, connectivity telemetry, and catalog authorization pinning."
        breadcrumbs={[{ label: 'Dashboard' }, { label: 'Servers' }]}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => refetchServers()}
              leftIcon={<RefreshCwIcon className="w-4 h-4" />}
            >
              Refresh
            </Button>
            {isAdmin && (
              <Button
                size="sm"
                onClick={() => {
                  resetForm();
                  setShowAddModal(true);
                }}
                leftIcon={<PlusIcon className="w-4 h-4" />}
              >
                Add Upstream Server
              </Button>
            )}
          </div>
        }
      />

      {serversError ? (
        <div className="p-4 rounded-lg bg-surface-danger border border-border-danger text-text-danger text-sm flex items-center gap-3">
          <AlertTriangleIcon className="w-5 h-5 flex-shrink-0" />
          <span>{(serversError as any)?.message || 'Failed to load servers'}</span>
        </div>
      ) : (
        <DataTable<Server>
          columns={columns}
          data={serversData || []}
          keyExtractor={(item) => item.id}
          isLoading={loadingServers}
          emptyState={
            <EmptyState
              icon={<ServerIcon className="w-10 h-10 text-text-muted" />}
              title="No MCP Upstream Servers Configured"
              description="Register an upstream MCP server to enable tools for Claude Code, Cursor, and Conduit Assistant."
              action={
                isAdmin ? (
                  <Button
                    onClick={() => {
                      resetForm();
                      setShowAddModal(true);
                    }}
                    leftIcon={<PlusIcon className="w-4 h-4" />}
                  >
                    Add Upstream Server
                  </Button>
                ) : undefined
              }
            />
          }
        />
      )}

      {/* Tool Catalog Drawer / Modal */}
      {selectedServer && (
        <Modal
          isOpen={!!selectedServer}
          onClose={() => setSelectedServer(null)}
          title={`Tool Catalog: ${selectedServer.name}`}
          size="xl"
          footer={
            <Button variant="secondary" onClick={() => setSelectedServer(null)}>
              Close
            </Button>
          }
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-lg bg-surface-subtle border border-border-default">
              <div className="text-xs text-text-secondary">
                Upstream server endpoint:{' '}
                <span className="font-mono text-text-primary">{selectedServer.url}</span>
              </div>
              <StatusBadge status={selectedServer.status} />
            </div>

            <p className="text-xs text-text-secondary">
              Tools discovered from upstream endpoint. Only approved tools are published to MCP clients.
              If an upstream tool changes its schema or description, it requires re-approval.
            </p>

            {loadingTools ? (
              <div className="py-8 text-center text-text-muted text-sm">Loading tools catalog...</div>
            ) : toolsData && toolsData.length > 0 ? (
              <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
                {toolsData.map((tool: ToolItem) => (
                  <div
                    key={tool.name}
                    className="p-4 rounded-lg border border-border-default bg-surface-subtle flex flex-col gap-3"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-text-primary text-sm">
                          {tool.name}
                        </span>
                        <StatusBadge
                          status={
                            tool.approvalStatus === 'approved'
                              ? 'connected'
                              : tool.approvalStatus === 'changed'
                              ? 'unreachable'
                              : 'disabled'
                          }
                          label={tool.approvalStatus}
                        />
                      </div>

                      {isAdmin && (
                        <div className="flex items-center gap-2">
                          {tool.approved ? (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() =>
                                approveToolMutation.mutate({
                                  serverId: selectedServer.id,
                                  toolName: tool.name,
                                  approved: false,
                                })
                              }
                              isLoading={approveToolMutation.isPending}
                            >
                              Revoke Approval
                            </Button>
                          ) : (
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() =>
                                approveToolMutation.mutate({
                                  serverId: selectedServer.id,
                                  toolName: tool.name,
                                  approved: true,
                                })
                              }
                              isLoading={approveToolMutation.isPending}
                            >
                              Approve Tool
                            </Button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Diff notice if tool changed */}
                    {tool.approvalStatus === 'changed' && (
                      <div className="p-3 rounded border border-border-warning bg-surface-warning text-text-warning text-xs space-y-2">
                        <div className="flex items-center gap-1.5 font-semibold">
                          <AlertTriangleIcon className="w-4 h-4" />
                          <span>Tool Definition Diff Detected</span>
                        </div>
                        <p>
                          Upstream tool schema or description changed since last approval. Tool execution is
                          suspended until re-approved by an administrator.
                        </p>
                        {tool.previousDescription && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 pt-1 font-mono text-[11px]">
                            <div className="p-2 rounded bg-surface-panel border border-border-default">
                              <span className="text-text-muted block text-[10px] uppercase font-bold mb-1">Previous</span>
                              <span className="text-text-danger line-through">{tool.previousDescription}</span>
                            </div>
                            <div className="p-2 rounded bg-surface-panel border border-border-default">
                              <span className="text-text-muted block text-[10px] uppercase font-bold mb-1">Incoming</span>
                              <span className="text-text-success">{tool.description}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Plain text description - no HTML */}
                    <p className="text-xs text-text-secondary leading-relaxed break-words whitespace-pre-wrap">
                      {tool.description || 'No description provided by upstream server.'}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-text-muted text-sm">
                No tools registered or discovered for this server.
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Add / Edit Server Modal */}
      {(showAddModal || !!editServer) && (
        <Modal
          isOpen={showAddModal || !!editServer}
          onClose={() => {
            setShowAddModal(false);
            setEditServer(null);
            resetForm();
          }}
          title={editServer ? `Edit Server: ${editServer.name}` : 'Register Upstream MCP Server'}
          size="lg"
        >
          <form onSubmit={handleSaveServer} className="space-y-6">
            {/* Group 1: Upstream Connection */}
            <div className="space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider text-text-muted border-b border-border-default pb-1">
                1. Upstream Connection
              </div>
              <FormInput
                id="srv-name"
                label="Server Name"
                required
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="WooCommerce Store"
                helperText="Human-friendly label displayed in Conduit dashboard."
              />

              {!editServer && (
                <FormInput
                  id="srv-slug"
                  label="Unique Slug"
                  required
                  value={formSlug}
                  onChange={(e) =>
                    setFormSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))
                  }
                  placeholder="woo"
                  helperText="Prefix used in MCP tool names (e.g. woo_list_products)."
                />
              )}

              <FormSelect
                id="srv-transport"
                label="Transport Protocol"
                value={formTransport}
                onChange={(e) => setFormTransport(e.target.value)}
                disabled={!!editServer}
                options={[
                  { value: 'sse', label: 'Server-Sent Events (SSE)' },
                  { value: 'stdio', label: 'Standard I/O (stdio)' },
                ]}
              />

              <FormInput
                id="srv-url"
                label="Endpoint URL"
                required
                type="url"
                value={formUrl}
                onChange={(e) => setFormUrl(e.target.value)}
                placeholder="http://store-woocommerce-store-woo-mcp:3000/sse"
                helperText="Network address of the upstream MCP service."
              />
            </div>

            {/* Group 2: Credential Configuration */}
            <div className="space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider text-text-muted border-b border-border-default pb-1">
                2. Authentication & Secrets
              </div>
              <FormSelect
                id="srv-auth"
                label="Authentication Type"
                value={formAuthType}
                onChange={(e) => setFormAuthType(e.target.value)}
                options={[
                  { value: 'none', label: 'None (Public / Internal Mesh)' },
                  { value: 'bearer', label: 'Bearer Token / Secret' },
                  { value: 'basic', label: 'Basic Authentication' },
                ]}
              />

              <FormInput
                id="srv-credential"
                label="Credential / Secret"
                type="password"
                value={formCredential}
                onChange={(e) => setFormCredential(e.target.value)}
                placeholder={editServer ? '•••••••• (leave blank to keep current)' : 'Secret token or key'}
                helperText="Stored encrypted at rest in MongoDB. Write-only: never shown again in UI or API responses."
              />
            </div>

            {/* Group 3: Diagnostics & Validation */}
            <div className="space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider text-text-muted border-b border-border-default pb-1">
                3. Connection Diagnostics
              </div>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleTestConnection}
                  isLoading={testingConnection}
                  disabled={!formUrl}
                >
                  Test Upstream Connection
                </Button>
                <span className="text-xs text-text-muted">
                  Validates endpoint handshake before saving.
                </span>
              </div>
              {testResult && (
                <div
                  className={`p-3 rounded-lg text-xs border flex items-center gap-2 ${
                    testResult.ok
                      ? 'bg-surface-success border-border-success text-text-success'
                      : 'bg-surface-danger border-border-danger text-text-danger'
                  }`}
                >
                  {testResult.ok ? (
                    <CheckCircleIcon className="w-4 h-4 flex-shrink-0" />
                  ) : (
                    <XCircleIcon className="w-4 h-4 flex-shrink-0" />
                  )}
                  <span>{testResult.message}</span>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-border-default">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setShowAddModal(false);
                  setEditServer(null);
                  resetForm();
                }}
              >
                Cancel
              </Button>
              <Button type="submit">Save Upstream Server</Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Typed Delete Confirmation Dialog */}
      {deleteServer && (
        <ConfirmDialog
          isOpen={!!deleteServer}
          onClose={() => setDeleteServer(null)}
          onConfirm={() => deleteServerMutation.mutate(deleteServer.id)}
          title={`Delete Server: ${deleteServer.name}`}
          message="This action cannot be undone. All pinned tools and upstream route mappings will be permanently removed."
          confirmText="Permanently Delete Server"
          confirmKeyword={deleteServer.name}
          variant="danger"
          isLoading={deleteServerMutation.isPending}
        />
      )}
    </div>
  );
};
