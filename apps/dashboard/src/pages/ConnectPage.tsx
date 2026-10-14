import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { useToast } from '../components/ui/Toast';
import { Button } from '../components/ui/Button';

interface PublicConfig {
  publicGatewayUrl: string;
  publicDashboardUrl: string;
  version: string;
}

export const ConnectPage: React.FC = () => {
  const { addToast } = useToast();

  const { data: configData, isLoading } = useQuery({
    queryKey: ['public-config'],
    queryFn: async () => {
      return apiClient.get<PublicConfig>('/api/config');
    },
  });

  const gatewayUrl = configData?.publicGatewayUrl || `${window.location.protocol}//gateway.${window.location.hostname}:80/mcp`;

  const copySnippet = (text: string, clientName: string) => {
    navigator.clipboard.writeText(text);
    addToast(`Copied ${clientName} configuration to clipboard!`, 'info');
  };

  // Verified as of October 2024 / 2025 client standards
  const cursorConfig = JSON.stringify(
    {
      mcpServers: {
        conduit: {
          url: gatewayUrl,
          headers: {
            Authorization: 'Bearer <YOUR_API_KEY>',
          },
        },
      },
    },
    null,
    2
  );

  const claudeCodeCli = `claude mcp add conduit ${gatewayUrl} --header "Authorization: Bearer <YOUR_API_KEY>"`;

  const claudeDesktopConfig = JSON.stringify(
    {
      mcpServers: {
        conduit: {
          url: gatewayUrl,
          headers: {
            Authorization: 'Bearer <YOUR_API_KEY>',
          },
        },
      },
    },
    null,
    2
  );

  const mcpInspectorCmd = `npx @modelcontextprotocol/inspector --server-url ${gatewayUrl} --headers "Authorization=Bearer <YOUR_API_KEY>"`;

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">Connect MCP Clients</h1>
        <p className="text-sm text-slate-400 mt-1">
          Connect your AI developer tools to the Conduit unified MCP Gateway.
        </p>
      </div>

      <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Gateway MCP Endpoint</div>
        <div className="flex items-center space-x-2">
          <input
            type="text"
            readOnly
            value={isLoading ? 'Loading gateway URL...' : gatewayUrl}
            className="flex-1 bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-cyan-300 select-all"
          />
          <Button size="sm" onClick={() => copySnippet(gatewayUrl, 'Endpoint URL')}>
            Copy
          </Button>
        </div>
      </div>

      {/* Cursor Setup */}
      <div className="space-y-3 p-5 rounded-xl border border-slate-800 bg-slate-900/50">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">Cursor</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Add to your project's <code className="text-slate-300">.cursor/mcp.json</code> or Settings &gt; Features &gt; MCP.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => copySnippet(cursorConfig, 'Cursor')}>
            Copy JSON
          </Button>
        </div>
        <pre className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs font-mono text-slate-300 overflow-x-auto">
          {cursorConfig}
        </pre>
      </div>

      {/* Claude Code Setup */}
      <div className="space-y-3 p-5 rounded-xl border border-slate-800 bg-slate-900/50">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">Claude Code</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Run this command in your terminal where Claude Code is active.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => copySnippet(claudeCodeCli, 'Claude Code CLI')}>
            Copy Command
          </Button>
        </div>
        <pre className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs font-mono text-cyan-400 overflow-x-auto">
          {claudeCodeCli}
        </pre>
      </div>

      {/* Claude Desktop */}
      <div className="space-y-3 p-5 rounded-xl border border-slate-800 bg-slate-900/50">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">Claude Desktop</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Add to <code className="text-slate-300">claude_desktop_config.json</code> under <code className="text-slate-300">mcpServers</code>.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => copySnippet(claudeDesktopConfig, 'Claude Desktop')}>
            Copy JSON
          </Button>
        </div>
        <pre className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs font-mono text-slate-300 overflow-x-auto">
          {claudeDesktopConfig}
        </pre>
      </div>

      {/* MCP Inspector */}
      <div className="space-y-3 p-5 rounded-xl border border-slate-800 bg-slate-900/50">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">MCP Inspector</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Launch official testing UI via npx.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => copySnippet(mcpInspectorCmd, 'MCP Inspector')}>
            Copy Command
          </Button>
        </div>
        <pre className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs font-mono text-cyan-400 overflow-x-auto">
          {mcpInspectorCmd}
        </pre>
      </div>
    </div>
  );
};
