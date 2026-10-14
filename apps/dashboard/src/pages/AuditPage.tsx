import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ui/Toast';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Table, Column } from '../components/ui/Table';
import { Input } from '../components/ui/Input';

interface AuditItem {
  id: string;
  ts: string;
  requestId: string;
  userId: string;
  userEmail?: string;
  role: string;
  via: 'session' | 'api_key';
  keyId?: string;
  serverSlug: string;
  tool: string;
  exposedName: string;
  durationMs: number;
  outcome: 'success' | 'error' | 'timeout' | 'unreachable' | 'denied';
  errorCode?: string;
  errorMessage?: string;
  argsSummary?: string;
}

interface AdminEventItem {
  id: string;
  ts: string;
  actorId: string;
  actorEmail: string;
  action: string;
  target?: { type: string; id: string; label?: string };
  details?: Record<string, any>;
  requestId: string;
}

export const AuditPage: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { addToast } = useToast();

  const [activeTab, setActiveTab] = useState<'tool_calls' | 'admin_events'>('tool_calls');

  // Filters
  const [serverFilter, setServerFilter] = useState('');
  const [toolFilter, setToolFilter] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [userFilter, setUserFilter] = useState('');

  // Pagination
  const [page, setPage] = useState(1);
  const [allItems, setAllItems] = useState<AuditItem[]>([]);

  // 1. Fetch Tool Calls Audit
  const {
    data: auditData,
    isLoading: loadingAudit,
    isFetching: fetchingAudit,
  } = useQuery({
    queryKey: ['audit', serverFilter, toolFilter, outcomeFilter, fromDate, toDate, userFilter, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (serverFilter) params.append('serverSlug', serverFilter);
      if (toolFilter) params.append('tool', toolFilter);
      if (outcomeFilter) params.append('outcome', outcomeFilter);
      if (fromDate) params.append('from', new Date(fromDate).toISOString());
      if (toDate) params.append('to', new Date(toDate).toISOString());
      if (userFilter) params.append('userId', userFilter);
      params.append('page', page.toString());
      params.append('limit', '25');

      const res = await apiClient.get<{ items: AuditItem[]; total: number }>(`/api/audit?${params.toString()}`);
      return res;
    },
    enabled: activeTab === 'tool_calls',
  });

  // Append items on page change
  React.useEffect(() => {
    if (auditData?.items) {
      if (page === 1) {
        setAllItems(auditData.items);
      } else {
        setAllItems((prev) => [...prev, ...auditData.items]);
      }
    }
  }, [auditData, page]);

  // Reset page when filters change
  const handleFilterChange = (setter: (v: string) => void, val: string) => {
    setter(val);
    setPage(1);
    setAllItems([]);
  };

  // 2. Fetch Admin Events
  const {
    data: adminEventsData,
    isLoading: loadingAdminEvents,
  } = useQuery({
    queryKey: ['admin-events'],
    queryFn: async () => {
      const res = await apiClient.get<{ events?: AdminEventItem[]; items?: AdminEventItem[] }>('/api/admin-events?limit=50');
      return res.events || res.items || [];
    },
    enabled: activeTab === 'admin_events' && isAdmin,
  });

  const copyRequestId = (reqId: string) => {
    navigator.clipboard.writeText(reqId);
    addToast(`Copied Request ID: ${reqId}`, 'info');
  };

  const handleExportCsv = () => {
    const params = new URLSearchParams();
    if (serverFilter) params.append('serverSlug', serverFilter);
    if (toolFilter) params.append('tool', toolFilter);
    if (outcomeFilter) params.append('outcome', outcomeFilter);
    if (fromDate) params.append('from', new Date(fromDate).toISOString());
    if (toDate) params.append('to', new Date(toDate).toISOString());
    if (userFilter) params.append('userId', userFilter);

    // Direct browser download
    window.location.href = `/api/audit/export.csv?${params.toString()}`;
  };

  const auditColumns: Column<AuditItem>[] = [
    {
      key: 'ts',
      header: 'Time',
      render: (item: AuditItem) => (
        <span className="text-xs text-slate-400 font-mono">
          {new Date(item.ts).toLocaleString()}
        </span>
      ),
    },
    {
      key: 'tool',
      header: 'Tool / Server',
      render: (item: AuditItem) => (
        <div>
          <div className="font-mono text-xs font-semibold text-white">{item.exposedName || item.tool}</div>
          <div className="text-[11px] text-slate-400">{item.serverSlug}</div>
        </div>
      ),
    },
    {
      key: 'user',
      header: 'Principal',
      render: (item: AuditItem) => (
        <div>
          <div className="text-xs text-slate-200">{item.userEmail || item.userId}</div>
          <div className="text-[10px] text-slate-500 uppercase">{item.via}</div>
        </div>
      ),
    },
    {
      key: 'outcome',
      header: 'Outcome',
      render: (item: AuditItem) => {
        const variant =
          item.outcome === 'success'
            ? 'success'
            : item.outcome === 'denied'
            ? 'warning'
            : 'danger';
        return <Badge variant={variant} size="sm">{item.outcome}</Badge>;
      },
    },
    {
      key: 'durationMs',
      header: 'Duration',
      render: (item: AuditItem) => (
        <span className="text-xs text-slate-400 font-mono">{item.durationMs}ms</span>
      ),
    },
    {
      key: 'requestId',
      header: 'Request ID',
      align: 'right',
      render: (item: AuditItem) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => copyRequestId(item.requestId)}
          className="font-mono text-xs text-cyan-400 hover:text-cyan-300"
          title="Click to copy request ID"
        >
          {item.requestId.slice(0, 8)}...
        </Button>
      ),
    },
  ];

  const adminColumns: Column<AdminEventItem>[] = [
    {
      key: 'ts',
      header: 'Time',
      render: (ev: AdminEventItem) => (
        <span className="text-xs text-slate-400 font-mono">{new Date(ev.ts).toLocaleString()}</span>
      ),
    },
    {
      key: 'actorEmail',
      header: 'Actor',
      render: (ev: AdminEventItem) => <span className="text-xs text-white">{ev.actorEmail}</span>,
    },
    {
      key: 'action',
      header: 'Action',
      render: (ev: AdminEventItem) => <Badge variant="info" size="sm">{ev.action}</Badge>,
    },
    {
      key: 'target',
      header: 'Target',
      render: (ev: AdminEventItem) => (
        <span className="text-xs font-mono text-slate-300">
          {ev.target ? `${ev.target.type}:${ev.target.label || ev.target.id}` : '-'}
        </span>
      ),
    },
    {
      key: 'requestId',
      header: 'Request ID',
      align: 'right',
      render: (ev: AdminEventItem) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => copyRequestId(ev.requestId)}
          className="font-mono text-xs text-cyan-400 hover:text-cyan-300"
        >
          {ev.requestId.slice(0, 8)}...
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Audit Log</h1>
          <p className="text-sm text-slate-400 mt-1">
            Tamper-evident, redacted access and execution history.
          </p>
        </div>

        {activeTab === 'tool_calls' && (
          <Button variant="outline" onClick={handleExportCsv}>
            Export Filtered CSV
          </Button>
        )}
      </div>

      {/* Tabs */}
      {isAdmin && (
        <div className="flex space-x-2 border-b border-slate-800 pb-2">
          <button
            type="button"
            onClick={() => setActiveTab('tool_calls')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'tool_calls'
                ? 'bg-slate-800 text-white font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Tool Execution Calls
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('admin_events')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'admin_events'
                ? 'bg-slate-800 text-white font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Admin Security Events
          </button>
        </div>
      )}

      {/* Filters (only for tool_calls) */}
      {activeTab === 'tool_calls' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 p-4 bg-slate-900 border border-slate-800 rounded-lg">
          <Input
            id="flt-srv"
            placeholder="Filter by server..."
            value={serverFilter}
            onChange={(e) => handleFilterChange(setServerFilter, e.target.value)}
          />
          <Input
            id="flt-tool"
            placeholder="Filter by tool..."
            value={toolFilter}
            onChange={(e) => handleFilterChange(setToolFilter, e.target.value)}
          />
          <select
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:ring-2 focus:ring-cyan-500"
            value={outcomeFilter}
            onChange={(e) => handleFilterChange(setOutcomeFilter, e.target.value)}
          >
            <option value="">All Outcomes</option>
            <option value="success">Success</option>
            <option value="error">Error</option>
            <option value="timeout">Timeout</option>
            <option value="unreachable">Unreachable</option>
            <option value="denied">Denied</option>
          </select>
          <Input
            id="flt-from"
            type="date"
            placeholder="From Date"
            value={fromDate}
            onChange={(e) => handleFilterChange(setFromDate, e.target.value)}
          />
          <Input
            id="flt-to"
            type="date"
            placeholder="To Date"
            value={toDate}
            onChange={(e) => handleFilterChange(setToDate, e.target.value)}
          />
          {isAdmin && (
            <Input
              id="flt-usr"
              placeholder="Filter by User ID..."
              value={userFilter}
              onChange={(e) => handleFilterChange(setUserFilter, e.target.value)}
            />
          )}
        </div>
      )}

      {/* Content */}
      {activeTab === 'tool_calls' ? (
        <div className="space-y-4">
          <Table<AuditItem>
            columns={auditColumns}
            data={allItems}
            keyExtractor={(item: AuditItem) => item.id || item.requestId}
            isLoading={loadingAudit && page === 1}
            emptyMessage="No tool execution logs match the current filters."
          />

          {auditData && allItems.length < auditData.total && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                onClick={() => setPage((p) => p + 1)}
                isLoading={fetchingAudit}
              >
                Load More ({allItems.length} of {auditData.total})
              </Button>
            </div>
          )}
        </div>
      ) : (
        <Table<AdminEventItem>
          columns={adminColumns}
          data={adminEventsData || []}
          keyExtractor={(item: AdminEventItem) => item.id || item.requestId}
          isLoading={loadingAdminEvents}
          emptyMessage="No admin events recorded yet."
        />
      )}
    </div>
  );
};
