import { describe, it, expect, afterAll } from 'vitest';
import {
  startMetricsServer,
  toolCallsCounter,
  errorsCounter,
  toolLatencyHistogram,
  upstreamUpGauge,
  circuitBreakerStateGauge,
  auditDropsCounter,
  type MetricsServerHandle,
} from '../src/metrics.js';

describe('Prometheus Metrics Server', () => {
  let handle: MetricsServerHandle | null = null;
  const testPort = 19090;

  afterAll(async () => {
    if (handle) {
      await handle.close();
    }
  });

  it('starts dedicated metrics server and serves prometheus metrics', async () => {
    // Record sample metrics
    toolCallsCounter.inc({ server: 'woo', tool: 'list_products', status: 'success' });
    errorsCounter.inc({ type: 'timeout', server: 'woo' });
    toolLatencyHistogram.observe({ server: 'woo', tool: 'list_products' }, 0.125);
    upstreamUpGauge.set({ server: 'woo' }, 1);
    circuitBreakerStateGauge.set({ server: 'woo', state: 'closed' }, 1);
    auditDropsCounter.inc(2);

    handle = await startMetricsServer(testPort, '127.0.0.1');

    const res = await fetch(`http://127.0.0.1:${testPort}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');

    const body = await res.text();
    expect(body).toContain('conduit_tool_calls_total');
    expect(body).toContain('server="woo",tool="list_products",status="success"');
    expect(body).toContain('conduit_errors_total');
    expect(body).toContain('type="timeout",server="woo"');
    expect(body).toContain('conduit_tool_latency_seconds');
    expect(body).toContain('conduit_upstream_up');
    expect(body).toContain('conduit_circuit_breaker_state');
    expect(body).toContain('conduit_audit_dropped_total');
  });

  it('returns 404 on non-metrics paths', async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api`);
    expect(res.status).toBe(404);
  });
});
