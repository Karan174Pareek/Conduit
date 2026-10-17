import type { FastifyRequest, FastifyReply } from 'fastify';
import type { RateLimiter } from '../router/tool-router.js';
import { rateLimitsExceededCounter } from '../metrics.js';

export interface TokenBucketOptions {
  capacity?: number;
  refillRatePerSecond?: number;
}

interface BucketState {
  tokens: number;
  lastRefill: number;
}

/**
 * Token bucket rate limiter per user/key for tools and chat
 */
export class TokenBucketRateLimiter implements RateLimiter {
  private readonly buckets = new Map<string, BucketState>();
  private readonly capacity: number;
  private readonly refillRate: number; // tokens per millisecond

  constructor(options: TokenBucketOptions = {}) {
    this.capacity = options.capacity ?? 60;
    const ratePerSec = options.refillRatePerSecond ?? 1;
    this.refillRate = ratePerSec / 1000;
  }

  async consume(key: string, tokensRequested = 1): Promise<{ allowed: boolean; retryAfterSeconds?: number }> {
    const now = Date.now();
    let state = this.buckets.get(key);

    if (!state) {
      state = { tokens: this.capacity, lastRefill: now };
      this.buckets.set(key, state);
    } else {
      const elapsed = now - state.lastRefill;
      state.tokens = Math.min(this.capacity, state.tokens + elapsed * this.refillRate);
      state.lastRefill = now;
    }

    if (state.tokens >= tokensRequested) {
      state.tokens -= tokensRequested;
      return { allowed: true };
    }

    const needed = tokensRequested - state.tokens;
    const retryAfterMs = needed / this.refillRate;
    const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));

    rateLimitsExceededCounter.inc({ route: 'tool_call', key_type: 'user' });

    return {
      allowed: false,
      retryAfterSeconds,
    };
  }
}

/**
 * Concurrency limiter per user/key
 */
export class ConcurrencyLimiter {
  private readonly activeCounts = new Map<string, number>();

  constructor(private readonly maxConcurrent: number = 5) {}

  tryAcquire(key: string): boolean {
    const current = this.activeCounts.get(key) ?? 0;
    if (current >= this.maxConcurrent) {
      rateLimitsExceededCounter.inc({ route: 'concurrency', key_type: 'user' });
      return false;
    }
    this.activeCounts.set(key, current + 1);
    return true;
  }

  release(key: string): void {
    const current = this.activeCounts.get(key) ?? 0;
    if (current <= 1) {
      this.activeCounts.delete(key);
    } else {
      this.activeCounts.set(key, current - 1);
    }
  }
}

interface IpThrottleState {
  count: number;
  resetAt: number;
}

/**
 * Fastify preHandler hook for IP-based throttling on auth routes
 */
export function createIpRateLimiter(options: { max: number; windowMs: number; routeName: string }) {
  const ipStore = new Map<string, IpThrottleState>();

  return async function ipRateLimitHook(request: FastifyRequest, reply: FastifyReply) {
    const ip = request.ip || request.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || '127.0.0.1';
    const now = Date.now();

    let record = ipStore.get(ip);
    if (!record || now > record.resetAt) {
      record = { count: 0, resetAt: now + options.windowMs };
      ipStore.set(ip, record);
    }

    record.count += 1;

    if (record.count > options.max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
      rateLimitsExceededCounter.inc({ route: options.routeName, key_type: 'ip' });

      reply.header('Retry-After', String(retryAfterSeconds));
      return reply.status(429).send({
        error: 'rate_limited',
        message: `Too many requests on ${options.routeName}. Please retry after ${retryAfterSeconds} seconds.`,
        retryAfter: retryAfterSeconds,
      });
    }
  };
}
