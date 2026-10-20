import { chromium, type Page } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function execQuiet(cmd: string): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

const VIEWPORTS = [
  { name: '375', width: 375, height: 667 },
  { name: '768', width: 768, height: 1024 },
  { name: '1280', width: 1280, height: 800 },
];

const TARGET_DIR = path.resolve(process.cwd(), 'docs/screenshots/before');

interface AxeIssueSummary {
  page: string;
  id: string;
  impact: string;
  description: string;
  nodesCount: number;
  targetSample: string;
}

async function captureScreen(page: Page, filename: string) {
  const fullPath = path.join(TARGET_DIR, filename);
  await page.screenshot({ path: fullPath, fullPage: false });
  console.log(`Saved screenshot: ${filename}`);
}

async function runAxe(page: Page, pageName: string, issuesCollector: AxeIssueSummary[]) {
  try {
    const results = await new AxeBuilder({ page }).analyze();
    for (const v of results.violations) {
      issuesCollector.push({
        page: pageName,
        id: v.id,
        impact: v.impact || 'moderate',
        description: v.description,
        nodesCount: v.nodes.length,
        targetSample: v.nodes[0]?.target?.join(' ') || '',
      });
    }
  } catch (err) {
    console.warn(`Axe failed on ${pageName}:`, err);
  }
}

async function main() {
  fs.mkdirSync(TARGET_DIR, { recursive: true });

  const bootstrapPassword = execQuiet(
    "kubectl get secret conduit-secrets -n conduit-system -o jsonpath='{.data.BOOTSTRAP_ADMIN_PASSWORD}' | base64 -d"
  );
  const passwordsToTry = ['Admin123!SecureNewPassword', bootstrapPassword, 'Password123!Secure', 'Conduit2026!Enterprise'].filter(Boolean);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const allAxeIssues: AxeIssueSummary[] = [];

  console.log('--- Capturing Unauthenticated Pages ---');
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });

    // 1. Login Page
    await page.goto('http://dashboard.localhost/login', { waitUntil: 'networkidle' });
    await captureScreen(page, `login-${vp.name}.png`);
    if (vp.name === '1280') await runAxe(page, 'login', allAxeIssues);

    // 2. Accept Invite Page
    await page.goto('http://dashboard.localhost/accept-invite?token=demo-test-token-visual', { waitUntil: 'networkidle' });
    await captureScreen(page, `accept-invite-${vp.name}.png`);
    if (vp.name === '1280') await runAxe(page, 'accept-invite', allAxeIssues);

    // 3. 403 Forbidden Page
    await page.goto('http://dashboard.localhost/forbidden', { waitUntil: 'networkidle' });
    await captureScreen(page, `403-${vp.name}.png`);
    if (vp.name === '1280') await runAxe(page, '403', allAxeIssues);

    // 4. 404 Not Found Page
    await page.goto('http://dashboard.localhost/route-that-does-not-exist', { waitUntil: 'networkidle' });
    await captureScreen(page, `404-${vp.name}.png`);
    if (vp.name === '1280') await runAxe(page, '404', allAxeIssues);
  }

  console.log('--- Logging in as Admin ---');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('http://dashboard.localhost/login', { waitUntil: 'networkidle' });

  let loggedIn = false;
  for (const pw of passwordsToTry) {
    await page.fill('#login-email', 'admin@conduit.localhost');
    await page.fill('#login-password', pw);
    await page.click('button[type="submit"]');
    try {
      await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 4000 });
      loggedIn = true;
      console.log(`Logged in successfully! Current URL: ${page.url()}`);
      break;
    } catch {
      console.log(`Password attempt failed for length ${pw.length}, trying next...`);
    }
  }

  if (!loggedIn) {
    console.error('Failed to log in with known passwords!');
    process.exit(1);
  }

  // Handle /change-password if forced
  if (page.url().includes('/change-password')) {
    console.log('Admin redirected to change-password. Filling form...');
    await page.fill('input[type="password"]', 'Admin123!SecureNewPassword');
    // If confirm password exists
    const pwInputs = await page.$$('input[type="password"]');
    if (pwInputs.length >= 2) {
      await pwInputs[1].fill('Admin123!SecureNewPassword');
    }
    await page.click('button[type="submit"]');
    await page.waitForURL('**/servers', { timeout: 10000 });
  }

  console.log('--- Capturing Authenticated Pages ---');

  // Helper for authenticated pages across viewports
  async function captureAuthPage(pageName: string, pathUrl: string, setupAction?: () => Promise<void>) {
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(`http://dashboard.localhost${pathUrl}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      if (setupAction) {
        await setupAction();
      }
      await captureScreen(page, `${pageName}-${vp.name}.png`);
      if (vp.name === '1280') {
        await runAxe(page, pageName, allAxeIssues);
      }
    }
  }

  // 5. Servers page
  await captureAuthPage('servers', '/servers');

  // 6. Servers tool diff / tool list modal
  await captureAuthPage('servers-tool-diff', '/servers', async () => {
    // Click View Tools on the first server card/row if present
    const viewToolsBtn = await page.$('button:has-text("View Tools"), button:has-text("Tools")');
    if (viewToolsBtn) {
      await viewToolsBtn.click();
      await page.waitForTimeout(400);
    }
  });

  // 7. Team Page
  await captureAuthPage('team', '/team');

  // 8. API Keys Page
  await captureAuthPage('api-keys', '/keys');

  // 9. API Keys One-Time Reveal Modal
  await captureAuthPage('api-keys-modal', '/keys', async () => {
    const createBtn = await page.$('button:has-text("Create API Key"), button:has-text("Generate API Key"), button:has-text("New Key")');
    if (createBtn) {
      await createBtn.click();
      await page.waitForTimeout(300);
      const labelInput = await page.$('input[placeholder*="label" i], input[type="text"]');
      if (labelInput) {
        await labelInput.fill('audit-baseline-key');
        const submitBtn = await page.$('div[role="dialog"] button:has-text("Create"), div[role="dialog"] button[type="submit"]');
        if (submitBtn) {
          await submitBtn.click();
          await page.waitForTimeout(600);
        }
      }
    }
  });

  // 10. Audit Page
  await captureAuthPage('audit', '/audit');

  // 11. Connect Page
  await captureAuthPage('connect', '/connect');

  // 12. Policies Page
  await captureAuthPage('policies', '/policies');

  // 13. Account Page
  await captureAuthPage('account', '/account');

  // 14. Chat Page
  await captureAuthPage('chat', '/chat');

  // 15. Chat Page with Tool Card
  await captureAuthPage('chat-tool-card', '/chat', async () => {
    const chatInput = await page.$('textarea, input[placeholder*="Ask" i], input[placeholder*="Type" i]');
    if (chatInput) {
      await chatInput.fill('List products in the store');
      const sendBtn = await page.$('button:has-text("Send"), form button[type="submit"]');
      if (sendBtn) {
        await sendBtn.click();
        await page.waitForTimeout(2500);
      }
    }
  });

  await browser.close();

  console.log('\n========================================');
  console.log('        AXE ACCESSIBILITY SUMMARY       ');
  console.log('========================================');
  console.log(`Total issues detected: ${allAxeIssues.length}`);
  const groupedByPage: Record<string, AxeIssueSummary[]> = {};
  for (const issue of allAxeIssues) {
    groupedByPage[issue.page] = groupedByPage[issue.page] || [];
    groupedByPage[issue.page].push(issue);
  }

  for (const [p, issues] of Object.entries(groupedByPage)) {
    console.log(`\nPage: [${p}] (${issues.length} issues)`);
    for (const iss of issues) {
      console.log(`  - [${iss.impact.toUpperCase()}] ${iss.id}: ${iss.description} (${iss.nodesCount} elements, e.g. "${iss.targetSample}")`);
    }
  }

  fs.writeFileSync(
    path.join(TARGET_DIR, 'axe-baseline-report.json'),
    JSON.stringify(allAxeIssues, null, 2)
  );
  console.log(`\nSaved baseline axe report to ${path.join(TARGET_DIR, 'axe-baseline-report.json')}`);
}

main().catch((err) => {
  console.error('Fatal in capture-baseline:', err);
  process.exit(1);
});
