import { catalogMode } from './gemini-voice-catalog-data.js';
import { runMultilangCatalog } from './prepare-multilang-catalog.js';

// Legacy seed entrypoint is read-only; multilingual changes need the reviewed plan.
void (async () => {
  if (catalogMode(process.argv.slice(2)) === 'apply') throw new Error('USE_GUARDED_S32_5B_CATALOG_MIGRATION');
  await runMultilangCatalog(['--dry-run']);
})().catch(() => { console.error('GEMINI_SEED_READ_ONLY_USE_CATALOG_MULTILANG'); process.exitCode = 1; });
