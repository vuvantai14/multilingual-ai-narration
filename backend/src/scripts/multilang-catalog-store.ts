import mongoose, { type mongo } from 'mongoose';
import { createHash } from 'node:crypto';
import { hasVoiceUniqueIndex, verifyGeminiTarget } from './gemini-voice-catalog-data.js';
import { CatalogMigrationError, REFERENCE_FIELDS, REVIEWED_COLLECTIONS, referenceEvidence, catalogDigest,
  planMultilangCatalog, assertMigrationApproval, type Snapshot, type Row, type MigrationOptions } from './multilang-catalog-plan.js';

export async function verifyAtlasIdentity(db: mongo.Db, uri: string, environment?: string, provider?: string) {
  verifyGeminiTarget(uri, environment, provider);
  const hello = await db.admin().command({ hello: 1 });
  if (db.databaseName !== 'multilingual_ai_narration' || hello.isWritablePrimary !== true || typeof hello.setName !== 'string'
    || !Array.isArray(hello.hosts) || !hello.hosts.length || !hello.hosts.every((host: unknown) => typeof host === 'string' && /^[a-z0-9.-]+\.mongodb\.net(?::\d+)?$/i.test(host))) throw new CatalogMigrationError('ATLAS_TARGET_UNVERIFIED');
  // Identity excludes credentials, URI options and private values; print only the hash.
  return createHash('sha256').update(JSON.stringify([new URL(uri).hostname, db.databaseName, hello.setName, [...hello.hosts].sort()])).digest('hex');
}
export async function readCatalogSnapshot(db: mongo.Db, targetIdentity: string, session?: mongo.ClientSession, knownCollections?: string[]): Promise<Snapshot> {
  const collections = knownCollections ?? (await db.listCollections({}, { nameOnly: true }).toArray()).map(row => row.name).sort();
  if (!collections.includes('languages') || !collections.includes('voices')) throw new CatalogMigrationError('REQUIRED_CATALOG_COLLECTION_MISSING');
  // Sequential operations also work inside a transaction; no model init/DDL.
  const languages = await db.collection('languages').find({}, { session }).toArray() as Row[];
  const voices = await db.collection('voices').find({}, { session }).toArray() as Row[];
  const frenchIds = languages.filter(row => typeof row.code === 'string' && row.code.trim().toLowerCase() === 'fr').map(row => String(row._id));
  const frenchVoiceIds = voices.filter(row => frenchIds.includes(String(row.languageId))).map(row => String(row._id));
  const references: Snapshot['references'] = [], counts: Record<string, number> = {};
  const projection = Object.fromEntries(['_id', ...REFERENCE_FIELDS].map(field => [field, 1]));
  for (const collection of collections) {
    counts[collection] = await db.collection(collection).countDocuments({}, { session });
    if (['languages', 'voices'].includes(collection)) continue;
    if (!REVIEWED_COLLECTIONS.includes(collection)) {
      references.push({ collection, checked: 0, references: 0, invalid: 1, sampleIds: [] }); continue;
    }
    const evidence = { collection, checked: 0, references: 0, invalid: 0, sampleIds: [] as string[] };
    const cursor = db.collection(collection).find({}, { projection, session, batchSize: 100, maxTimeMS: 30000 });
    try {
      for await (const document of cursor) {
        const row = referenceEvidence(collection, [document as Row], frenchIds, frenchVoiceIds);
        evidence.checked += row.checked; evidence.references += row.references; evidence.invalid += row.invalid;
        evidence.sampleIds.push(...row.sampleIds.slice(0, Math.max(0, 5 - evidence.sampleIds.length)));
      }
    } finally { await cursor.close(); }
    references.push(evidence);
  }
  const activeJobs = collections.includes('processingjobs') ? await db.collection('processingjobs').countDocuments({ status: { $in: ['QUEUED', 'PROCESSING'] } }, { session }) : 0;
  const activeProjects = collections.includes('projects') ? await db.collection('projects').countDocuments({ targetOperation: { $exists: true, $ne: null } }, { session }) : 0;
  // Index evidence is read outside the transaction, revalidated before starting it.
  const languageIndexes = session ? [] : await db.collection('languages').indexes();
  const voiceIndexes = session ? [] : await db.collection('voices').indexes();
  return { targetIdentity, languages, voices, collections, counts, references, activeWork: activeJobs + activeProjects,
    languageIndex: languageIndexes.some(index => index.unique === true && Object.keys(index.key).length === 1 && index.key.code === 1 && !index.sparse && !index.partialFilterExpression && !index.collation),
    voiceIndex: hasVoiceUniqueIndex(voiceIndexes) };
}

export type CatalogMigrationStore = {
  read(): Promise<Snapshot>;
  transaction<T>(work: (store: CatalogTransactionStore) => Promise<T>): Promise<T>;
};
export type CatalogTransactionStore = { read(): Promise<Snapshot>;
  insert(document: Record<string, unknown>): Promise<boolean>;
  remove(collection: 'languages' | 'voices', exactDocument: Row): Promise<boolean> };

export async function executeCatalogMigration(store: CatalogMigrationStore, options: MigrationOptions) {
  assertMigrationApproval(options); // Missing approval fails before any DB access.
  const before = await store.read(), plan = planMultilangCatalog(before);
  let inserted = 0, deleted = 0;
  if (options.apply) {
    assertMigrationApproval(options, plan);
    await store.transaction(async transaction => {
      const current = planMultilangCatalog(await transaction.read());
      assertMigrationApproval(options, current);
      for (const item of current.create) {
        if (!await transaction.insert(item.document)) throw new CatalogMigrationError('CONCURRENT_CATALOG_CHANGE');
        inserted++;
      }
      // Exact documents only; voices first, then their unreferenced Language.
      for (const item of current.remove) {
        if (!await transaction.remove(item.collection, item.document)) throw new CatalogMigrationError('CONCURRENT_CATALOG_CHANGE');
        deleted++;
      }
    });
  }
  const after = await store.read();
  const catalogUnchanged = catalogDigest(before.languages, before.voices) === catalogDigest(after.languages, after.voices);
  if (!options.apply && !catalogUnchanged) throw new CatalogMigrationError('CATALOG_CHANGED_DURING_DRY_RUN');
  if (!options.apply && planMultilangCatalog(after).digest !== plan.digest) throw new CatalogMigrationError('PREFLIGHT_CHANGED_DURING_DRY_RUN');
  const removedIds = new Set(plan.remove.map(item => String(item.document._id)));
  const createdKeys = new Set(plan.create.map(item => `${item.document.provider}|${item.document.providerVoiceId}|${String(item.document.languageId)}`));
  const preserved = catalogDigest(before.languages.filter(row => !removedIds.has(String(row._id))), before.voices.filter(row => !removedIds.has(String(row._id))))
    === catalogDigest(after.languages, after.voices.filter(row => !createdKeys.has(`${row.provider}|${row.providerVoiceId}|${String(row.languageId)}`)));
  if (options.apply) {
    const checked = planMultilangCatalog(after);
    if (!preserved || checked.conflict || checked.planned || checked.remove.length || after.voices.length !== plan.expectedAfter.voices || after.languages.length !== plan.expectedAfter.languages) throw new CatalogMigrationError('POST_APPLY_VERIFICATION_FAILED_DO_NOT_RETRY');
  }
  return { mode: options.apply ? 'apply' : 'dry-run', plan, inserted, deleted, databaseWrites: inserted + deleted,
    catalogUnchanged, protectedCatalogPreserved: options.apply ? preserved : catalogUnchanged, collectionCountsUnchanged: JSON.stringify(before.counts) === JSON.stringify(after.counts),
    after: { languages: after.languages.length, voices: after.voices.length, gemini: after.voices.filter(row => row.provider === 'gemini').length, openai: after.voices.filter(row => row.provider === 'openai').length } };
}

export function nativeCatalogStore(client: mongo.MongoClient, db: mongo.Db, identity: string): CatalogMigrationStore {
  return {
    read: () => readCatalogSnapshot(db, identity),
    async transaction(work) {
      // Recheck all evidence before the transaction. Writers must be stopped by
      // the operator: snapshot reads do not prevent new foreign references.
      const reviewed = await readCatalogSnapshot(db, identity);
      const session = client.startSession(); let commitAttempted = false;
      try {
        session.startTransaction({ readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority', j: true } });
        const value = await work({
          async read() {
            const snapshot = await readCatalogSnapshot(db, identity, session, reviewed.collections);
            return { ...snapshot, languageIndex: reviewed.languageIndex, voiceIndex: reviewed.voiceIndex };
          },
          async insert(document) {
            const { provider, providerVoiceId, languageId } = document;
            const now = new Date();
            const result = await db.collection('voices').updateOne({ provider, providerVoiceId, languageId },
              { $setOnInsert: { ...document, createdAt: now, updatedAt: now } }, { upsert: true, session });
            return result.upsertedCount === 1;
          },
          async remove(collection, document) {
            if (!document._id) throw new CatalogMigrationError('EXACT_DELETE_KEY_REQUIRED');
            const result = await db.collection(collection).deleteOne(document as unknown as mongo.Filter<mongo.Document>, { session });
            return result.deletedCount === 1;
          },
        });
        commitAttempted = true; await session.commitTransaction(); return value;
      } catch (error) {
        if (commitAttempted) throw new CatalogMigrationError('COMMIT_OUTCOME_UNCERTAIN_DO_NOT_RETRY');
        if (session.inTransaction()) await session.abortTransaction();
        throw error;
      } finally { await session.endSession(); }
    },
  };
}
export const openCatalogClient = (uri: string) => new mongoose.mongo.MongoClient(uri, { retryWrites: false, retryReads: false, serverSelectionTimeoutMS: 10000 });
