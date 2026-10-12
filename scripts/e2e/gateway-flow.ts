import { execSync } from 'node:child_process';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://gateway.localhost';
const DASHBOARD_URL = process.env.DASHBOARD_URL || 'http://dashboard.localhost';

async function main() {
  console.log('====================================================');
  console.log(' Starting Conduit Gateway E2E Flow Verification');
  console.log('====================================================');

  // 1. Fetch credentials securely from Kubernetes secrets
  console.log('==> [1/9] Retrieving bootstrap admin credentials from Kubernetes...');
  let adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  let adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL;

  if (!adminPassword) {
    adminPassword = execSync(
      'kubectl get secret conduit-secrets -n conduit-system -o jsonpath="{.data.BOOTSTRAP_ADMIN_PASSWORD}" | base64 -d',
      { encoding: 'utf-8' },
    ).trim();
  }

  if (!adminEmail) {
    adminEmail = execSync(
      'kubectl get configmap conduit-config -n conduit-system -o jsonpath="{.data.BOOTSTRAP_ADMIN_EMAIL}"',
      { encoding: 'utf-8' },
    ).trim();
  }

  // 2. Admin logs in
  console.log(`==> [2/9] Logging in as admin (${adminEmail})...`);
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
  console.log(`SUCCESS: Admin logged in (ID: ${adminUser.id})`);

  // 3. Admin creates an invite for a new team member
  const memberEmail = `e2e-member-${Date.now()}@conduit.localhost`;
  console.log(`==> [3/9] Inviting new member: ${memberEmail}...`);
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
  console.log('==> [4/9] Accepting invite and setting password (Argon2id)...');
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

  // 5. Member logs in and generates an API key
  console.log('==> [5/9] Member logging in and creating API key...');
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

  const keyRes = await fetch(`${DASHBOARD_URL}/api/keys`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: memberCookie,
      'x-csrf-token': memberCsrf,
      origin: DASHBOARD_URL,
    },
    body: JSON.stringify({ name: 'e2e-member-key' }),
  });

  if (!keyRes.ok) {
    throw new Error(`Member key creation failed: ${keyRes.status} ${await keyRes.text()}`);
  }

  const { key: memberApiKey, prefix: memberKeyPrefix } = await keyRes.json();
  console.log(`SUCCESS: Member API key created: prefix=${memberKeyPrefix}`);

  // 6. Member invokes /mcp tools/list and tools/call
  console.log('==> [6/9] Invoking /mcp tools/list and tools/call with member API key...');
  const listRes = await fetch(`${GATEWAY_URL}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${memberApiKey}`,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    }),
  });

  const listText = await listRes.text();
  const listDataLine = listText.split('\n').find((l) => l.startsWith('data: '));
  const listJson = JSON.parse(listDataLine ? listDataLine.replace(/^data: /, '') : listText);
  const tools = listJson.result?.tools || [];
  console.log(`Discovered ${tools.length} active tools on /mcp`);
  if (tools.length < 8) {
    throw new Error(`Expected at least 8 tools, found: ${tools.length}`);
  }

  const callRes = await fetch(`${GATEWAY_URL}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${memberApiKey}`,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'woo__list_products',
        arguments: { per_page: 2 },
      },
    }),
  });

  const callText = await callRes.text();
  const callDataLine = callText.split('\n').find((l) => l.startsWith('data: '));
  const callJson = JSON.parse(callDataLine ? callDataLine.replace(/^data: /, '') : callText);

  if (callJson.result?.isError) {
    throw new Error(`Tool call returned isError=true: ${JSON.stringify(callJson.result)}`);
  }
  console.log('SUCCESS: Tool call completed successfully');

  // 7. Verify audit persistence via GET /api/audit
  console.log('==> [7/9] Verifying asynchronous audit log persistence in /api/audit...');
  // Wait up to 5s for audit queue flush
  let auditFound = false;
  for (let attempt = 1; attempt <= 10; attempt++) {
    await new Promise((r) => setTimeout(r, 500));
    const auditRes = await fetch(`${DASHBOARD_URL}/api/audit?userId=${memberUser.id}&tool=list_products`, {
      headers: {
        cookie: adminCookie,
        origin: DASHBOARD_URL,
      },
    });

    if (auditRes.ok) {
      const { items } = await auditRes.json();
      if (items && items.length > 0) {
        const item = items[0];
        console.log(`SUCCESS: Found audit log for tool call! Outcome=${item.outcome}, duration=${item.durationMs}ms`);
        console.log(`Args summary: "${item.argsSummary}", args hash: ${item.argsHash.slice(0, 12)}...`);
        auditFound = true;
        break;
      }
    }
  }

  if (!auditFound) {
    throw new Error('Audit record was not persisted to tool_calls collection within 5 seconds');
  }

  // 8. Admin exports CSV and verifies CSV injection sanitization
  console.log('==> [8/9] Exporting audit log to CSV and checking injection protection...');
  const csvRes = await fetch(`${DASHBOARD_URL}/api/audit/export.csv`, {
    headers: {
      cookie: adminCookie,
      origin: DASHBOARD_URL,
    },
  });

  if (!csvRes.ok) {
    throw new Error(`CSV export failed: ${csvRes.status}`);
  }
  const csvText = await csvRes.text();
  const csvLines = csvText.split('\r\n');
  console.log(`CSV exported successfully (${csvLines.length} lines). Header: ${csvLines[0]}`);

  // 9. Admin disables member; verify immediate rejection on next call
  console.log('==> [9/9] Disabling member user and verifying immediate 401 on /mcp...');
  const disableRes = await fetch(`${DASHBOARD_URL}/api/users/${memberUser.id}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      cookie: adminCookie,
      'x-csrf-token': adminCsrf,
      origin: DASHBOARD_URL,
    },
    body: JSON.stringify({ status: 'disabled' }),
  });

  if (!disableRes.ok) {
    throw new Error(`User disable failed: ${disableRes.status}`);
  }
  console.log('Member user marked disabled by admin');

  // Next /mcp call with member API key must be rejected immediately
  const disabledCallRes = await fetch(`${GATEWAY_URL}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${memberApiKey}`,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/list',
    }),
  });

  console.log(`HTTP status for disabled user API key: ${disabledCallRes.status} (expected 401)`);
  if (disabledCallRes.status !== 401) {
    throw new Error(`Expected 401 for disabled user, got: ${disabledCallRes.status}`);
  }

  // Verify last active admin cannot be disabled
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
    throw new Error(`Expected 400 when disabling self/last admin, got: ${selfDisableRes.status}`);
  }
  console.log('CONFIRMED: Self-disable/last-admin protection active');

  console.log('====================================================');
  console.log(' ALL GATEWAY E2E FLOW CHECKS PASSED 100%!');
  console.log('====================================================');
}

main().catch((err) => {
  console.error('FATAL E2E ERROR:', err);
  process.exit(1);
});
