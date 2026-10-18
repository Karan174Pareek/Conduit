import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import {
  FullSsrfUrlPolicy,
  parseIPv4,
  isPrivateOrRestrictedIp,
} from '../src/registry/url-policy.js';
import { createSecureFetch } from '../src/registry/secure-fetch.js';

describe('SSRF Protection Suite (§5)', () => {
  describe('IP parser & range detection', () => {
    it('correctly identifies IPv4 private and restricted ranges in various notations', () => {
      // Standard loopback
      expect(isPrivateOrRestrictedIp('127.0.0.1')).toBe(true);
      expect(isPrivateOrRestrictedIp('127.1.2.3')).toBe(true);

      // Decimal representation of 127.0.0.1 (2130706433)
      expect(parseIPv4('2130706433')).toBe(2130706433n);
      expect(isPrivateOrRestrictedIp('2130706433')).toBe(true);

      // Octal notation: 0177.0.0.1
      expect(parseIPv4('0177.0.0.1')).toBe(2130706433n);
      expect(isPrivateOrRestrictedIp('0177.0.0.1')).toBe(true);

      // Cloud metadata (169.254.169.254) and link-local
      expect(isPrivateOrRestrictedIp('169.254.169.254')).toBe(true);
      expect(isPrivateOrRestrictedIp('169.254.0.1')).toBe(true);

      // Private RFC 1918
      expect(isPrivateOrRestrictedIp('10.0.0.1')).toBe(true);
      expect(isPrivateOrRestrictedIp('10.254.1.2')).toBe(true);
      expect(isPrivateOrRestrictedIp('172.16.0.1')).toBe(true);
      expect(isPrivateOrRestrictedIp('172.31.255.255')).toBe(true);
      expect(isPrivateOrRestrictedIp('192.168.1.1')).toBe(true);

      // CGNAT 100.64.0.0/10
      expect(isPrivateOrRestrictedIp('100.64.0.1')).toBe(true);
      expect(isPrivateOrRestrictedIp('100.127.255.254')).toBe(true);

      // Multicast & Broadcast
      expect(isPrivateOrRestrictedIp('224.0.0.1')).toBe(true);
      expect(isPrivateOrRestrictedIp('255.255.255.255')).toBe(true);
      expect(isPrivateOrRestrictedIp('0.0.0.0')).toBe(true);

      // Public routable IPs should NOT be restricted
      expect(isPrivateOrRestrictedIp('93.184.216.34')).toBe(false); // example.com
      expect(isPrivateOrRestrictedIp('8.8.8.8')).toBe(false);
      expect(isPrivateOrRestrictedIp('1.1.1.1')).toBe(false);
    });

    it('correctly identifies IPv6 loopback, link-local, ULA, and IPv4-mapped forms', () => {
      // Loopback
      expect(isPrivateOrRestrictedIp('::1')).toBe(true);
      expect(isPrivateOrRestrictedIp('[::1]')).toBe(true);

      // Link-local (fe80::)
      expect(isPrivateOrRestrictedIp('fe80::1')).toBe(true);

      // ULA (fc00:: / fd00::)
      expect(isPrivateOrRestrictedIp('fd00::1')).toBe(true);
      expect(isPrivateOrRestrictedIp('fc00:1:2:3::4')).toBe(true);

      // IPv4-mapped IPv6 pointing to private addresses
      expect(isPrivateOrRestrictedIp('::ffff:127.0.0.1')).toBe(true);
      expect(isPrivateOrRestrictedIp('[::ffff:127.0.0.1]')).toBe(true);
      expect(isPrivateOrRestrictedIp('::ffff:169.254.169.254')).toBe(true);
      expect(isPrivateOrRestrictedIp('::ffff:10.0.0.1')).toBe(true);

      // IPv4-mapped IPv6 pointing to public IP
      expect(isPrivateOrRestrictedIp('::ffff:93.184.216.34')).toBe(false);
    });
  });

  describe('Table-driven URL policy validation', () => {
    const allowedHosts = new Set(['woo-mcp.store-default.svc.cluster.local', 'notes-mcp.conduit-system.svc.cluster.local']);
    const policy = new FullSsrfUrlPolicy(allowedHosts);

    const testCases: { name: string; url: string; expectValid: boolean; reasonSubstring?: string }[] = [
      { name: '127.0.0.1 loopback', url: 'http://127.0.0.1/mcp', expectValid: false, reasonSubstring: 'prohibited private/restricted range' },
      { name: 'localhost loopback', url: 'http://localhost:3000/mcp', expectValid: false, reasonSubstring: 'localhost is prohibited' },
      { name: '169.254.169.254 AWS/GCP metadata IP', url: 'http://169.254.169.254/latest/meta-data/', expectValid: false, reasonSubstring: 'prohibited private/restricted range' },
      { name: '10.x private network IP', url: 'http://10.0.0.5:80/mcp', expectValid: false, reasonSubstring: 'prohibited private/restricted range' },
      { name: '172.16.x private network IP', url: 'http://172.16.0.5:80/mcp', expectValid: false, reasonSubstring: 'prohibited private/restricted range' },
      { name: '192.168.x private network IP', url: 'http://192.168.1.100/mcp', expectValid: false, reasonSubstring: 'prohibited private/restricted range' },
      { name: '[::1] IPv6 loopback', url: 'http://[::1]:80/mcp', expectValid: false, reasonSubstring: 'prohibited private/restricted range' },
      { name: 'Mapped IPv6 ::ffff:127.0.0.1', url: 'http://[::ffff:127.0.0.1]:80/mcp', expectValid: false, reasonSubstring: 'prohibited private/restricted range' },
      { name: 'Decimal IP (2130706433 = 127.0.0.1)', url: 'http://2130706433/mcp', expectValid: false, reasonSubstring: 'prohibited private/restricted range' },
      { name: 'Octal IP (0177.0.0.1 = 127.0.0.1)', url: 'http://0177.0.0.1/mcp', expectValid: false, reasonSubstring: 'prohibited private/restricted range' },
      { name: 'Embedded credentials prohibited', url: 'http://admin:secret@example.com/mcp', expectValid: false, reasonSubstring: 'Embedded credentials' },
      { name: 'Non-standard port for external host prohibited', url: 'http://example.com:8080/mcp', expectValid: false, reasonSubstring: 'Port 8080 is not permitted' },
      { name: 'Invalid protocol prohibited', url: 'gopher://127.0.0.1:70/', expectValid: false, reasonSubstring: 'scheme must be http or https' },
      { name: 'Allowlisted in-cluster host with custom port', url: 'http://notes-mcp.conduit-system.svc.cluster.local:3000/mcp', expectValid: true },
      { name: 'Allowlisted in-cluster woo host', url: 'http://woo-mcp.store-default.svc.cluster.local:3100/mcp', expectValid: true },
    ];

    for (const tc of testCases) {
      it(`enforces policy for: ${tc.name}`, async () => {
        const res = await policy.validate(tc.url);
        expect(res.valid).toBe(tc.expectValid);
        if (!tc.expectValid && tc.reasonSubstring) {
          expect(res.reason).toContain(tc.reasonSubstring);
        }
      });
    }
  });

  describe('Dialer SSRF prevention & redirect blocking', () => {
    let mockServer: http.Server;
    let serverPort: number;

    beforeAll(async () => {
      mockServer = http.createServer((req, res) => {
        if (req.url === '/redirect-to-private') {
          // Attempting redirect to cloud metadata service
          res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data/' });
          res.end();
        } else if (req.url === '/ok') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok' }));
        }
      });

      await new Promise<void>((resolve) => {
        mockServer.listen(0, '127.0.0.1', () => {
          const addr = mockServer.address() as { port: number };
          serverPort = addr.port;
          resolve();
        });
      });
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => mockServer.close(() => resolve()));
    });

    it('strictly prohibits HTTP redirects to prevent SSRF redirect-pivot', async () => {
      // Even if local mock server is allowlisted as a host, following redirects is forbidden
      const allowedHosts = new Set(['127.0.0.1']);
      const secureFetch = createSecureFetch({ allowedHosts });

      await expect(
        secureFetch(`http://127.0.0.1:${serverPort}/redirect-to-private`),
      ).rejects.toThrow(/redirects are strictly prohibited/);
    });

    it('blocks connection to private IPs when host is not in allowed hosts', async () => {
      const secureFetch = createSecureFetch({ allowedHosts: new Set() });

      await expect(
        secureFetch(`http://127.0.0.1:${serverPort}/ok`),
      ).rejects.toThrow(/SSRF blocked/);
    });
  });
});
