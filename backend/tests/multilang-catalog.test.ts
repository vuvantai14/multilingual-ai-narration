import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import mongoose, { Types } from 'mongoose';
import { LANGUAGE_CATALOG, planLanguageCatalog } from '../src/scripts/language-catalog-data.js';
import { GEMINI_VOICE_CATALOG, GEMINI_VOICE_DOCUMENTS } from '../src/scripts/gemini-voice-catalog-data.js';
import { REVIEWED_COLLECTIONS, referenceEvidence, planMultilangCatalog, migrationOptions, assertMigrationApproval,
  catalogDigest, type Snapshot, type Row } from '../src/scripts/multilang-catalog-plan.js';
import { executeCatalogMigration, nativeCatalogStore, type CatalogMigrationStore } from '../src/scripts/multilang-catalog-store.js';

function baseline(): Snapshot {
  const languages: Row[] = [...LANGUAGE_CATALOG, { code: 'fr', name: 'French', nativeName: 'Français', isActive: true }].map(row => ({ ...row, _id: new Types.ObjectId() }));
  const voices: Row[] = languages.flatMap(language => ['coral', 'alloy', 'nova', 'echo', 'onyx', 'fable'].map((name, i) => ({ _id: new Types.ObjectId(), languageId: language._id, provider: 'openai', providerVoiceId: name, name, gender: i < 3 ? 'FEMALE' : 'MALE', isActive: true })));
  voices.push(...GEMINI_VOICE_CATALOG.map(row => ({ ...row, _id: new Types.ObjectId(), languageId: languages.find(row => row.code === 'en')!._id })));
  return { targetIdentity: 'a'.repeat(64), languages, voices, languageIndex: true, voiceIndex: true, collections: [...REVIEWED_COLLECTIONS].sort(),
    references: REVIEWED_COLLECTIONS.filter(name => !['languages', 'voices'].includes(name)).map(collection => ({ collection, checked: 0, references: 0, invalid: 0, sampleIds: [] })),
    counts: Object.fromEntries(REVIEWED_COLLECTIONS.map(name => [name, name === 'voices' ? 38 : name === 'languages' ? 6 : 0])), activeWork: 0 };
}
const copy = (snapshot: Snapshot): Snapshot => ({ ...snapshot, languages: snapshot.languages.map(row => ({ ...row })), voices: snapshot.voices.map(row => ({ ...row })), counts: { ...snapshot.counts } });
function memoryStore(initial = baseline()) {
  let state = copy(initial), writes = 0, transactions = 0;
  const store: CatalogMigrationStore = {
    async read() { return copy(state); },
    async transaction(work) {
      transactions++; const old = copy(state);
      try { return await work({ read: () => store.read(), async insert(document) {
        if (state.voices.some(row => row.provider === document.provider && row.providerVoiceId === document.providerVoiceId && String(row.languageId) === String(document.languageId))) return false;
        state.voices.push({ ...document, _id: new Types.ObjectId() }); state.counts.voices!++; writes++; return true;
      }, async remove(collection, document) {
        const rows = state[collection]; const index = rows.findIndex(row => catalogDigest([row], []) === catalogDigest([document], []));
        if (index < 0) return false; rows.splice(index, 1); state.counts[collection]!--; writes++; return true;
      } }); } catch (error) { state = old; throw error; }
    },
  };
  return { store, get writes() { return writes; }, get transactions() { return transactions; } };
}
const approved = (plan: ReturnType<typeof planMultilangCatalog>) => ({ apply: true, approval: 'S32.5B', maintenance: true, plan: plan.digest, target: plan.targetIdentity });

test('five language codes and eight Gemini documents; canonical zh, no vi/fr Gemini, seeds cannot reintroduce fr', async () => {
  assert.deepEqual(LANGUAGE_CATALOG.map(row => row.code), ['vi', 'en', 'ja', 'ko', 'zh']);
  assert.equal(GEMINI_VOICE_DOCUMENTS.length, 8); assert.equal(new Set(GEMINI_VOICE_DOCUMENTS.map(row => `${row.provider}|${row.providerVoiceId}|${row.languageCode}`)).size, 8);
  for (const target of ['en', 'ja', 'ko', 'zh']) assert.deepEqual(GEMINI_VOICE_DOCUMENTS.filter(row => row.languageCode === target).map(row => [row.name, row.gender]), [['Kore', 'FEMALE'], ['Fenrir', 'MALE']]);
  assert.ok(!planLanguageCatalog([]).create.some(row => String(row.code) === 'fr'));
  const seed = await readFile(new URL('../src/scripts/seed-voice-catalog.ts', import.meta.url), 'utf8');
  assert.match(seed, /code: \{ \$in: LANGUAGE_CATALOG/);
  const retired = await readFile(new URL('../scripts/clean-catalog.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(retired, /connectDatabase|deleteMany|\.create\(|\.save\(/);
});

test('baseline plan is six inserts, two existing and exactly seven French removals; dry-run invokes no mutation', async () => {
  const f = memoryStore(); const before = await f.store.read();
  const report = await executeCatalogMigration(f.store, migrationOptions([]));
  assert.equal(report.plan.planned, 6); assert.equal(report.plan.existing, 2); assert.equal(report.plan.conflict, 0);
  assert.equal(report.plan.remove.length, 7); assert.equal(report.plan.eligibleFrench.length, 7);
  assert.deepEqual(report.plan.expectedAfter, { languages: 5, voices: 38, gemini: 8, openai: 30 });
  assert.equal(report.databaseWrites, 0); assert.equal(report.catalogUnchanged, true); assert.equal(f.writes, 0); assert.equal(f.transactions, 0);
  assert.equal(catalogDigest(before.languages, before.voices), catalogDigest((await f.store.read()).languages, (await f.store.read()).voices));
});

test('native dry-run adapter has no mutation/session/DDL path and reads only projected business fields', async () => {
  const state = baseline();
  const db = { listCollections: () => ({ toArray: async () => state.collections.map(name => ({ name })) }), collection: (name: string) => ({
    countDocuments: async (filter: any) => Object.keys(filter).length ? 0 : state.counts[name],
    indexes: async () => name === 'voices' ? [{ unique: true, key: { provider: 1, providerVoiceId: 1, languageId: 1 } }] : [{ unique: true, key: { code: 1 } }],
    find: (_filter: any, options: any) => {
      if (!['languages', 'voices'].includes(name)) {
        assert.equal(options.projection.draftJson, 1);
        for (const secret of ['passwordHash', 'token', 'accessToken', 'refreshToken', 'fullText']) assert.equal(options.projection[secret], undefined);
      }
      const rows = name === 'voices' ? state.voices : name === 'languages' ? state.languages : [];
      return { toArray: async () => rows, async *[Symbol.asyncIterator]() { yield* rows; }, async close() {} };
    }, updateOne: () => assert.fail('NO_WRITE'), deleteOne: () => assert.fail('NO_DELETE'), createIndex: () => assert.fail('NO_DDL'),
  }) };
  const client = { startSession: () => assert.fail('DRY_RUN_HAS_NO_TRANSACTION') };
  const result = await executeCatalogMigration(nativeCatalogStore(client as any, db as any, state.targetIdentity), migrationOptions([]));
  assert.equal(result.plan.conflict, 0); assert.equal(result.plan.planned, 6); assert.equal(result.databaseWrites, 0);
});

test('approved in-memory apply is insert-only/idempotent and preserves English + all non-French OpenAI documents', async () => {
  const f = memoryStore(), before = await f.store.read();
  const report = await executeCatalogMigration(f.store, approved(planMultilangCatalog(before)));
  assert.equal(report.inserted, 6); assert.equal(report.deleted, 7); assert.equal(report.protectedCatalogPreserved, true);
  assert.deepEqual(report.after, { languages: 5, voices: 38, gemini: 8, openai: 30 });
  const after = await f.store.read(), second = planMultilangCatalog(after);
  assert.equal(second.planned, 0); assert.equal(second.existing, 8); assert.equal(second.conflict, 0); assert.equal(second.remove.length, 0);
  assert.equal((await executeCatalogMigration(f.store, approved(second))).databaseWrites, 0);
  const en = String(before.languages.find(row => row.code === 'en')!._id);
  assert.deepEqual(after.voices.filter(row => String(row.languageId) === en), before.voices.filter(row => String(row.languageId) === en));
});

test('missing approval is denied before reads; stale target/digest and references deny all writes', async () => {
  const options = migrationOptions(['--apply']); let reads = 0;
  await assert.rejects(executeCatalogMigration({ read: async () => { reads++; return baseline(); }, transaction: async () => assert.fail() }, options), /APPROVAL/);
  assert.equal(reads, 0);
  for (const mutation of [
    (s: Snapshot) => { s.references[0]!.references = 1; },
    (s: Snapshot) => { s.references[0]!.invalid = 1; },
    (s: Snapshot) => { s.voiceIndex = false; },
    (s: Snapshot) => { s.languageIndex = false; },
    (s: Snapshot) => { s.activeWork = 1; },
    (s: Snapshot) => { s.collections.push('unreviewed'); },
    (s: Snapshot) => { s.references.pop(); },
    (s: Snapshot) => { s.references[0]!.checked = 2; },
    (s: Snapshot) => { s.languages.find(row => row.code === 'ja')!.isActive = false; },
    (s: Snapshot) => { s.targetIdentity = 'unverified'; },
    (s: Snapshot) => { s.voices.push({ ...s.voices[0]!, _id: new Types.ObjectId() }); },
    (s: Snapshot) => { s.voices.find(row => row.provider === 'gemini')!.isActive = false; },
  ]) {
    const state = baseline(); mutation(state); const f = memoryStore(state), plan = planMultilangCatalog(state);
    assert.ok(plan.conflict > 0); assert.equal(plan.eligibleFrench.length, 0);
    await assert.rejects(executeCatalogMigration(f.store, approved(plan))); assert.equal(f.writes, 0); assert.equal(f.transactions, 0);
  }
  const state = baseline(), f = memoryStore(state), plan = planMultilangCatalog(state);
  for (const patch of [{ plan: 'b'.repeat(64) }, { target: 'c'.repeat(64) }, { maintenance: false }]) await assert.rejects(executeCatalogMigration(f.store, { ...approved(plan), ...patch }));
  assert.equal(f.writes, 0);
});

test('references include nested attempts, language arrays, voice IDs, entity IDs and visitor URLs; invalid drafts block', () => {
  const language = new Types.ObjectId(), voice = new Types.ObjectId();
  const rows = [{ sourceLanguage: 'fr' }, { detectedSourceLanguage: 'FR' }, { languages: ['en', 'fr'] },
    { voiceId: voice }, { entityType: 'Voice', entityId: voice }, { languageId: language },
    { draftJson: JSON.stringify({ targetLanguage: 'fr', groups: [] }) }, { targetPath: '/x?language=fr' },
    { targetOperation: { targetLanguage: 'fr' } }, { targetPath: '/x?language=%66%72' }, { languageCode: 'fr-FR' }].map(row => ({ ...row, _id: new Types.ObjectId() }));
  const evidence = referenceEvidence('fixtures', rows, [String(language)], [String(voice)]);
  assert.equal(evidence.references, rows.length); assert.equal(evidence.sampleIds.length, 5);
  assert.equal(referenceEvidence('fixtures', [{ _id: 'x', draftJson: '{invalid' }], [], []).invalid, 1);
  assert.equal(referenceEvidence('fixtures', [{ _id: 'x', draftJson: JSON.stringify({ targetLanguage: 'zh', fullText: 'fr' }) }], [], []).references, 0);
});

test('transaction rechecks references and exact plan; concurrent catalog change causes zero writes', async () => {
  const state = baseline(), plan = planMultilangCatalog(state); let writes = 0;
  const concurrent = copy(state); concurrent.references = concurrent.references.map(row => ({ ...row, references: row.collection === 'projects' ? 1 : 0 }));
  await assert.rejects(executeCatalogMigration({ read: async () => state, transaction: async work => work({ read: async () => concurrent,
    insert: async () => { writes++; return true; }, remove: async () => { writes++; return true; } }) }, approved(plan)));
  assert.equal(writes, 0);
});

test('unknown commit outcome is propagated once without automatically replaying the migration', async () => {
  const f = memoryStore(), initial = await f.store.read(); let commits = 0;
  const store: CatalogMigrationStore = { read: f.store.read, async transaction(work) {
    await f.store.transaction(work); commits++; throw Error('COMMIT_OUTCOME_UNCERTAIN_DO_NOT_RETRY');
  } };
  await assert.rejects(executeCatalogMigration(store, approved(planMultilangCatalog(initial))), /UNCERTAIN/);
  assert.equal(commits, 1); assert.equal(f.writes, 13);
});

test('dry-run aborts when catalog evidence changes during its reads', async () => {
  const state = baseline(); let reads = 0;
  await assert.rejects(executeCatalogMigration({ async read() {
    const value = copy(state); if (++reads > 1) value.voices[0]!.name = 'changed'; return value;
  }, transaction: async () => assert.fail('NO_WRITES') }, migrationOptions([])), /CHANGED_DURING_DRY_RUN/);
});

Object.assign(process.env, { NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:1/catalog_mock_only', TTS_PROVIDER: 'gemini',
  JWT_ACCESS_SECRET: randomBytes(48).toString('hex'), JWT_REFRESH_SECRET: randomBytes(48).toString('hex'), JWT_ACCESS_EXPIRES_IN: '15m', JWT_REFRESH_EXPIRES_IN: '1d' });
const { Voice } = await import('../src/models/Voice.js');
const { Language } = await import('../src/models/Language.js');
const { Project } = await import('../src/models/Project.js');
const { targetOperations } = await import('../src/services/target-operation.service.js');
const { generate } = await import('../src/services/narration.service.js');
const { listActiveVoices } = await import('../src/services/voice-catalog.service.js');
const { getTtsProvider } = await import('../src/services/tts/tts.service.js');
const { GeminiTtsProvider } = await import('../src/services/tts/gemini-tts.provider.js');
const { OpenAiTtsProvider } = await import('../src/services/tts/openai-tts.provider.js');
const query = (value: any): any => ({ select() { return this; }, sort() { return this; }, then: (done: any, reject: any) => Promise.resolve(value).then(done, reject) });
for (const target of ['en', 'ja', 'ko', 'zh']) test(`voice catalog ${target}: active Gemini target filter, language passed unchanged to Gemini only`, async t => {
  t.mock.method(mongoose, 'connect', () => { throw Error('NO_DB'); });
  t.mock.method(globalThis, 'fetch', () => { throw Error('NO_NETWORK'); });
  const languageId = new Types.ObjectId();
  t.mock.method(Language, 'find', (filter: any) => { assert.deepEqual(filter, { isActive: true, code: target }); return query([{ _id: languageId, code: target }]); });
  t.mock.method(Voice, 'find', (filter: any) => { assert.equal(filter.isActive, true); assert.equal(filter.provider, 'gemini'); assert.deepEqual(filter.languageId.$in, [languageId]); return query(GEMINI_VOICE_CATALOG.map(row => ({ ...row, _id: new Types.ObjectId(), languageId }))); });
  assert.equal((await listActiveVoices(target)).voices.length, 2);
  t.mock.method(OpenAiTtsProvider.prototype, 'synthesize', () => assert.fail('OPENAI_FORBIDDEN'));
  t.mock.method(GeminiTtsProvider.prototype, 'synthesize', async input => { assert.equal(input.language, target); assert.equal(input.voice, 'Kore'); return { audio: new Uint8Array([1]), format: 'mp3', mimeType: 'audio/mpeg', provider: 'gemini' }; });
  assert.equal((await getTtsProvider().synthesize({ text: 'fixture', language: target, voice: 'Kore', format: 'mp3' })).provider, 'gemini');
});

test('TTS rejects wrong-language, inactive and OpenAI voice before any provider call; fallback stays Gemini', async t => {
  t.mock.method(targetOperations, 'run', async (_p, _o, _l, _k, work) => work());
  t.mock.method(Project, 'findOne', () => query({ _id: new Types.ObjectId(), status: 'COMPLETED' }));
  const languageId = new Types.ObjectId();
  t.mock.method(Language, 'findOne', () => query({ _id: languageId, code: 'ja', isActive: true }));
  t.mock.method(GeminiTtsProvider.prototype, 'synthesize', () => assert.fail('NO_TTS'));
  t.mock.method(OpenAiTtsProvider.prototype, 'synthesize', () => assert.fail('NO_OPENAI'));
  const base = { _id: new Types.ObjectId(), languageId, isActive: true, provider: 'gemini', providerVoiceId: 'Kore' };
  for (const [patch, code] of [[{ languageId: new Types.ObjectId() }, 'VOICE_NOT_SUPPORTED'], [{ isActive: false }, 'VOICE_INACTIVE'], [{ provider: 'openai' }, 'VOICE_NOT_SUPPORTED']] as const) {
    t.mock.method(Voice, 'findById', () => query({ ...base, ...patch }));
    await assert.rejects(generate('project', 'owner', 'ja', 'voice'), (error: any) => error.code === code);
  }
  t.mock.method(Voice, 'findOne', (filter: any) => { assert.equal(filter.provider, 'gemini'); assert.equal(filter.isActive, true); return query(null); });
  await assert.rejects(generate('project', 'owner', 'ja'), (error: any) => error.code === 'VOICE_NOT_FOUND');
});

test('CLI refuses conflicting flags and apply requires approval, plan, target and maintenance', () => {
  assert.equal(migrationOptions([]).apply, false);
  for (const args of [['--apply', '--dry-run'], ['--unknown'], ['--apply', '--apply'], ['--approve=S32.5A'], ['--approve=S32.5B=extra']]) assert.throws(() => migrationOptions(args));
  assert.throws(() => assertMigrationApproval(migrationOptions(['--apply'])));
});
