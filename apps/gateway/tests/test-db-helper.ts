export function getIsolatedTestDbUri(prefix: string): { dbName: string; uri: string } {
  const dbName = `conduit_test_${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const baseUri =
    process.env['TEST_MONGO_URI'] ||
    process.env['MONGO_URI'] ||
    'mongodb://root:rootpass@127.0.0.1:27017/conduit_test?authSource=admin';
  const uri = baseUri.replace(/\/([^/?]+)(\?|$)/, `/${dbName}$2`);
  return { dbName, uri };
}
