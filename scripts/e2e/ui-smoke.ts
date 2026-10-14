import { chromium, type ConsoleMessage } from 'playwright';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Clean helper to run commands without printing output or secrets
function execQuiet(cmd: string): string {
  return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

async function runUiSmoke() {
  console.log('=== Starting Conduit Phase 4 Playwright Smoke Test ===');

  // 1. Ensure screenshot directory exists
  const screenshotDir = path.resolve(process.cwd(), 'docs/screenshots');
  fs.mkdirSync(screenshotDir, { recursive: true });

  // 2. Retrieve admin password and mongo credentials from cluster secret without printing
  let adminPassword = '';
  let mongoPassword = '';
  try {
    adminPassword = execQuiet(
      "kubectl get secret conduit-secrets -n conduit-system -o jsonpath='{.data.BOOTSTRAP_ADMIN_PASSWORD}' | base64 -d"
    );
    mongoPassword = execQuiet(
      "kubectl get secret conduit-secrets -n conduit-system -o jsonpath='{.data.MONGO_PASSWORD}' | base64 -d"
    );
  } catch (err) {
    console.error('Failed to retrieve credentials from cluster secret');
    process.exit(1);
  }

  const adminEmail = 'admin@conduit.localhost';
  const memberEmail = `e2e-member-${Date.now()}@conduit.localhost`;
  const memberPassword = 'MemberPassword123!';

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });

  const page = await context.newPage();

  // Track CSP violations
  const cspViolations: string[] = [];
  page.on('pageerror', (err) => console.error('[PAGE ERROR]:', err)); page.on('console', (msg: ConsoleMessage) => { console.log('[PAGE LOG ' + msg.type() + ']:', msg.text());
    const text = msg.text();
    if (
      text.toLowerCase().includes('content security policy') ||
      text.toLowerCase().includes('violates the following content security policy')
    ) {
      cspViolations.push(text);
      console.error(`[CSP Violation]: ${text}`);
    }
  });

  try {
    // Step 1: Admin logs in
    console.log('[1/7] Navigating to http://dashboard.localhost and logging in as Admin...');
    await page.goto('http://dashboard.localhost/login', { waitUntil: 'networkidle' });
    await page.fill('#login-email', adminEmail);
    await page.fill('#login-password', adminPassword);
    await page.click('button[type="submit"]');

    // Wait for servers page
    await page.waitForURL('**/servers', { timeout: 15000 });
    console.log('  -> Admin successfully logged in.');

    // Step 2: Verify Woo is connected
    console.log('[2/7] Verifying WooCommerce Upstream Server status...');
    await page.waitForSelector('text=WooCommerce', { timeout: 10000 });
    await page.waitForSelector('text=connected', { timeout: 10000 });
    await page.screenshot({ path: path.join(screenshotDir, '01-servers.png') });
    console.log('  -> WooCommerce verified as Connected. Saved 01-servers.png');

    // Step 3: Admin invites a member
    console.log('[3/7] Admin inviting new member...');
    await page.click('text=Team');
    await page.waitForURL('**/team');
    await page.click('button:has-text("Invite Member")');
    await page.fill('#inv-email', memberEmail);
    await page.click('button:has-text("Create Invitation Link")');

    // Wait for the invitation link input
    await page.waitForSelector('input[readonly]', { timeout: 10000 });
    const inviteUrl = await page.inputValue('input[readonly]');
    if (!inviteUrl || !inviteUrl.includes('token=')) {
      throw new Error(`Failed to retrieve invite URL from modal: got ${inviteUrl}`);
    }
    await page.click('button:has-text("Done")');
    console.log('  -> Member invitation link generated.');

    // Step 4: Member accepts invitation and logs in
    console.log('[4/7] Member accepting invitation and logging in...');
    await page.click('button:has-text("Logout")');
    await page.waitForURL('**/login');

    // Open invite link
    await page.goto(inviteUrl, { waitUntil: 'networkidle' });
    await page.fill('#invite-name', 'E2E Member');
    await page.fill('#invite-password', memberPassword);
    await page.fill('#invite-confirm-password', memberPassword);
    await page.click('button:has-text("Complete Setup & Join")');

    // Wait for redirect to login
    await page.waitForURL('**/login', { timeout: 10000 });

    // Member logs in
    await page.fill('#login-email', memberEmail);
    await page.fill('#login-password', memberPassword);
    await page.click('button[type="submit"]');
    await page.waitForURL('**/servers', { timeout: 10000 });
    await page.screenshot({ path: path.join(screenshotDir, '02-member-dashboard.png') });
    console.log('  -> Member successfully registered and logged in.');

    // Step 5: Member creates an API Key (one-time reveal)
    console.log('[5/7] Member generating API Key with one-time reveal...');
    await page.click('text=API Keys');
    await page.waitForURL('**/keys');
    await page.click('button:has-text("Create API Key")');
    await page.fill('#key-name', 'E2E Playwright Key');
    await page.click('button:has-text("Generate Key")');

    await page.waitForSelector('text=Your New API Key', { timeout: 10000 });
    const secretInput = page.locator('input.select-all');
    const secretKey = await secretInput.inputValue();
    if (!secretKey || !secretKey.startsWith('mcpgw_')) {
      throw new Error(`Invalid secret key generated: ${secretKey}`);
    }

    await page.screenshot({ path: path.join(screenshotDir, '03-key-reveal.png') });
    await page.check('#saved-check');
    await page.click('button:has-text("Done & Close")');
    console.log('  -> API Key generated and revealed once. Saved 03-key-reveal.png');

    // Step 6: Tool call via MCP endpoint with API Key
    console.log('[6/7] Invoking MCP tool call with generated API key...');
    const mcpRes = await fetch('http://gateway.localhost/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${secretKey}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'ui-smoke-1',
        method: 'tools/call',
        params: {
          name: 'woo__list_products',
          arguments: { per_page: 5 },
        },
      }),
    });

    if (!mcpRes.ok) {
      throw new Error(`MCP tool call failed with status ${mcpRes.status}`);
    }
    const rawText = await mcpRes.text();
    const dataLine = rawText.split('\n').find((l) => l.startsWith('data: ')) || rawText;
    const mcpData: any = JSON.parse(dataLine.replace(/^data: /, ''));
    if (mcpData.result?.isError) {
      throw new Error(`MCP tool call returned error: ${JSON.stringify(mcpData)}`);
    }
    const toolText = mcpData.result?.content?.[0]?.text;
    const products = JSON.parse(toolText);
    if (!Array.isArray(products) || products.length === 0) {
      throw new Error(`Expected products array, got: ${toolText}`);
    }
    console.log(`  -> MCP tool call succeeded! Discovered ${products.length} products.`);
    // Wait for async MongoAuditSink flush
    await new Promise((r) => setTimeout(r, 2000));

    // Verify Audit log shows the tool call
    console.log('[7/7] Verifying Audit log and testing API Key revocation...');
    await page.click('text=Audit');
    await page.waitForURL('**/audit');
    await page.waitForSelector('text=woo__list_products', { timeout: 10000 });
    await page.screenshot({ path: path.join(screenshotDir, '04-audit.png') });
    console.log('  -> Audit log verified with tool call. Saved 04-audit.png');

    // Revoke the API key
    await page.click('text=API Keys');
    await page.waitForURL('**/keys');
    await page.click('button:has-text("Revoke")');
    await page.waitForSelector('text=Revoked', { timeout: 10000 });

    // Assert immediate next call returns 401 Unauthorized
    const revokedRes = await fetch('http://gateway.localhost/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${secretKey}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'ui-smoke-2',
        method: 'tools/call',
        params: { name: 'woo__list_products', arguments: {} },
      }),
    });

    if (revokedRes.status !== 401) {
      throw new Error(`Expected 401 for revoked key, got status ${revokedRes.status}`);
    }
    console.log('  -> Revoked key successfully rejected with HTTP 401.');

    // Assert zero CSP violations
    if (cspViolations.length > 0) {
      throw new Error(`CSP Violations detected during test run: ${cspViolations.join('; ')}`);
    }
    console.log('  -> Zero CSP violations detected across all views.');
  } finally {
    await browser.close();

    // Cleanup member from MongoDB dev cluster
    console.log('Cleaning up test member from database...');
    try {
      execQuiet(
        `kubectl exec conduit-mongodb-0 -n conduit-system -- mongosh conduit -u conduit -p "${mongoPassword}" --authenticationDatabase conduit --quiet --eval "
          const user = db.users.findOne({ email: '${memberEmail}' });
          if (user) {
            db.api_keys.deleteMany({ ownerId: user._id.toString() });
            db.sessions.deleteMany({ userId: user._id.toString() });
            db.invites.deleteMany({ email: '${memberEmail}' });
            db.users.deleteOne({ _id: user._id });
          }
        "`
      );
      console.log('  -> Dev database cleanly purged of test users.');
    } catch (cleanErr) {
      console.error('Warning: Failed to cleanup test member:', cleanErr);
    }
  }

  console.log('=== Playwright Smoke Test PASSED Successfully ===');
}

runUiSmoke().catch((err) => {
  console.error('Playwright Smoke Test FAILED:', err);
  process.exit(1);
});
