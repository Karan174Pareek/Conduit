import { execSync } from 'node:child_process';
import http from 'node:http';

const TOTAL_REQUESTS = 100;
const DELAY_MS = 50;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendRequest() {
  return new Promise((resolve, reject) => {
    const req = http.get(
      'http://127.0.0.1/healthz',
      {
        headers: { host: 'gateway.localhost' },
        timeout: 3000,
      },
      (res) => {
        res.resume();
        if (res.statusCode === 200) {
          resolve(true);
        } else {
          resolve(false);
        }
      }
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    req.on('error', (err) => {
      reject(err);
    });
  });
}

async function main() {
  console.log('=== Multi-Replica Resilience & Pod Kill Drill ===');

  console.log('Scaling conduit-gateway to 2 replicas...');
  execSync('kubectl scale deployment conduit-gateway -n conduit-system --replicas=2', { stdio: 'inherit' });
  execSync('kubectl rollout status deployment/conduit-gateway -n conduit-system --timeout=90s', { stdio: 'inherit' });

  const getPods = () => {
    const raw = execSync("kubectl get pods -n conduit-system -l app.kubernetes.io/name=gateway,app.kubernetes.io/component=gateway -o jsonpath='{.items[*].metadata.name}'", { encoding: 'utf-8' });
    return raw.trim().split(/\s+/).filter(Boolean);
  };

  const initialPods = getPods();
  console.log(`Gateway replicas active (${initialPods.length}):`, initialPods);
  if (initialPods.length < 2) {
    throw new Error('Expected at least 2 gateway replicas');
  }

  const targetPodToKill = initialPods[0];
  console.log(`Selected target replica to terminate under active client loop: ${targetPodToKill}`);

  let successCount = 0;
  let failCount = 0;
  let killTriggered = false;

  console.log(`Starting client loop: ${TOTAL_REQUESTS} requests, ${DELAY_MS}ms interval...`);

  for (let i = 1; i <= TOTAL_REQUESTS; i++) {
    try {
      const ok = await sendRequest();
      if (ok) {
        successCount++;
      } else {
        failCount++;
        console.warn(`Request #${i} returned non-200`);
      }
    } catch (err) {
      failCount++;
      console.warn(`Request #${i} failed: ${err.message}`);
    }

    // Trigger kill at request 25
    if (i === 25 && !killTriggered) {
      killTriggered = true;
      console.log(`\n[TRIGGER] Killing pod ${targetPodToKill} while traffic is active...`);
      try {
        execSync(`kubectl delete pod ${targetPodToKill} -n conduit-system --grace-period=15 &`, { stdio: 'ignore' });
      } catch (err) {
        console.error('Error initiating pod deletion:', err.message);
      }
    }

    await sleep(DELAY_MS);
  }

  console.log('\n--- Multi-Replica Kill Test Results ---');
  console.log(`Total Requests: ${TOTAL_REQUESTS}`);
  console.log(`Successes:      ${successCount}`);
  console.log(`Failures:       ${failCount}`);

  // Scale back to 1 for dev values consistency
  console.log('Scaling gateway back to 1 replica...');
  execSync('kubectl scale deployment conduit-gateway -n conduit-system --replicas=1', { stdio: 'inherit' });
  execSync('kubectl rollout status deployment/conduit-gateway -n conduit-system --timeout=90s', { stdio: 'inherit' });

  if (failCount > 3) {
    console.error(`FAILURE: Failed requests (${failCount}) exceeded threshold of 3!`);
    process.exit(1);
  }

  console.log(`SUCCESS: Multi-replica gateway survived kill with only ${failCount} failed requests (acceptable threshold <= 3)!`);
}

main().catch((err) => {
  console.error('Fatal error in multi-replica test:', err);
  process.exit(1);
});