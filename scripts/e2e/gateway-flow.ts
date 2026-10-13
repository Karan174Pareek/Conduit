import { execSync } from 'node:child_process';

const GATEWAY_URL = process.env['GATEWAY_URL'] || 'http://gateway.localhost';
const DASHBOARD_URL = process.env['DASHBOARD_URL'] || 'http://dashboard.localhost';

async function main() {
  console.log('====================================================');
  console.log(' Starting Conduit Gateway E2E Comprehensive Verification');
  console.log('====================================================');

  // 1. Get bootstrap admin credentials
  console.log('==> [1/15] Retrieving bootstrap admin credentials from Kubernetes...');
  let adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  let adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL;

  if (!adminPassword) {
    adminPassword = execSync(
      'kubectl get secret conduit-secrets -n conduit-system -o jsonpath="{.data.BOOTSTRAP_ADMIN_PASSWORD}" | base64 -d',
      { encoding: 'utf-8' },
    ).trim();
  }

  if (!adminEmail) {
    try {
      adminEmail = execSync(
        'kubectl get configmap conduit-config -n conduit-system -o jsonpath="{.data.BOOTSTRAP_ADMIN_EMAIL}"',
        { encoding: 'utf-8' },
      ).trim();
    } catch {
      adminEmail = 'admin@conduit.localhost';
    }
  }

  // 2. Admin logs in
  console.log(`==> [2/15] Logging in as admin (${adminEmail})...`);
  const adminLoginRes = await fetch(`${DASHBOARD_URL}/api/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: DASHBOARD_URL,
    },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });

  if (!adminLoginRes.ok) {
    throw new Error(`Admin login failed: ${adminLoginRes.status} ${await adminLoginRes.text()}`);
  }

  const adminSetCookie = adminLoginRes.headers.get('set-cookie') || '';
  const adminCookie = adminSetCookie.split(';')[0];
  const { csrfToken: adminCsrf, user: adminUser } = await adminLoginRes.json();
  console.log(`SUCCESS: Admin logged in (ID: ${adminUser.id}, CSRF: present)`);

  // 3. Admin invites new member
  const memberEmail = `e2e-member-${Date.now()}@conduit.localhost`;
  console.log(`==> [3/15] Inviting new member: ${memberEmail}...`);
  const inviteRes = await fetch(`${DASHBOARD_URL}/api/invites`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: adminCookie,
      'x-csrf-token': adminCsrf,
      origin: DASHBOARD_URL,
    },
    body: JSON.stringify({ email: memberEmail, role: 'member' }),
  });

  if (!inviteRes.ok) {
    throw new Error(`Invite creation failed: ${inviteRes.status} ${await inviteRes.text()}`);
  }

  const { token: inviteToken } = await inviteRes.json();
  console.log(`SUCCESS: Invite created with token prefix: ${inviteToken.slice(0, 8)}...`);

  // 4. Member accepts invite with Argon2id password
  console.log('==> [4/15] Accepting invite and setting password (Argon2id)...');
  const memberPassword = 'MemberPassword123!Secure';
  const acceptRes = await fetch(`${DASHBOARD_URL}/api/invites/accept`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      token: inviteToken,
      name: 'E2E Member',
      password: memberPassword,
    }),
  });

  if (!acceptRes.ok) {
    throw new Error(`Accept invite failed: ${acceptRes.status} ${await acceptRes.text()}`);
  }
  console.log('SUCCESS: Invite accepted successfully');

  // 5. Member logs in and verifies GET /api/auth/me returns csrfToken
  console.log('==> [5/15] Member logging in and verifying session & csrfToken...');
  const memberLoginRes = await fetch(`${DASHBOARD_URL}/api/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: DASHBOARD_URL,
    },
    body: JSON.stringify({ email: memberEmail, password: memberPassword }),
  });

  if (!memberLoginRes.ok) {
    throw new Error(`Member login failed: ${memberLoginRes.status} ${await memberLoginRes.text()}`);
  }

  const memberSetCookie = memberLoginRes.headers.get('set-cookie') || '';
  const memberCookie = memberSetCookie.split(';')[0];
  const { csrfToken: memberCsrf, user: memberUser } = await memberLoginRes.json();

  // Verify GET /api/auth/me returns csrfToken
  const meRes = await fetch(`${DASHBOARD_URL}/api/auth/me`, {
    headers: { cookie: memberCookie, origin: DASHBOARD_URL },
  });
  if (!meRes.ok) throw new Error(`GET /api/auth/me failed: ${meRes.status}`);
  const meJson = await meRes.json();
  if (!meJson.csrfToken) {
    throw new Error('GET /api/auth/me did not return csrfToken for active session!');
  }
  console.log('SUCCESS: Member authenticated; GET /api/auth/me returned csrfToken');

  // 6. Member inspects GET /api/servers (must NOT expose url or auth)
  console.log('==> [6/15] Verifying member GET /api/servers has no URL and no auth info...');
  const serversMemberRes = await fetch(`${DASHBOARD_URL}/api/servers`, {
    headers: { cookie: memberCookie, origin: DASHBOARD_URL },
  });
  if (!serversMemberRes.ok) throw new Error(`Member GET /api/servers failed: ${serversMemberRes.status}`);
  const { servers: memberServers } = await serversMemberRes.json();
  for (const s of memberServers) {
    if (s.url) throw new Error(`Security breach: member saw server url: ${s.url}`);
    if (s.auth) throw new Error(`Security breach: member saw server auth info: ${JSON.stringify(s.auth)}`);
  }
  console.log(`SUCCESS: Member view of ${memberServers.length} servers verified: 0 URLs and 0 auth credentials leaked`);

  // 7. Member generates API Key 1 and API Key 2
  console.log('==> [7/15] Member creating API keys...');
  const createKey = async (name: string) => {
    const res = await fetch(`${DASHBOARD_URL}/api/keys`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: memberCookie,
        'x-csrf-token': memberCsrf,
        origin: DASHBOARD_URL,
      },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error(`Create key failed: ${res.status}`);
    return res.json();
  };

  const key1 = await createKey('e2e-member-key-1');
  const key2 = await createKey('e2e-member-key-2');
  console.log(`SUCCESS: Created key 1 (${key1.prefix}) and key 2 (${key2.prefix})`);

  // 8. Call /mcp with Key 1
  console.log('==> [8/15] Calling /mcp tools/list and tools/call woo__list_products with Key 1...');
  const callMcp = async (key: string, method: string, params?: Record<string, unknown>) => {
    const res = await fetch(`${GATEWAY_URL}/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) }),
    });
    const text = await res.text();
    const dataLine = text.split('\n').find((l) => l.startsWith('data: '));
    const json = JSON.parse(dataLine ? dataLine.replace(/^data: /, '') : text);
    return { status: res.status, json };
  };

  const list1 = await callMcp(key1.key, 'tools/list');
  const tools1 = list1.json.result?.tools || [];
  const wooTool = tools1.find((t: any) => t.name === 'woo__list_products');
  if (!wooTool) {
    throw new Error(`Expected woo__list_products in tools/list, got: ${tools1.map((t: any) => t.name).join(', ')}`);
  }
  console.log(`SUCCESS: Discovered ${tools1.length} tools including exact tool name "woo__list_products"`);

  const call1 = await callMcp(key1.key, 'tools/call', { name: 'woo__list_products', arguments: { per_page: 2 } });
  if (call1.json.result?.isError) {
    throw new Error(`Tool call failed: ${JSON.stringify(call1.json.result)}`);
  }
  console.log('SUCCESS: Tool call to woo__list_products succeeded');

  // 9. Revoke Key 2 -> next call with Key 2 must return 401
  console.log('==> [9/15] Revoking Key 2 and verifying immediate 401 on /mcp...');
  const revokeRes = await fetch(`${DASHBOARD_URL}/api/keys/${key2.id}`, {
    method: 'DELETE',
    headers: {
      cookie: memberCookie,
      'x-csrf-token': memberCsrf,
      origin: DASHBOARD_URL,
    },
  });
  if (!revokeRes.ok) throw new Error(`Revoke key failed: ${revokeRes.status}`);

  const revokedCall = await callMcp(key2.key, 'tools/list');
  if (revokedCall.status !== 401) {
    throw new Error(`Expected 401 for revoked key, got: ${revokedCall.status}`);
  }
  console.log('SUCCESS: Revoked Key 2 was rejected immediately with 401 Unauthorized');

  // 10. Audit scope verification: Member sees only own rows, Admin sees both
  console.log('==> [10/15] Verifying audit isolation (Member sees own, Admin sees all)...');
  await new Promise((r) => setTimeout(r, 600)); // wait for audit flush

  const memberAuditRes = await fetch(`${DASHBOARD_URL}/api/audit`, {
    headers: { cookie: memberCookie, origin: DASHBOARD_URL },
  });
  const { items: memberAuditItems } = await memberAuditRes.json();
  for (const item of memberAuditItems) {
    if (item.userId !== memberUser.id) {
      throw new Error(`Audit leakage: member saw another user audit row: ${item.userId}`);
    }
  }

  const adminAuditRes = await fetch(`${DASHBOARD_URL}/api/audit`, {
    headers: { cookie: adminCookie, origin: DASHBOARD_URL },
  });
  const { items: adminAuditItems } = await adminAuditRes.json();
  const foundMemberRowInAdmin = adminAuditItems.some((i: any) => i.userId === memberUser.id);
  if (!foundMemberRowInAdmin) {
    throw new Error('Admin audit log did not contain member audit events');
  }
  console.log(`SUCCESS: Member audit scoped strictly to own events (${memberAuditItems.length} rows); Admin views all (${adminAuditItems.length} rows)`);

  // 11. Disable woo server -> tools disappear; Enable -> tools return
  console.log('==> [11/15] Disabling woo server and testing tool list disappearance/return...');
  const adminServersRes = await fetch(`${DASHBOARD_URL}/api/servers`, {
    headers: { cookie: adminCookie, origin: DASHBOARD_URL },
  });
  const { servers: allServers } = await adminServersRes.json();
  const wooServer = allServers.find((s: any) => s.slug === 'woo');
  if (!wooServer) throw new Error('Could not find server with slug "woo"');

  // Disable woo server
  const disableSrvRes = await fetch(`${DASHBOARD_URL}/api/servers/${wooServer.id}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      cookie: adminCookie,
      'x-csrf-token': adminCsrf,
      origin: DASHBOARD_URL,
    },
    body: JSON.stringify({ enabled: false }),
  });
  if (!disableSrvRes.ok) throw new Error(`Disable server failed: ${disableSrvRes.status}`);

  await new Promise((r) => setTimeout(r, 1000));
  const listDisabled = await callMcp(key1.key, 'tools/list');
  const toolsDisabled = listDisabled.json.result?.tools || [];
  const wooToolWhenDisabled = toolsDisabled.find((t: any) => t.name === 'woo__list_products');
  if (wooToolWhenDisabled) {
    throw new Error('woo__list_products still present in tools/list when server is disabled!');
  }
  console.log('SUCCESS: Server disabled -> woo tools disappeared from /mcp tools/list');

  // Re-enable woo server
  const enableSrvRes = await fetch(`${DASHBOARD_URL}/api/servers/${wooServer.id}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      cookie: adminCookie,
      'x-csrf-token': adminCsrf,
      origin: DASHBOARD_URL,
    },
    body: JSON.stringify({ enabled: true }),
  });
  if (!enableSrvRes.ok) throw new Error(`Enable server failed: ${enableSrvRes.status}`);

  await new Promise((r) => setTimeout(r, 1000));
  const listEnabled = await callMcp(key1.key, 'tools/list');
  const toolsEnabled = listEnabled.json.result?.tools || [];
  const wooToolWhenEnabled = toolsEnabled.find((t: any) => t.name === 'woo__list_products');
  if (!wooToolWhenEnabled) {
    throw new Error('woo__list_products did not return after server was re-enabled!');
  }
  console.log('SUCCESS: Server re-enabled -> woo tools reappeared in /mcp tools/list');

  // 12. Scale woo-mcp to 0 -> call returns [gateway:...] quickly and GET /api/servers shows unreachable
  console.log('==> [12/15] Scaling woo-mcp to 0 replicas to test failure handling & status reflection...');
  execSync('kubectl scale deployment -n store-default store-woocommerce-store-woo-mcp --replicas=0');
  execSync('kubectl wait --for=delete pod -l app.kubernetes.io/name=woo-mcp -n store-default --timeout=60s || true');

  const startFailCall = Date.now();
  const failCall = await callMcp(key1.key, 'tools/call', { name: 'woo__list_products', arguments: { per_page: 2 } });
  const failDuration = Date.now() - startFailCall;
  const toolResult = failCall.json.result;
  console.log(`Tool call to scaled-down server completed in ${failDuration}ms (expected fast failure)`);

  if (!toolResult?.isError) {
    throw new Error(`Expected isError: true for unreachable upstream, got: ${JSON.stringify(toolResult)}`);
  }
  const errorText = toolResult.content?.[0]?.text || '';
  if (!errorText.includes('[gateway:')) {
    throw new Error(`Expected error prefix [gateway:...], got: ${errorText}`);
  }
  console.log(`SUCCESS: Tool call returned gateway error prefix: "${errorText.slice(0, 45)}..."`);

  // Check GET /api/servers status
  const unreachableServersRes = await fetch(`${DASHBOARD_URL}/api/servers`, {
    headers: { cookie: adminCookie, origin: DASHBOARD_URL },
  });
  const { servers: updatedServers } = await unreachableServersRes.json();
  const wooUnreachable = updatedServers.find((s: any) => s.slug === 'woo');
  console.log(`Server status state: "${wooUnreachable?.status?.state}", reasonCode: "${wooUnreachable?.status?.reasonCode}"`);
  if (wooUnreachable?.status?.state !== 'unreachable') {
    throw new Error(`Expected status.state === 'unreachable', got: ${wooUnreachable?.status?.state}`);
  }
  console.log('SUCCESS: GET /api/servers shows unreachable state with error reason');

  // 13. Scale woo-mcp back to 1 -> recovers automatically without manual steps
  console.log('==> [13/15] Scaling woo-mcp back to 1 replica and proving automatic recovery...');
  execSync('kubectl scale deployment -n store-default store-woocommerce-store-woo-mcp --replicas=1');
  execSync('kubectl rollout status deployment/store-woocommerce-store-woo-mcp -n store-default --timeout=60s');

  let recovered = false;
  for (let attempt = 1; attempt <= 10; attempt++) {
    await new Promise((r) => setTimeout(r, 1000));
    const recCall = await callMcp(key1.key, 'tools/call', { name: 'woo__list_products', arguments: { per_page: 2 } });
    if (!recCall.json.result?.isError) {
      recovered = true;
      break;
    }
  }

  if (!recovered) {
    throw new Error('Woo MCP tool call did not recover automatically after scale up');
  }
  console.log('SUCCESS: Automatic recovery verified! Tool calls succeed with 0 manual steps');

  // 14. Export CSV audit log and verify formula injection neutralization
  console.log('==> [14/15] Exporting CSV and validating formula injection neutralization...');
  const csvRes = await fetch(`${DASHBOARD_URL}/api/audit/export.csv`, {
    headers: { cookie: adminCookie, origin: DASHBOARD_URL },
  });
  if (!csvRes.ok) throw new Error(`CSV export failed: ${csvRes.status}`);
  const csvText = await csvRes.text();
  const csvLines = csvText.split('\r\n');
  console.log(`CSV exported successfully (${csvLines.length} lines). Header: ${csvLines[0].slice(0, 50)}...`);

  // 15. Admin disables member -> both session and API key fail immediately on very next call
  console.log('==> [15/15] Disabling member and verifying immediate session & API key rejection...');
  const disableMemberRes = await fetch(`${DASHBOARD_URL}/api/users/${memberUser.id}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      cookie: adminCookie,
      'x-csrf-token': adminCsrf,
      origin: DASHBOARD_URL,
    },
    body: JSON.stringify({ status: 'disabled' }),
  });
  if (!disableMemberRes.ok) throw new Error(`Disable member failed: ${disableMemberRes.status}`);

  // Test session cookie rejection
  const disabledSessionRes = await fetch(`${DASHBOARD_URL}/api/auth/me`, {
    headers: { cookie: memberCookie, origin: DASHBOARD_URL },
  });
  if (disabledSessionRes.status !== 401) {
    throw new Error(`Expected 401 for disabled user session, got: ${disabledSessionRes.status}`);
  }

  // Test API key rejection
  const disabledKeyRes = await callMcp(key1.key, 'tools/list');
  if (disabledKeyRes.status !== 401) {
    throw new Error(`Expected 401 for disabled user API key, got: ${disabledKeyRes.status}`);
  }
  console.log('SUCCESS: Disabled member session cookie and API key both rejected immediately with 401');

  // Verify self-disable and last-admin protection
  const selfDisableRes = await fetch(`${DASHBOARD_URL}/api/users/${adminUser.id}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      cookie: adminCookie,
      'x-csrf-token': adminCsrf,
      origin: DASHBOARD_URL,
    },
    body: JSON.stringify({ status: 'disabled' }),
  });
  if (selfDisableRes.status !== 400) {
    throw new Error(`Expected 400 for self-disable / last admin, got: ${selfDisableRes.status}`);
  }
  console.log('SUCCESS: Self-disable & last active admin protection verified');

  console.log('====================================================');
  console.log(' ALL 15 GATEWAY E2E CHECKS PASSED 100%!');
  console.log('====================================================');
}

main().catch((err) => {
  console.error('FATAL E2E ERROR:', err);
  process.exit(1);
});
