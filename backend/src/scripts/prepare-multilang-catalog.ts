import dotenv from 'dotenv';
import { pathToFileURL } from 'node:url';
import { migrationOptions, assertMigrationApproval, CatalogMigrationError } from './multilang-catalog-plan.js';
import { openCatalogClient, verifyAtlasIdentity, nativeCatalogStore, executeCatalogMigration } from './multilang-catalog-store.js';
import { verifyGeminiTarget, GeminiCatalogError } from './gemini-voice-catalog-data.js';

export async function runMultilangCatalog(args: string[]) {
  const options = migrationOptions(args); assertMigrationApproval(options);
  dotenv.config({ quiet: true });
  verifyGeminiTarget(process.env.MONGODB_URI, process.env.NODE_ENV, process.env.TTS_PROVIDER);
  const uri = process.env.MONGODB_URI!;
  const client = openCatalogClient(uri);
  try {
    await client.connect(); const db = client.db();
    const identity = await verifyAtlasIdentity(db, uri, process.env.NODE_ENV, process.env.TTS_PROVIDER);
    const result = await executeCatalogMigration(nativeCatalogStore(client, db, identity), options);
    const { plan } = result;
    // Only catalog identifiers/metadata and aggregate evidence, never URI/secrets/draft text.
    const report = { ...result, plan: { ...plan,
      create: plan.create.map(item => ({ language: item.languageCode, languageId: String(item.document.languageId), provider: item.document.provider, providerVoiceId: item.document.providerVoiceId, gender: item.document.gender, isActive: item.document.isActive })),
      remove: plan.remove.map(item => ({ collection: item.collection, id: String(item.document._id), code: item.document.code, provider: item.document.provider, providerVoiceId: item.document.providerVoiceId, languageId: item.document.languageId ? String(item.document.languageId) : undefined })),
      eligibleFrench: plan.eligibleFrench.map(item => ({ collection: item.collection, id: String(item.document._id) })),
    } };
    console.info(JSON.stringify(report, null, 2));
    if (plan.conflict) throw new CatalogMigrationError('PREFLIGHT_BLOCKED_NO_WRITES');
    return report;
  } finally { await client.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runMultilangCatalog(process.argv.slice(2)).catch(error => {
    console.error(error instanceof CatalogMigrationError || error instanceof GeminiCatalogError ? error.message : 'CATALOG_OPERATION_FAILED_REVIEW_BEFORE_RETRY');
    process.exitCode = 1;
  });
}
