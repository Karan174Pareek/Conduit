#!/usr/bin/env node
/* eslint-env node */
/* eslint-disable no-undef, no-empty */
import { spawn, execSync } from 'node:child_process';
import crypto from 'node:crypto';
import net from 'node:net';

function getAvailablePort(startPort = 28000, endPort = 30000) {
  return new Promise((resolve, reject) => {
    const port = Math.floor(Math.random() * (endPort - startPort + 1)) + startPort;
    const server = net.createServer();
    server.unref();
    server.on('error', () => {
      // Retry with another random port
      getAvailablePort(startPort, endPort).then(resolve, reject);
    });
    server.listen(port, () => {
      server.close(() => resolve(port));
    });
  });
}

async function waitForMongo(containerName, timeoutMs = 25000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    try {
      execSync(`docker exec "${containerName}" mongosh --quiet --eval "db.adminCommand('ping')"`, {
        stdio: 'pipe',
      });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`Timed out waiting for throwaway Mongo container ${containerName}`);
}

async function main() {
  const forwardedArgs = process.argv.slice(2);

  // If TEST_MONGO_URI or MONGO_URI is explicitly set (e.g. In CI with a service container), use it directly
  if (process.env.TEST_MONGO_URI || process.env.CI_MONGO_URI) {
    const uri = process.env.TEST_MONGO_URI || process.env.CI_MONGO_URI;
    const proc = spawn('npx', ['vitest', 'run', ...forwardedArgs], {
      stdio: 'inherit',
      env: { ...process.env, TEST_MONGO_URI: uri, MONGO_URI: uri },
    });
    proc.on('exit', (code) => process.exit(code || 0));
    return;
  }

  // Generate random credentials and port for throwaway container
  const port = await getAvailablePort();
  const user = 'test_' + crypto.randomBytes(4).toString('hex');
  const pass = crypto.randomBytes(16).toString('hex');
  const containerName = `conduit-test-mongo-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;

  console.log(`[test-runner] Starting isolated throwaway MongoDB container on port ${port}...`);

  try {
    execSync(
      `docker run -d --rm --name "${containerName}" -p ${port}:27017 ` +
        `-e MONGO_INITDB_ROOT_USERNAME="${user}" ` +
        `-e MONGO_INITDB_ROOT_PASSWORD="${pass}" ` +
        `mongo:7`,
      { stdio: 'pipe' },
    );

    await waitForMongo(containerName);
    console.log(`[test-runner] Throwaway MongoDB ready on port ${port}. Running test suite...`);

    const mongoUri = `mongodb://${user}:${pass}@127.0.0.1:${port}/?authSource=admin`;

    const proc = spawn('npx', ['vitest', 'run', ...forwardedArgs], {
      stdio: 'inherit',
      env: {
        ...process.env,
        TEST_MONGO_URI: mongoUri,
        MONGO_URI: mongoUri,
      },
    });

    proc.on('exit', (code) => {
      try {
        console.log(`[test-runner] Cleaning up throwaway container ${containerName}...`);
        execSync(`docker rm -f "${containerName}"`, { stdio: 'pipe' });
      } catch {}
      process.exit(code || 0);
    });
  } catch (err) {
    try {
      execSync(`docker rm -f "${containerName}"`, { stdio: 'pipe' });
    } catch {}
    console.error(`[test-runner] Failed to start throwaway MongoDB container:`, err.message);
    process.exit(1);
  }
}

main();
