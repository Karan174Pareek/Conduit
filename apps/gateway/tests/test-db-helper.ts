import { URL } from 'node:url';

export function getIsolatedTestDbUri(prefix: string): { dbName: string; uri: string } {
  const dbName = `conduit_test_${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const baseUri =
    process.env['TEST_MONGO_URI'] ||
    process.env['MONGO_URI'] ||
    'mongodb://127.0.0.1:27017';
  const parsed = new URL(baseUri);
  parsed.pathname = `/${dbName}`;
  return { dbName, uri: parsed.toString() };
}
