import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import type { FetchLike } from '@modelcontextprotocol/sdk/shared/transport.js';
import { isPrivateOrRestrictedIp, getAllowedHosts } from './url-policy.js';

export interface SecureFetchOptions {
  allowedHosts?: Set<string>;
  timeoutMs?: number;
  maxBodyBytes?: number;
}

/**
 * Creates a custom DNS lookup callback that prevents DNS rebinding to private IPs
 */
export function createSecureLookup(allowedHostsGetter: () => Set<string>) {
  return function secureLookup(
    hostname: string,
    options: dns.LookupOptions,
    callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void,
  ) {
    const allowedHosts = allowedHostsGetter();
    const isAllowlisted = allowedHosts.has(hostname.toLowerCase());

    dns.lookup(hostname, options, (err, address, family) => {
      if (err) {
        return callback(err, address, family);
      }

      if (!isAllowlisted) {
        if (Array.isArray(address)) {
          for (const item of address) {
            if (isPrivateOrRestrictedIp(item.address)) {
              const ssrfErr = new Error(`SSRF blocked: ${hostname} resolved to private IP ${item.address}`);
              (ssrfErr as NodeJS.ErrnoException).code = 'ERR_SSRF_BLOCKED';
              return callback(ssrfErr, address, family);
            }
          }
        } else if (typeof address === 'string') {
          if (isPrivateOrRestrictedIp(address)) {
            const ssrfErr = new Error(`SSRF blocked: ${hostname} resolved to private IP ${address}`);
            (ssrfErr as NodeJS.ErrnoException).code = 'ERR_SSRF_BLOCKED';
            return callback(ssrfErr, address, family);
          }
        }
      }

      return callback(null, address, family);
    });
  };
}

/**
 * Returns a FetchLike function that enforces zero redirects, custom dialer lookup,
 * timeout, and response body size limits.
 */
export function createSecureFetch(options: SecureFetchOptions = {}): FetchLike {
  const getHosts = () => options.allowedHosts ?? getAllowedHosts();
  const timeoutMs = options.timeoutMs ?? 15000;
  const maxBodyBytes = options.maxBodyBytes ?? 10 * 1024 * 1024; // 10 MB

  const secureLookup = createSecureLookup(getHosts);

  const httpAgent = new http.Agent({
    keepAlive: true,
    lookup: secureLookup as unknown as typeof dns.lookup,
  });

  const httpsAgent = new https.Agent({
    keepAlive: true,
    lookup: secureLookup as unknown as typeof dns.lookup,
  });

  return async function secureFetch(
    urlInput: string | URL,
    init: RequestInit = {},
  ): Promise<Response> {
    const parsed = typeof urlInput === 'string' ? new URL(urlInput) : urlInput;
    const isHttps = parsed.protocol === 'https:';
    const isHttp = parsed.protocol === 'http:';

    if (!isHttp && !isHttps) {
      throw new Error(`Unsupported protocol: ${parsed.protocol}`);
    }

    const hostname = parsed.hostname.toLowerCase();
    const isAllowlisted = getHosts().has(hostname);

    // Initial check on literal host
    if (!isAllowlisted && (hostname === 'localhost' || isPrivateOrRestrictedIp(hostname))) {
      throw new Error(`SSRF blocked: destination host ${hostname} is private or restricted`);
    }

    return new Promise<Response>((resolve, reject) => {
      const headersRecord: Record<string, string> = {};
      if (init.headers) {
        const h = new Headers(init.headers);
        h.forEach((val, key) => {
          headersRecord[key] = val;
        });
      }

      const method = (init.method || 'GET').toUpperCase();
      const port = parsed.port ? parseInt(parsed.port, 10) : isHttps ? 443 : 80;

      const reqOptions: http.RequestOptions = {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port,
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers: headersRecord,
        agent: isHttps ? httpsAgent : httpAgent,
        timeout: timeoutMs,
      };

      const requestFn = isHttps ? https.request : http.request;

      const req = requestFn(reqOptions, (res) => {
        // Enforce NO REDIRECTS (zero redirects policy)
        if (
          res.statusCode &&
          [301, 302, 303, 307, 308].includes(res.statusCode)
        ) {
          req.destroy();
          return reject(
            new Error(
              `SSRF blocked: redirects are strictly prohibited (status ${res.statusCode} to ${res.headers.location})`,
            ),
          );
        }

        const chunks: Buffer[] = [];
        let totalBytes = 0;

        res.on('data', (chunk: Buffer) => {
          totalBytes += chunk.length;
          if (totalBytes > maxBodyBytes) {
            req.destroy();
            return reject(new Error(`Response body exceeded maximum allowed limit of ${maxBodyBytes} bytes`));
          }
          chunks.push(chunk);
        });

        res.on('end', () => {
          const bodyBuffer = Buffer.concat(chunks);
          const responseHeaders = new Headers();
          for (const [key, val] of Object.entries(res.headers)) {
            if (val !== undefined) {
              if (Array.isArray(val)) {
                for (const item of val) {
                  responseHeaders.append(key, item);
                }
              } else {
                responseHeaders.set(key, val);
              }
            }
          }

          const statusCode = res.statusCode || 200;
          const isNullBody = [101, 204, 205, 304].includes(statusCode);

          const response = new Response(isNullBody ? null : bodyBuffer, {
            status: statusCode,
            statusText: res.statusMessage || '',
            headers: responseHeaders,
          });

          resolve(response);
        });
      });

      req.on('timeout', () => {
        req.destroy(new Error(`Upstream request timed out after ${timeoutMs}ms`));
      });

      req.on('error', (err) => {
        reject(err);
      });

      if (init.body) {
        if (typeof init.body === 'string' || Buffer.isBuffer(init.body)) {
          req.write(init.body);
        } else if (init.body instanceof Uint8Array) {
          req.write(Buffer.from(init.body));
        }
      }

      req.end();
    });
  };
}
