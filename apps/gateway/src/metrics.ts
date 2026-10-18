import http from 'node:http';
import client from 'prom-client';
import type { FastifyBaseLogger } from 'fastify';
import type { UpstreamManager } from './upstream/manager.js';
import type { MongoAuditSink } from './audit/sink.js';

export const register = new client.Registry();
client.collectDefaultMetrics({ register, prefix: 'conduit_' });

export const toolCallsCounter = new client.Counter({
  name: 'conduit_tool_calls_total',
  help: 'Total number of tool calls processed by Conduit Gateway',
  labelNames: ['server', 'tool', 'status'],
  registers: [register],
});

export const errorsCounter = new client.Counter({
  name: 'conduit_errors_total',
  help: 'Total number of errors encountered by Conduit Gateway',
  labelNames: ['type', 'server'],
  registers: [register],
});

export const toolLatencyHistogram = new client.Histogram({
  name: 'conduit_tool_latency_seconds',
  help: 'Latency of upstream tool invocations in seconds',
  labelNames: ['server', 'tool'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [register],
});

export const upstreamUpGauge = new client.Gauge({
  name: 'conduit_upstream_up',
  help: 'Health state of upstream servers (1 = connected, 0 = down)',
  labelNames: ['server'],
  registers: [register],
});

export const circuitBreakerStateGauge = new client.Gauge({
  name: 'conduit_circuit_breaker_state',
  help: 'Circuit breaker phase for upstream servers (1 if in state, 0 otherwise)',
  labelNames: ['server', 'state'],
  registers: [register],
});

export const auditDropsCounter = new client.Counter({
  name: 'conduit_audit_dropped_total',
  help: 'Total count of audit log records dropped',
  registers: [register],
});

export const rateLimitsExceededCounter = new client.Counter({
  name: 'conduit_rate_limit_exceeded_total',
  help: 'Total count of requests rejected due to rate limiting or concurrency caps',
  labelNames: ['route', 'key_type'],
  registers: [register],
});

export interface MetricsServerHandle {
  server: http.Server;
  close: () => Promise<void>;
}

export function startMetricsServer(
  port: number,
  host = '0.0.0.0',
  getUpstreamManager?: () => UpstreamManager | undefined,
  getAuditSink?: () => MongoAuditSink | undefined,
  logger?: FastifyBaseLogger,
): Promise<MetricsServerHandle> {
  return new Promise((resolve, reject) => {
    let lastReportedDrops = 0;

    const server = http.createServer(async (req, res) => {
      if (req.method === 'GET' && (req.url === '/metrics' || req.url === '/metrics/')) {
        try {
          const upstreamManager = getUpstreamManager?.();
          if (upstreamManager) {
            const states = upstreamManager.getAllServerStates();
            for (const st of states) {
              const slug = st.server.slug;
              const isUp = st.server.status?.state === 'connected' && st.breaker.phase !== 'open';
              upstreamUpGauge.set({ server: slug }, isUp ? 1 : 0);

              circuitBreakerStateGauge.set({ server: slug, state: 'closed' }, st.breaker.phase === 'closed' ? 1 : 0);
              circuitBreakerStateGauge.set({ server: slug, state: 'open' }, st.breaker.phase === 'open' ? 1 : 0);
              circuitBreakerStateGauge.set({ server: slug, state: 'half_open' }, st.breaker.phase === 'half_open' ? 1 : 0);
            }
          }

          const auditSink = getAuditSink?.();
          if (auditSink) {
            const totalDropped = auditSink.getDroppedCount();
            if (totalDropped > lastReportedDrops) {
              auditDropsCounter.inc(totalDropped - lastReportedDrops);
              lastReportedDrops = totalDropped;
            }
          }

          const metricsData = await register.metrics();
          res.writeHead(200, { 'Content-Type': register.contentType });
          res.end(metricsData);
        } catch (err) {
          logger?.error({ err }, 'Error collecting prometheus metrics');
          res.writeHead(500, { 'Content-Type': 'text/plain' });
          res.end('Internal Server Error\n');
        }
      } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found\n');
      }
    });

    server.listen(port, host, () => {
      logger?.info({ port, host }, 'Prometheus metrics server running on dedicated internal port');
      resolve({
        server,
        close: () =>
          new Promise<void>((resClose) => {
            server.close(() => resClose());
          }),
      });
    });

    server.on('error', (err) => {
      reject(err);
    });
  });
}
