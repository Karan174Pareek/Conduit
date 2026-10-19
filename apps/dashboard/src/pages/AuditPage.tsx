import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/Toast';
import { Button } from '../components/ui/Button';
import { StatusBadge } from '../components/ui/StatusBadge';
import { PageHeader } from '../components/ui/PageHeader';
import { DataTable, Column } from '../components/ui/DataTable';
import { FormInput, FormSelect } from '../components/ui/FormInput';
import { EmptyState } from '../components/ui/EmptyState';
import { Tabs } from '../components/ui/Tabs';
import {
  FileTextIcon,
  DownloadIcon,
  FilterIcon,
  CopyIcon,
  CheckCircleIcon,
  ClockIcon,
} from '../components/ui/Icons';

interface AuditItem {
  id?: string;
  requestId: string;
  ts: string;
  serverSlug: string;
  tool: string;
  exposedName?: string;
  userId: string;
  userEmail?: string;
  via: 'dashboard' | 'mcp_client';
  outcome: 'success' | 'error' | 'timeout' | 'unreachable' | 'denied';
  durationMs: number;
}

interface AdminEventItem {
  id: string;
  requestId: string;
  actorEmail: string;
  action: string;
  target?: { type: string; id: string; label?: string };
  ts: string;
}

export const AuditPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { addToast } = useToast();

  const [activeTab, setActiveTab] = useState<'tool_calls' | 'admin_events'>('tool_calls');
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  // Filters for tool_calls
  const [serverFilter, setServerFilter] = useState('');
  const [toolFilter, setToolFilter] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Pagination
  const [page, setPage] = useState(1);
  const [allItems, setAllItems] = useState<AuditItem[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // 1. Fetch tool execution logs
  const { data: auditData, isLoading: loadingAudit, isFetching: fetchingAudit } = useQuery<{
    items: AuditItem[];
    total: number;
  }>({
    queryKey: ['audit-logs', page, serverFilter, toolFilter, outcomeFilter, userFilter, fromDate, toDate],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append('page', page.toString());
      params.append('limit', '50');
      if (serverFilter) params.append('serverSlug', serverFilter);
      if (toolFilter) params.append('tool', toolFilter);
      if (outcomeFilter) params.append('outcome', outcomeFilter);
      if (fromDate) params.append('from', new Date(fromDate).toISOString());
      if (toDate) params.append('to', new Date(toDate).toISOString());
      if (userFilter) params.append('userId', userFilter);

      const res = await apiClient.get<{ items: AuditItem[]; total: number }>(
        `/api/audit?${params.toString()}`
      );

      if (page === 1) {
        setAllItems(res.items || []);
      } else {
        setAllItems((prev) => [...prev, ...(res.items || [])]);
      }
      return res;
    },
    enabled: activeTab === 'tool_calls',
  });

  // 2. Fetch admin security events
  const { data: adminEventsData, isLoading: loadingAdminEvents } = useQuery<AdminEventItem[]>({
    queryKey: ['admin-events'],
    queryFn: async () => {
      const res = await apiClient.get<{ events: AdminEventItem[] }>('/api/admin/events');
      return res.events || [];
    },
    enabled: isAdmin && activeTab === 'admin_events',
  });

  const handleFilterChange = (setter: (val: string) => void, val: string) => {
    setter(val);
    setPage(1);
    setAllItems([]);
  };

  const copyRequestId = (reqId: string) => {
    navigator.clipboard.writeText(reqId);
    setCopiedId(reqId);
    addToast('Request ID copied to clipboard', 'info');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleExportCsv = () => {
    const params = new URLSearchParams();
    if (serverFilter) params.append('serverSlug', serverFilter);
    if (toolFilter) params.append('tool', toolFilter);
    if (outcomeFilter) params.append('outcome', outcomeFilter);
    if (fromDate) params.append('from', new Date(fromDate).toISOString());
    if (toDate) params.append('to', new Date(toDate).toISOString());
    if (userFilter) params.append('userId', userFilter);

    window.location.href = `/api/audit/export.csv?${params.toString()}`;
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const activeFilterCount = [
    serverFilter,
    toolFilter,
    outcomeFilter,
    userFilter,
    fromDate,
    toDate,
  ].filter(Boolean).length;

  const resetFilters = () => {
    setServerFilter('');
    setToolFilter('');
    setOutcomeFilter('');
    setUserFilter('');
    setFromDate('');
    setToDate('');
    setPage(1);
    setAllItems([]);
  };

  const auditColumns: Column<AuditItem>[] = [
    {
      key: 'ts',
      header: 'Timestamp',
      render: (item: AuditItem) => (
        <span className="text-xs text-text-secondary font-mono">
          {new Date(item.ts).toLocaleString([], {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })}
        </span>
      ),
    },
    {
      key: 'tool',
      header: 'Tool & Target Server',
      render: (item: AuditItem) => (
        <div>
          <div className="font-mono text-xs font-semibold text-text-primary">
            {item.exposedName || item.tool}
          </div>
          <div className="text-xs font-mono text-text-muted mt-0.5">{item.serverSlug}</div>
        </div>
      ),
    },
    {
      key: 'user',
      header: 'Principal / Client',
      render: (item: AuditItem) => (
        <div>
          <div className="text-xs font-medium text-text-primary">
            {item.userEmail || item.userId}
          </div>
          <div className="text-[10px] text-text-muted uppercase tracking-wider mt-0.5">
            {item.via === 'dashboard' ? 'Dashboard UI' : 'MCP Client'}
          </div>
        </div>
      ),
    },
    {
      key: 'outcome',
      header: 'Execution Outcome',
      render: (item: AuditItem) => {
        let status: 'connected' | 'unreachable' | 'disabled' = 'connected';
        if (item.outcome === 'error' || item.outcome === 'denied') status = 'unreachable';
        if (item.outcome === 'timeout') status = 'disabled';
        return <StatusBadge status={status} label={item.outcome} />;
      },
    },
    {
      key: 'durationMs',
      header: 'Latency',
      render: (item: AuditItem) => (
        <span className="text-xs text-text-secondary font-mono">
          {formatDuration(item.durationMs)}
        </span>
      ),
    },
    {
      key: 'requestId',
      header: 'Trace Request ID',
      align: 'right',
      render: (item: AuditItem) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => copyRequestId(item.requestId)}
          className="font-mono text-xs"
          title={`Click to copy request ID: ${item.requestId}`}
          leftIcon={
            copiedId === item.requestId ? (
              <CheckCircleIcon className="w-3.5 h-3.5 text-text-success" />
            ) : (
              <CopyIcon className="w-3.5 h-3.5 text-text-muted" />
            )
          }
        >
          {item.requestId.slice(0, 8)}…
        </Button>
      ),
    },
  ];

  const adminColumns: Column<AdminEventItem>[] = [
    {
      key: 'ts',
      header: 'Timestamp',
      render: (ev: AdminEventItem) => (
        <span className="text-xs text-text-secondary font-mono">
          {new Date(ev.ts).toLocaleString()}
        </span>
      ),
    },
    {
      key: 'actorEmail',
      header: 'Admin Actor',
      render: (ev: AdminEventItem) => (
        <span className="text-xs font-semibold text-text-primary">{ev.actorEmail}</span>
      ),
    },
    {
      key: 'action',
      header: 'Security Action',
      render: (ev: AdminEventItem) => (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-medium bg-brand/10 text-brand border border-brand/20">
          {ev.action}
        </span>
      ),
    },
    {
      key: 'target',
      header: 'Resource Target',
      render: (ev: AdminEventItem) => (
        <span className="text-xs font-mono text-text-secondary">
          {ev.target ? `${ev.target.type}:${ev.target.label || ev.target.id}` : '—'}
        </span>
      ),
    },
    {
      key: 'requestId',
      header: 'Request Trace',
      align: 'right',
      render: (ev: AdminEventItem) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => copyRequestId(ev.requestId)}
          className="font-mono text-xs"
          leftIcon={
            copiedId === ev.requestId ? (
              <CheckCircleIcon className="w-3.5 h-3.5 text-text-success" />
            ) : (
              <CopyIcon className="w-3.5 h-3.5 text-text-muted" />
            )
          }
        >
          {ev.requestId.slice(0, 8)}…
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Log"
        description="Tamper-evident, redacted access telemetry and administrative security event trail."
        breadcrumbs={[{ label: 'Dashboard' }, { label: 'Audit Log' }]}
        actions={
          activeTab === 'tool_calls' ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleExportCsv}
              leftIcon={<DownloadIcon className="w-4 h-4" />}
            >
              Export CSV
            </Button>
          ) : undefined
        }
      />

      {/* Admin Tabs */}
      {isAdmin && (
        <Tabs
          tabs={[
            { id: 'tool_calls', label: 'MCP Tool Executions' },
            { id: 'admin_events', label: 'Admin Security Events' },
          ]}
          activeTab={activeTab}
          onChange={(id) => setActiveTab(id as 'tool_calls' | 'admin_events')}
        />
      )}

      {/* Filters (only for tool_calls) */}
      {activeTab === 'tool_calls' && (
        <div className="space-y-3">
          {/* Mobile Filter Toggle */}
          <div className="flex sm:hidden justify-between items-center">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setMobileFiltersOpen((prev) => !prev)}
              leftIcon={<FilterIcon className="w-4 h-4" />}
            >
              {mobileFiltersOpen ? 'Hide Filters' : `Filters ${activeFilterCount > 0 ? `(${activeFilterCount})` : ''}`}
            </Button>
            {activeFilterCount > 0 && (
              <Button variant="ghost" size="sm" onClick={resetFilters}>
                Clear Filters
              </Button>
            )}
          </div>

          {/* Filter Container */}
          <div
            className={`p-4 bg-surface-subtle border border-border-default rounded-xl space-y-4 ${
              mobileFiltersOpen ? 'block' : 'hidden sm:block'
            }`}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
              <FormInput
                id="flt-srv"
                label="Filter by Server"
                placeholder="e.g. woo"
                value={serverFilter}
                onChange={(e) => handleFilterChange(setServerFilter, e.target.value)}
              />
              <FormInput
                id="flt-tool"
                label="Filter by Tool"
                placeholder="e.g. list_orders"
                value={toolFilter}
                onChange={(e) => handleFilterChange(setToolFilter, e.target.value)}
              />
              <FormSelect
                id="flt-outcome"
                label="Execution Outcome"
                value={outcomeFilter}
                onChange={(e) => handleFilterChange(setOutcomeFilter, e.target.value)}
                options={[
                  { value: '', label: 'All Outcomes' },
                  { value: 'success', label: 'Success' },
                  { value: 'error', label: 'Error' },
                  { value: 'timeout', label: 'Timeout' },
                  { value: 'unreachable', label: 'Unreachable' },
                  { value: 'denied', label: 'Denied by Policy' },
                ]}
              />
              <FormInput
                id="flt-from"
                label="From Date"
                type="date"
                value={fromDate}
                onChange={(e) => handleFilterChange(setFromDate, e.target.value)}
              />
              <FormInput
                id="flt-to"
                label="To Date"
                type="date"
                value={toDate}
                onChange={(e) => handleFilterChange(setToDate, e.target.value)}
              />
              {isAdmin && (
                <FormInput
                  id="flt-usr"
                  label="Filter by User"
                  placeholder="Principal email..."
                  value={userFilter}
                  onChange={(e) => handleFilterChange(setUserFilter, e.target.value)}
                />
              )}
            </div>

            {activeFilterCount > 0 && (
              <div className="flex justify-end pt-2 border-t border-border-default">
                <Button variant="ghost" size="sm" onClick={resetFilters}>
                  Reset All Filters ({activeFilterCount})
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Content */}
      {activeTab === 'tool_calls' ? (
        <div className="space-y-4">
          <DataTable<AuditItem>
            columns={auditColumns}
            data={allItems}
            keyExtractor={(item) => item.id || item.requestId}
            isLoading={loadingAudit && page === 1}
            emptyState={
              <EmptyState
                icon={<FileTextIcon className="w-10 h-10 text-text-muted" />}
                title="No Audit Records Found"
                description={
                  activeFilterCount > 0
                    ? 'No tool executions matched your search filters. Try broadening your criteria.'
                    : 'Tool executions across your connected MCP clients will appear here in real-time.'
                }
                action={
                  activeFilterCount > 0 ? (
                    <Button variant="secondary" size="sm" onClick={resetFilters}>
                      Clear Filters
                    </Button>
                  ) : undefined
                }
              />
            }
          />

          {auditData && allItems.length < auditData.total && (
            <div className="flex justify-center pt-2">
              <Button
                variant="secondary"
                onClick={() => setPage((p) => p + 1)}
                isLoading={fetchingAudit}
              >
                Load More Records ({allItems.length} of {auditData.total})
              </Button>
            </div>
          )}
        </div>
      ) : (
        <DataTable<AdminEventItem>
          columns={adminColumns}
          data={adminEventsData || []}
          keyExtractor={(item) => item.id || item.requestId}
          isLoading={loadingAdminEvents}
          emptyState={
            <EmptyState
              icon={<ClockIcon className="w-10 h-10 text-text-muted" />}
              title="No Administrative Events Logged"
              description="Security events such as invite issuance, policy alterations, and server mutations will appear here."
            />
          }
        />
      )}
    </div>
  );
};
