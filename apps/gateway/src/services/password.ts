import * as argon2 from '@node-rs/argon2';

// Standard OWASP-recommended Argon2id parameters
const HASH_OPTIONS: argon2.Options = {
  algorithm: argon2.Algorithm.Argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  outputLen: 32,
  parallelism: 1,
};

// Pre-computed dummy argon2id hash to ensure constant-time failure path when user not found
let dummyHashPromise: Promise<string> | null = null;

async function getDummyHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = argon2.hash('conduit_dummy_constant_time_string', HASH_OPTIONS);
  }
  return dummyHashPromise;
}

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, HASH_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export async function verifyDummy(password: string): Promise<boolean> {
  const dummy = await getDummyHash();
  try {
    await argon2.verify(dummy, password);
  } catch {
    // Ignore error
  }
  return false;
}
