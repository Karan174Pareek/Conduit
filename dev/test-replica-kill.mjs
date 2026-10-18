import { execSync } from 'node:child_process';
import http from 'node:http';

const DURATION_SECONDS = 40;
const REQ_PER_SEC = 10;
const TOTAL_REQUESTS = DURATION_SECONDS * REQ_PER_SEC; // 400
const DELAY_MS = Math.floor(1000 / REQ_PER_SEC); // 100ms

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBootstrapPassword() {
  const b64 = execSync("kubectl get secret conduit-secrets -n conduit-system -o jsonpath='{.data.BOOTSTRAP_ADMIN_PASSWORD}'", { encoding: 'utf-8' }).trim();
  return Buffer.from(b64, 'base64').toString('utf-8');
}

function postJson(urlStr, headers, bodyObj) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const bodyStr = JSON.stringify(bodyObj);
    const req = http.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(bodyStr),
          ...headers,
        },
        timeout: 5000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          const cookie = res.headers['set-cookie'] ? res.headers['set-cookie'][0] : '';
          try {
            resolve({ statusCode: res.statusCode, data: JSON.parse(data), cookie });
          } catch {
            resolve({ statusCode: res.statusCode, raw: data, cookie });
          }
        });
      }
    );
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function deleteReq(urlStr, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = http.request(url, { method: 'DELETE', headers, timeout: 5000 }, (res) => {
      res.resume();
      res.on('end', () => resolve({ statusCode: res.statusCode }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function sendMcpRequest(apiKey, id) {
  const payload = JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/list', params: {} });
  return new Promise((resolve) => {
    const req = http.request(
      'http://127.0.0.1/mcp',
      {
        method: 'POST',
        headers: {
          host: 'gateway.localhost',
          authorization: `Bearer ${apiKey}`,
          accept: 'application/json, text/event-stream',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
        },
        timeout: 4000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve({ ok: true, statusCode: res.statusCode });
          } else {
            resolve({ ok: false, statusCode: res.statusCode, body: data });
          }
        });
      }
    );
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.on('error', (err) => resolve({ ok: false, error: err.message }));
    req.write(payload);
    req.end();
  });
}

async function main() {
  console.log('=== Multi-Replica Resilience & Pod Kill Drill (MCP tools/list) ===');
  
  let keyId = null;
  let sessionCookie = null;
  let csrfToken = null;

  try {
    console.log('1. Acquiring admin credentials and creating member API key...');
    const adminPassword = getBootstrapPassword();
    const loginRes = await postJson(
      'http://127.0.0.1/api/auth/login',
      { host: 'dashboard.localhost' },
      { email: 'admin@conduit.localhost', password: adminPassword }
    );
    if (!loginRes.cookie || !loginRes.data?.csrfToken) {
      throw new Error('Failed to login as bootstrap admin: ' + JSON.stringify(loginRes));
    }
    sessionCookie = loginRes.cookie.split(';')[0];
    csrfToken = loginRes.data.csrfToken;

    const keyRes = await postJson(
      'http://127.0.0.1/api/keys',
      { host: 'dashboard.localhost', cookie: sessionCookie, 'x-csrf-token': csrfToken },
      { name: `drill-key-${Date.now()}` }
    );
    if (!keyRes.data?.key) {
      throw new Error('Failed to create member API key: ' + JSON.stringify(keyRes));
    }
    const apiKey = keyRes.data.key;
    keyId = keyRes.data.id;
    console.log('Created temporary API key id: ' + keyId);

    const checkOne = await sendMcpRequest(apiKey, 999);
    if (!checkOne.ok) {
      throw new Error(`Pre-flight MCP tools/list failed: ${JSON.stringify(checkOne)}`);
    }
    console.log('Verified pre-flight MCP tools/list call returned 200 OK.');

    console.log('2. Scaling conduit-gateway to 2 replicas...');
    execSync('kubectl scale deployment conduit-gateway -n conduit-system --replicas=2', { stdio: 'inherit' });
    execSync('kubectl rollout status deployment/conduit-gateway -n conduit-system --timeout=90s', { stdio: 'inherit' });

    const getPods = () => {
      const raw = execSync("kubectl get pods -n conduit-system -l app.kubernetes.io/name=gateway,app.kubernetes.io/component=gateway -o jsonpath='{.items[*].metadata.name}'", { encoding: 'utf-8' });
      return raw.trim().split(/\s+/).filter(Boolean);
    };

    const initialPods = getPods();
    console.log('Gateway replicas active (' + initialPods.length + '):', initialPods);
    if (initialPods.length < 2) {
      throw new Error('Expected at least 2 gateway replicas');
    }

    const targetPodToKill = initialPods[0];
    console.log('Target pod to terminate under active traffic: ' + targetPodToKill);

    let successCount = 0;
    let failCount = 0;
    let killTriggered = false;

    console.log(`3. Starting MCP client loop: ${TOTAL_REQUESTS} requests over ${DURATION_SECONDS}s (~${REQ_PER_SEC} req/s)...`);
    const startTime = Date.now();

    for (let i = 1; i <= TOTAL_REQUESTS; i++) {
      const res = await sendMcpRequest(apiKey, i);
      if (res.ok) {
        successCount++;
      } else {
        failCount++;
        console.warn(`[WARN] Request #${i} failed:`, res);
      }

      if (i === Math.floor(TOTAL_REQUESTS / 2) && !killTriggered) {
        killTriggered = true;
        console.log(`\n[TRIGGER] Killing pod ${targetPodToKill} with DEFAULT grace period...`);
        try {
          execSync(`kubectl delete pod ${targetPodToKill} -n conduit-system &`, { stdio: 'ignore' });
        } catch (err) {
          console.error('Error initiating pod deletion:', err.message);
        }
      }

      await sleep(DELAY_MS);
    }

    const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n--- Resilience Kill Test Results (${durationSec}s) ---`);
    console.log(`Total Requests: ${TOTAL_REQUESTS}`);
    console.log(`Successes:      ${successCount}`);
    console.log(`Failures:       ${failCount}`);

    if (failCount > 2) {
      console.error(`FAILURE: Failed requests (${failCount}) exceeded threshold of 2!`);
      process.exitCode = 1;
    } else {
      console.log(`SUCCESS: Multi-replica gateway survived kill with only ${failCount} failed requests (acceptable threshold <= 2)!`);
    }
  } finally {
    console.log('4. Cleanup: deleting temporary API key and restoring 1 replica...');
    if (keyId && sessionCookie && csrfToken) {
      try {
        await deleteReq(`http://127.0.0.1/api/keys/${keyId}`, {
          host: 'dashboard.localhost',
          cookie: sessionCookie,
          'x-csrf-token': csrfToken,
        });
        console.log('Deleted temporary API key successfully.');
      } catch (err) {
        console.warn('Warning: failed to delete temp API key:', err.message);
      }
    }
    try {
      execSync('kubectl scale deployment conduit-gateway -n conduit-system --replicas=1', { stdio: 'inherit' });
      execSync('kubectl rollout status deployment/conduit-gateway -n conduit-system --timeout=90s', { stdio: 'inherit' });
      console.log('Scaled conduit-gateway back to 1 replica.');
    } catch (err) {
      console.warn('Warning: failed scaling back gateway replica:', err.message);
    }
  }
}

main().catch((err) => {
  console.error('Fatal error in multi-replica test:', err);
  process.exit(1);
});
