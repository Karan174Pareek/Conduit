import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../api/client';
import { useToast } from '../components/ui/Toast';
import { Button } from '../components/ui/Button';
import { PageHeader } from '../components/ui/PageHeader';
import { Tabs } from '../components/ui/Tabs';
import { CodeBlock } from '../components/ui/CodeBlock';
import {
  TerminalIcon,
  CopyIcon,
  CheckCircleIcon,
} from '../components/ui/Icons';

interface PublicConfig {
  publicGatewayUrl: string;
  publicDashboardUrl: string;
  version: string;
}

export const ConnectPage: React.FC = () => {
  const { addToast } = useToast();
  const [activeTab, setActiveTab] = useState('cursor');
  const [copiedUrl, setCopiedUrl] = useState(false);

  const { data: configData, isLoading } = useQuery<PublicConfig>({
    queryKey: ['public-config'],
    queryFn: async () => {
      return apiClient.get<PublicConfig>('/api/config');
    },
  });

  const gatewayUrl =
    configData?.publicGatewayUrl ||
    `${window.location.protocol}//gateway.${window.location.hostname}:80/mcp`;

  const copyEndpoint = () => {
    navigator.clipboard.writeText(gatewayUrl);
    setCopiedUrl(true);
    addToast('Gateway endpoint URL copied to clipboard', 'info');
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  // Exact verified snippets as per standard MCP specs
  const cursorConfig = JSON.stringify(
    {
      mcpServers: {
        conduit: {
          url: gatewayUrl,
          headers: {
            Authorization: 'Bearer <YOUR_CONDUIT_API_KEY>',
          },
        },
      },
    },
    null,
    2
  );

  const claudeCodeCli = `claude mcp add conduit ${gatewayUrl} --header "Authorization: Bearer <YOUR_CONDUIT_API_KEY>"`;

  const claudeDesktopConfig = JSON.stringify(
    {
      mcpServers: {
        conduit: {
          url: gatewayUrl,
          headers: {
            Authorization: 'Bearer <YOUR_CONDUIT_API_KEY>',
          },
        },
      },
    },
    null,
    2
  );

  const mcpInspectorCmd = `npx @modelcontextprotocol/inspector --server-url ${gatewayUrl} --headers "Authorization=Bearer <YOUR_CONDUIT_API_KEY>"`;

  return (
    <div className="space-y-8 max-w-4xl">
      <PageHeader
        title="Connect MCP Clients"
        description="Wire your development environments (Cursor, Claude Code, MCP Inspector) to Conduit's unified security gateway."
        breadcrumbs={[{ label: 'Dashboard' }, { label: 'Connect Client' }]}
      />

      {/* Gateway Endpoint Banner */}
      <div className="p-5 rounded-xl bg-surface-subtle border border-border-default space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TerminalIcon className="w-4 h-4 text-brand" />
            <span className="text-xs font-bold uppercase tracking-wider text-text-secondary">
              Gateway MCP SSE Endpoint
            </span>
          </div>
          <span className="text-xs font-mono text-text-muted">Transport: HTTP SSE</span>
        </div>

        <div className="flex items-center gap-2">
          <input
            id="gateway-url-display"
            aria-label="Gateway MCP SSE Endpoint URL"
            type="text"
            readOnly
            value={isLoading ? 'Loading gateway URL...' : gatewayUrl}
            className="flex-1 bg-surface-panel border border-border-default rounded-lg px-3 py-2 text-xs font-mono text-brand select-all focus:outline-none focus:ring-2 focus:ring-brand"
          />
          <Button
            variant={copiedUrl ? 'secondary' : 'primary'}
            size="sm"
            onClick={copyEndpoint}
            leftIcon={
              copiedUrl ? (
                <CheckCircleIcon className="w-4 h-4 text-text-success" />
              ) : (
                <CopyIcon className="w-4 h-4" />
              )
            }
          >
            {copiedUrl ? 'Copied!' : 'Copy URL'}
          </Button>
        </div>
        <p className="text-xs text-text-muted leading-relaxed">
          All client requests sent to this endpoint are authenticated, rate-limited, and audited.
        </p>
      </div>

      {/* Client Configuration Tabs */}
      <div className="space-y-6">
        <Tabs
          tabs={[
            { id: 'cursor', label: 'Cursor IDE' },
            { id: 'claude-code', label: 'Claude Code CLI' },
            { id: 'claude-desktop', label: 'Claude Desktop' },
            { id: 'inspector', label: 'MCP Inspector' },
          ]}
          activeTab={activeTab}
          onChange={setActiveTab}
        />

        {/* Tab 1: Cursor */}
        {activeTab === 'cursor' && (
          <div className="p-6 rounded-xl border border-border-default bg-surface-subtle space-y-6">
            <div>
              <h2 className="text-base font-bold text-text-primary">Cursor Setup Guide</h2>
              <p className="text-xs text-text-secondary mt-1">
                Configure Cursor to discover and invoke tools through Conduit's access control plane.
              </p>
            </div>

            <ol className="space-y-4 text-xs text-text-secondary">
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-brand/10 text-brand font-bold flex items-center justify-center border border-brand/20">
                  1
                </span>
                <div className="space-y-1 pt-0.5">
                  <div className="font-semibold text-text-primary">Obtain a Personal API Key</div>
                  <p>
                    Navigate to the <span className="font-semibold text-brand">API Keys</span> page and
                    generate a new key. Replace <code className="font-mono text-text-primary">&lt;YOUR_CONDUIT_API_KEY&gt;</code> with your secret token.
                  </p>
                </div>
              </li>

              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-brand/10 text-brand font-bold flex items-center justify-center border border-brand/20">
                  2
                </span>
                <div className="space-y-2 pt-0.5 w-full">
                  <div className="font-semibold text-text-primary">Configure Project or Global MCP Settings</div>
                  <p>
                    Add the following snippet to your repository root at <code className="font-mono text-text-primary">.cursor/mcp.json</code> or globally in Cursor Settings &gt; Features &gt; MCP:
                  </p>
                  <CodeBlock code={cursorConfig} language="json" />
                </div>
              </li>

              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-brand/10 text-brand font-bold flex items-center justify-center border border-brand/20">
                  3
                </span>
                <div className="space-y-1 pt-0.5">
                  <div className="font-semibold text-text-primary">Verify Discovery</div>
                  <p>
                    Open Cursor's composer, and verify green indicators appear next to upstream MCP tools (e.g. <code className="font-mono text-text-primary">woo_list_products</code>).
                  </p>
                </div>
              </li>
            </ol>
          </div>
        )}

        {/* Tab 2: Claude Code CLI */}
        {activeTab === 'claude-code' && (
          <div className="p-6 rounded-xl border border-border-default bg-surface-subtle space-y-6">
            <div>
              <h2 className="text-base font-bold text-text-primary">Claude Code CLI Configuration</h2>
              <p className="text-xs text-text-secondary mt-1">
                Attach Conduit tools to your interactive terminal assistant sessions.
              </p>
            </div>

            <ol className="space-y-4 text-xs text-text-secondary">
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-brand/10 text-brand font-bold flex items-center justify-center border border-brand/20">
                  1
                </span>
                <div className="space-y-1 pt-0.5">
                  <div className="font-semibold text-text-primary">Generate API Key</div>
                  <p>Ensure you have an active Conduit API key with Member or Admin permissions.</p>
                </div>
              </li>

              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-brand/10 text-brand font-bold flex items-center justify-center border border-brand/20">
                  2
                </span>
                <div className="space-y-2 pt-0.5 w-full">
                  <div className="font-semibold text-text-primary">Execute Registration Command</div>
                  <p>In your terminal where Claude Code is initialized, run:</p>
                  <CodeBlock code={claudeCodeCli} language="bash" />
                </div>
              </li>

              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-brand/10 text-brand font-bold flex items-center justify-center border border-brand/20">
                  3
                </span>
                <div className="space-y-1 pt-0.5">
                  <div className="font-semibold text-text-primary">Confirm In Claude Code</div>
                  <p>Run <code className="font-mono text-text-primary">/mcp</code> inside Claude Code to review connected Conduit tools.</p>
                </div>
              </li>
            </ol>
          </div>
        )}

        {/* Tab 3: Claude Desktop */}
        {activeTab === 'claude-desktop' && (
          <div className="p-6 rounded-xl border border-border-default bg-surface-subtle space-y-6">
            <div>
              <h2 className="text-base font-bold text-text-primary">Claude Desktop Configuration</h2>
              <p className="text-xs text-text-secondary mt-1">
                Integrate Conduit into your Anthropic Claude Desktop application.
              </p>
            </div>

            <ol className="space-y-4 text-xs text-text-secondary">
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-brand/10 text-brand font-bold flex items-center justify-center border border-brand/20">
                  1
                </span>
                <div className="space-y-1 pt-0.5">
                  <div className="font-semibold text-text-primary">Locate Configuration File</div>
                  <p>
                    Open your Claude Desktop config file (<code className="font-mono text-text-primary">%APPDATA%\Claude\claude_desktop_config.json</code> on Windows or <code className="font-mono text-text-primary">~/Library/Application Support/Claude/claude_desktop_config.json</code> on macOS).
                  </p>
                </div>
              </li>

              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-brand/10 text-brand font-bold flex items-center justify-center border border-brand/20">
                  2
                </span>
                <div className="space-y-2 pt-0.5 w-full">
                  <div className="font-semibold text-text-primary">Insert Server Definition</div>
                  <p>Merge the following block into the root object:</p>
                  <CodeBlock code={claudeDesktopConfig} language="json" />
                </div>
              </li>

              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-brand/10 text-brand font-bold flex items-center justify-center border border-brand/20">
                  3
                </span>
                <div className="space-y-1 pt-0.5">
                  <div className="font-semibold text-text-primary">Restart Application</div>
                  <p>Completely restart Claude Desktop to initialize the SSE connection.</p>
                </div>
              </li>
            </ol>
          </div>
        )}

        {/* Tab 4: MCP Inspector */}
        {activeTab === 'inspector' && (
          <div className="p-6 rounded-xl border border-border-default bg-surface-subtle space-y-6">
            <div>
              <h2 className="text-base font-bold text-text-primary">Official MCP Inspector Diagnostics</h2>
              <p className="text-xs text-text-secondary mt-1">
                Inspect raw tool protocols, schemas, and live test executions using the official testing tool.
              </p>
            </div>

            <ol className="space-y-4 text-xs text-text-secondary">
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-brand/10 text-brand font-bold flex items-center justify-center border border-brand/20">
                  1
                </span>
                <div className="space-y-1 pt-0.5">
                  <div className="font-semibold text-text-primary">Launch Via NPX</div>
                  <p>Execute the official inspector command in your terminal:</p>
                  <CodeBlock code={mcpInspectorCmd} language="bash" />
                </div>
              </li>

              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-brand/10 text-brand font-bold flex items-center justify-center border border-brand/20">
                  2
                </span>
                <div className="space-y-1 pt-0.5">
                  <div className="font-semibold text-text-primary">Inspect Catalog & Invocation</div>
                  <p>
                    The browser will open to <code className="font-mono text-text-primary">http://localhost:5173</code> where you can manually invoke tools and review response envelopes.
                  </p>
                </div>
              </li>
            </ol>
          </div>
        )}
      </div>
    </div>
  );
};
