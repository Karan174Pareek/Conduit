import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpServerDocument } from '../db/types.js';

export type CircuitBreakerPhase = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerState {
  phase: CircuitBreakerPhase;
  consecutiveFailures: number;
  openedAt: number | null;
  currentBackoffMs: number;
  halfOpenProbeInFlight: boolean;
}

export interface UpstreamServerState {
  server: McpServerDocument;
  client: Client | null;
  transport: StreamableHTTPClientTransport | null;
  decryptedCredential: string;
  breaker: CircuitBreakerState;
  inFlightCalls: number;
  lastHealthCheckAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: {
    code: string;
    message: string;
    at: Date;
  } | null;
}

export interface InvokeToolOptions {
  deadlineMs?: number;
  signal?: AbortSignal;
}

export interface ToolInvocationResult {
  content: Array<{ type: string; text?: string; [key: string]: unknown }>;
  isError?: boolean;
}

export interface UpstreamMetrics {
  totalCalls: Record<string, number>;
  failuresByOutcome: Record<string, Record<string, number>>;
  bulkheadRejections: Record<string, number>;
}
