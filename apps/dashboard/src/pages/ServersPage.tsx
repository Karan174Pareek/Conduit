import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/Toast';
import { Button } from '../components/ui/Button';
import { Badge, StatusBadge } from '../components/ui/Badge';
import { Table, Column } from '../components/ui/Table';
import { Modal } from '../components/ui/Modal';
import { Input } from '../components/ui/Input';

interface Server {
  id: string;
  _id?: string;
  displayName?: string;
  name: string;
  slug: string;
  transport: string;
  url: string;
  status: 'connected' | 'unreachable' | 'disabled';
  lastStatusReason?: string;
  lastCheckedAt?: string;
  isSystem: boolean;
  system?: boolean;
  updatedAt?: string;
  enabled: boolean;
  toolCount: number;
  tools?: any[];
}

interface ToolItem {
  name: string;
  description: string;
  descriptionRaw?: string;
  approved: boolean;
  approvalStatus: 'approved' | 'pending' | 'changed';
  approval?: { status: 'approved' | 'pending' | 'changed' };
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
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

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
  } = useQuery({
    queryKey: ['servers'],
    queryFn: async () => {
      const res = await apiClient.get<{ servers: Server[] }>('/api/servers');
      return (res.servers || []).map((s: any) => { const raw = s.status; const state = typeof raw === 'object' && raw !== null ? raw.state : raw; const reason = typeof raw === 'object' && raw !== null ? (raw.reason || raw.reasonCode) : s.lastStatusReason; return { id: s.id || s._id || s.slug, name: s.displayName || s.name || s.slug, slug: s.slug, transport: s.transport || 'sse', url: s.url || '', status: !s.enabled ? 'disabled' : (state || 'unreachable'), lastStatusReason: reason, lastCheckedAt: s.lastCheckedAt || (typeof raw === 'object' && raw?.checkedAt) || s.updatedAt, isSystem: Boolean(s.system || s.isSystem), enabled: Boolean(s.enabled), toolCount: Array.isArray(s.tools) ? s.tools.length : (s.toolCount || 0) }; });
    },
    refetchInterval: 10000, // 10 seconds auto-refresh
  });

  // 2. Fetch tools for selected server
  const {
    data: toolsData,
    isLoading: loadingTools,
  } = useQuery({
    queryKey: ['server-tools', selectedServer?.id],
    queryFn: async () => {
      if (!selectedServer) return [];
      const res = await apiClient.get<{ tools: ToolItem[] }>(`/api/servers/${selectedServer.id}/tools`);
      return (res.tools || []).map((t) => ({ name: t.name, description: t.description, descriptionRaw: t.descriptionRaw, approved: t.approval ? t.approval.status === 'approved' : true, approvalStatus: t.approval ? t.approval.status : 'approved' }));
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
    mutationFn: async ({ serverId, toolName }: { serverId: string; toolName: string; approved?: boolean }) => {
      return apiClient.post(`/api/servers/${serverId}/tools/approve`, {
        toolName,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['server-tools', selectedServer?.id] });
      queryClient.invalidateQueries({ queryKey: ['servers'] });
      addToast('Tool approval updated', 'success');
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
      setDeleteConfirmText('');
    },
    onError: (err: any) => {
      addToast(err?.message || 'Failed to delete server', 'error');
    },
  });

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setTestResult(null);
    try {
      const res = await apiClient.post<{ ok: boolean; status: string; error?: string }>('/api/servers/test', {
        url: formUrl, auth: { type: formAuthType, credential: formCredential || undefined }
      });
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
        await apiClient.post('/api/servers', { displayName: formName, slug: formSlug, url: formUrl, auth: { type: formAuthType, credential: formCredential || undefined }, enabled: true });
        addToast('Server added successfully', 'success');
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
    setFormCredential(''); // Blank credential = keep existing (write-only)
    setTestResult(null);
  };

  const columns: Column<Server>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (srv: Server) => (
        <div className="flex items-center space-x-2">
          <span className="font-medium text-white">{srv.name}</span>
          {srv.isSystem && <Badge variant="info">System</Badge>}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (srv: Server) => (
        <div className="flex flex-col">
          <StatusBadge status={srv.status} />
          {srv.lastStatusReason && (
            <span className="text-xs text-slate-400 mt-0.5 truncate max-w-xs" title={srv.lastStatusReason}>
              {srv.lastStatusReason}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'toolCount',
      header: 'Tools',
      render: (srv: Server) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSelectedServer(srv)}
          className="text-cyan-400 hover:text-cyan-300"
        >
          {srv.toolCount ?? 0} {srv.toolCount === 1 ? 'tool' : 'tools'}
        </Button>
      ),
    },
    {
      key: 'lastCheckedAt',
      header: 'Last Checked',
      render: (srv: Server) => (
        <span className="text-xs text-slate-400">
          {srv.lastCheckedAt ? new Date(srv.lastCheckedAt).toLocaleTimeString() : 'Never'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (srv: Server) => (
        <div className="flex items-center justify-end space-x-2">
          <Button variant="outline" size="sm" onClick={() => setSelectedServer(srv)}>
            View Tools
          </Button>

          {isAdmin && (
            <>
              <Button variant="ghost" size="sm" onClick={() => openEdit(srv)}>
                Edit
              </Button>
              <Button
                variant={srv.enabled ? 'outline' : 'secondary'}
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
                  onClick={() => {
                    setDeleteServer(srv);
                    setDeleteConfirmText('');
                  }}
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
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">MCP Upstream Servers</h1>
          <p className="text-sm text-slate-400 mt-1">
            Registered tool providers, connectivity status, and catalog pinning.
          </p>
        </div>
        {isAdmin && (
          <Button
            onClick={() => {
              resetForm();
              setShowAddModal(true);
            }}
          >
            Add Upstream Server
          </Button>
        )}
      </div>

      {serversError ? (
        <div className="p-4 rounded-lg bg-rose-950/40 border border-rose-800 text-rose-300 text-sm">
          {(serversError as any)?.message || 'Failed to load servers'}
        </div>
      ) : (
        <Table<Server>
          columns={columns}
          data={serversData || []}
          keyExtractor={(item: Server) => item.id}
          isLoading={loadingServers}
          emptyMessage="No MCP servers configured yet."
        />
      )}

      {/* Tool Catalog Modal */}
      {selectedServer && (
        <Modal
          isOpen={!!selectedServer}
          onClose={() => setSelectedServer(null)}
          title={`Tools Catalog: ${selectedServer.name}`}
          size="xl"
          footer={
            <Button variant="secondary" onClick={() => setSelectedServer(null)}>
              Close
            </Button>
          }
        >
          <div className="space-y-4">
            <p className="text-xs text-slate-400">
              Tools discovered from upstream endpoint. Only approved tools are published to MCP clients.
            </p>

            {loadingTools ? (
              <div className="py-8 text-center text-slate-400 text-sm">Loading tools catalog...</div>
            ) : toolsData && toolsData.length > 0 ? (
              <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-2">
                {toolsData.map((tool: ToolItem) => (
                  <div
                    key={tool.name}
                    className="p-3.5 rounded-lg border border-slate-800 bg-slate-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold text-white text-sm font-mono">{tool.name}</span>
                        <Badge
                          variant={
                            tool.approvalStatus === 'approved'
                              ? 'success'
                              : tool.approvalStatus === 'changed'
                              ? 'warning'
                              : 'neutral'
                          }
                          size="sm"
                        >
                          {tool.approvalStatus}
                        </Badge>
                      </div>
                      {/* Strictly plain text rendering - ESLint rule bans dangerouslySetInnerHTML */}
                      <p className="text-xs text-slate-300 leading-relaxed break-words whitespace-pre-wrap">
                        {tool.description || 'No description provided.'}
                      </p>
                    </div>

                    {isAdmin && (
                      <div className="flex items-center space-x-2">
                        {tool.approved ? (
                          <Button
                            variant="outline"
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
                            Unapprove
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
                            Approve
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-slate-500 text-sm">
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
          title={editServer ? `Edit Server: ${editServer.name}` : 'Add New Upstream Server'}
          size="lg"
        >
          <form onSubmit={handleSaveServer} className="space-y-4">
            <Input
              id="srv-name"
              label="Server Name"
              required
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="WooCommerce Store"
            />

            {!editServer && (
              <Input
                id="srv-slug"
                label="Unique Slug"
                required
                value={formSlug}
                onChange={(e) => setFormSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                placeholder="woo"
                helperText="Identifier used in MCP tool names (e.g. woo_list_products)"
              />
            )}

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Transport</label>
              <select
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                value={formTransport}
                onChange={(e) => setFormTransport(e.target.value)}
                disabled={!!editServer}
              >
                <option value="sse">Server-Sent Events (SSE)</option>
                <option value="stdio">Standard I/O (stdio)</option>
              </select>
            </div>

            <Input
              id="srv-url"
              label="Endpoint URL"
              required
              type="url"
              value={formUrl}
              onChange={(e) => setFormUrl(e.target.value)}
              placeholder="http://store-woocommerce-store-woo-mcp:3000/sse"
            />

            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">Authentication Type</label>
              <select
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                value={formAuthType}
                onChange={(e) => setFormAuthType(e.target.value)}
              >
                <option value="none">None</option>
                <option value="bearer">Bearer Token / Secret</option>
                <option value="basic">Basic Auth</option>
              </select>
            </div>

            <Input
              id="srv-credential"
              label="Credential / Secret"
              type="password"
              value={formCredential}
              onChange={(e) => setFormCredential(e.target.value)}
              placeholder={editServer ? '•••••••• (leave blank to keep current)' : 'Secret key or token'}
              helperText={editServer ? 'Write-only: current credential is encrypted in database.' : undefined}
            />

            {/* Test Connection Button */}
            <div className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleTestConnection}
                isLoading={testingConnection}
                disabled={!formUrl}
              >
                Test Connection
              </Button>
              {testResult && (
                <div
                  className={`mt-2 p-2.5 rounded text-xs border ${
                    testResult.ok
                      ? 'bg-emerald-950/40 border-emerald-800 text-emerald-200'
                      : 'bg-rose-950/40 border-rose-800 text-rose-200'
                  }`}
                >
                  {testResult.message}
                </div>
              )}
            </div>

            <div className="flex justify-end space-x-3 pt-4 border-t border-slate-800">
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
              <Button type="submit">Save Server</Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Typed Delete Confirmation Modal */}
      {deleteServer && (
        <Modal
          isOpen={!!deleteServer}
          onClose={() => setDeleteServer(null)}
          title={`Delete Server: ${deleteServer.name}`}
          footer={
            <div className="flex justify-end space-x-3">
              <Button variant="secondary" onClick={() => setDeleteServer(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={deleteConfirmText !== deleteServer.name}
                isLoading={deleteServerMutation.isPending}
                onClick={() => deleteServerMutation.mutate(deleteServer.id)}
              >
                Permanently Delete
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            <p className="text-sm text-slate-300">
              This action cannot be undone. All pinned tools and upstream configuration will be removed.
            </p>
            <p className="text-sm text-slate-400">
              To confirm, type <span className="font-semibold text-rose-400">{deleteServer.name}</span> below:
            </p>
            <Input
              id="confirm-delete"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={deleteServer.name}
            />
          </div>
        </Modal>
      )}
    </div>
  );
};
