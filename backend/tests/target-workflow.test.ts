import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
Object.assign(process.env, { NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:1/target_mock_only', JWT_ACCESS_SECRET: randomBytes(48).toString('hex'), JWT_REFRESH_SECRET: randomBytes(48).toString('hex'), JWT_ACCESS_EXPIRES_IN: '15m', JWT_REFRESH_EXPIRES_IN: '1d' });
const { resolveTargetWorkflow } = await import('../src/services/target-workflow.service.js');
const { targetOperations } = await import('../src/services/target-operation.service.js');
const { Project } = await import('../src/models/Project.js');
const { ProcessingJob } = await import('../src/models/ProcessingJob.js');
const { AppError } = await import('../src/utils/app-error.js');
const source: any = { _id: 'transcript', languageCode: 'vi', status: 'READY', revision: 1 };
const project: any = { status: 'COMPLETED', sourceLanguage: 'vi' };
function evidence(target = 'en', mediaType: 'AUDIO' | 'VIDEO' = 'VIDEO'): any {
  return { mediaType, transcript: source,
    translations: [{ _id: `t-${target}`, transcriptId: 'transcript', sourceTranscriptRevision: 1, revision: 2, targetLanguage: target, status: 'READY' }],
    narrations: [{ _id: `n-${target}`, translationId: `t-${target}`, sourceTranslationRevision: 2, revision: 3, languageCode: target, status: 'READY', available: true }],
    results: mediaType === 'VIDEO' ? [{ _id: `r-${target}`, narrationId: `n-${target}`, sourceNarrationRevision: 3, languageCode: target, available: true }] : [], jobs: [], attempts: [] };
}
for (const target of ['ja', 'ko', 'zh']) test(`COMPLETED en does not complete new ${target}; workflow stages need exact target artifacts`, () => {
  const en = evidence();
  const empty = resolveTargetWorkflow(project, target, en);
  assert.equal(empty.status, 'NOT_STARTED'); assert.equal(empty.workflow.step, 'TRANSLATION'); assert.equal(empty.workflow.canResume, true);
  assert.deepEqual(empty.translationIds, []); assert.deepEqual(empty.narrationIds, []); assert.deepEqual(empty.resultIds, []);
  assert.equal(resolveTargetWorkflow(project, 'en', en).status, 'COMPLETED');
  const localized = evidence(target);
  localized.results = []; assert.equal(resolveTargetWorkflow(project, target, localized).status, 'AUDIO_READY');
  localized.narrations = []; assert.equal(resolveTargetWorkflow(project, target, localized).status, 'TRANSLATED');
  assert.equal(project.status, 'COMPLETED');
});
test('en COMPLETED / ja FAILED remain independent, progress=100 is never completion evidence', () => {
  const data = evidence(); data.translations.push(...evidence('ja').translations);
  data.jobs.push({ _id: 'failed-ja', type: 'TTS', targetLanguage: 'ja', sourceTranslationId: 't-ja', sourceTranslationRevision: 2, status: 'FAILED', progress: 100, errorMessage: 'TTS_TIMEOUT', createdAt: new Date() });
  assert.equal(resolveTargetWorkflow(project, 'en', data).status, 'COMPLETED');
  const ja = resolveTargetWorkflow(project, 'ja', data); assert.equal(ja.status, 'FAILED'); assert.equal(ja.workflow.step, 'VOICE'); assert.equal(ja.failureCode, 'TTS_TIMEOUT');
  data.jobs[0].targetLanguage = 'ko'; assert.equal(resolveTargetWorkflow(project, 'ja', data).status, 'TRANSLATED');
});
test('source revision, cross-language references, missing files and unresolved sources fail closed', () => {
  const data = evidence(); data.transcript = { ...source, revision: 2 };
  assert.equal(resolveTargetWorkflow(project, 'en', data).status, 'NOT_STARTED');
  const crossed = evidence(); crossed.results[0].languageCode = 'ja'; assert.equal(resolveTargetWorkflow(project, 'ja', crossed).status, 'NOT_STARTED');
  crossed.narrations[0].languageCode = 'ja'; assert.equal(resolveTargetWorkflow(project, 'en', crossed).status, 'TRANSLATED');
  const missing = evidence(); missing.narrations[0].available = false;
  const unavailable = resolveTargetWorkflow(project, 'en', missing); assert.equal(unavailable.status, 'FAILED'); assert.equal(unavailable.workflow.canResume, false);
  assert.equal(resolveTargetWorkflow({ ...project, sourceLanguageMode: 'AUTO', sourceLanguageStatus: 'NEEDS_CONFIRMATION', sourceLanguage: null }, 'en', evidence()).status, 'BLOCKED');
});
test('audio completion requires CURRENT audio; video completion requires CURRENT result', () => {
  assert.equal(resolveTargetWorkflow(project, 'en', evidence('en', 'AUDIO')).status, 'COMPLETED');
  const data = evidence(); data.results = []; assert.equal(resolveTargetWorkflow(project, 'en', data).status, 'AUDIO_READY');
});
test('draft review/expired/uncertain attempts never infer completed and do not rearm generation', () => {
  const data = evidence(); data.translations = []; data.narrations = []; data.results = [];
  data.attempts = [{ targetLanguage: 'ja', state: 'DRAFT', draftJson: JSON.stringify({ state: 'DRAFT', targetLanguage: 'ja', sourceLanguage: 'vi', transcriptId: 'transcript', transcriptRevision: 1, expiresAt: new Date(Date.now() + 60000).toISOString() }) }];
  assert.equal(resolveTargetWorkflow(project, 'ja', data).status, 'AWAITING_REVIEW');
  assert.equal(resolveTargetWorkflow(project, 'ko', data).status, 'NOT_STARTED');
  data.attempts = [{ targetLanguage: 'ja', state: 'UNCERTAIN' }];
  const uncertain = resolveTargetWorkflow(project, 'ja', data); assert.equal(uncertain.status, 'FAILED'); assert.equal(uncertain.workflow.canResume, false);
});

function installLock(t: test.TestContext) {
  let operation: any = null; let running = false; let releases = 0;
  t.mock.method(Project, 'findOneAndUpdate', async (filter: any, update: any) => {
    if (filter.userId !== 'owner' || operation) return null as never;
    operation = update.$set.targetOperation; return { status: 'COMPLETED' } as never;
  });
  t.mock.method(Project, 'exists', async (filter: any) => filter.userId === 'owner' ? {} as never : null);
  t.mock.method(Project, 'updateOne', async (filter: any) => {
    if (operation?.token !== filter['targetOperation.token']) return { matchedCount: 0 } as never;
    operation = null; releases++; return { matchedCount: 1 } as never;
  });
  t.mock.method(ProcessingJob, 'exists', async () => running ? {} as never : null);
  return { get operation() { return operation }, get releases() { return releases }, set running(value: boolean) { running = value } };
}
test('durable project CAS serializes different targets and double submit; token releases only the owner claim', async t => {
  const state = installLock(t); let release!: () => void;
  const gate = new Promise<void>(done => { release = done; }); let calls = 0;
  const first = targetOperations.run('project', 'owner', 'ja', 'TTS', async () => { calls++; await gate; return 'ja'; });
  while (!calls) await new Promise(done => setImmediate(done));
  for (const target of ['en', 'ja', 'ko', 'zh']) await assert.rejects(targetOperations.run('project', 'owner', target, 'TTS', async () => { calls++; }), (error: any) => error.code === 'PROJECT_TARGET_BUSY');
  release(); assert.equal(await first, 'ja'); assert.equal(state.operation, null); assert.equal(state.releases, 1); assert.equal(calls, 1);
  await targetOperations.run('project', 'owner', 'ko', 'TTS', async () => 'ko'); assert.equal(state.releases, 2);
});
test('existing jobs, other owner, nested wrong target and uncertain work are fail-closed', async t => {
  const state = installLock(t); let calls = 0;
  await assert.rejects(targetOperations.run('project', 'other', 'ja', 'TTS', async () => { calls++; }), (error: any) => error.code === 'PROJECT_NOT_FOUND');
  state.running = true; await assert.rejects(targetOperations.run('project', 'owner', 'ja', 'TTS', async () => { calls++; })); state.running = false;
  await targetOperations.run('project', 'owner', 'ja', 'TRANSLATION', async () => {
    await assert.rejects(targetOperations.run('project', 'owner', 'ko', 'TTS', async () => { calls++; }));
  });
  await assert.rejects(targetOperations.run('project', 'owner', 'ja', 'TRANSLATION', async () => { throw new AppError(502, 'TRANSLATION_ATTEMPT_UNCERTAIN', 'Uncertain'); }));
  assert.equal(state.operation.targetLanguage, 'ja'); assert.equal(calls, 0);
  await assert.rejects(targetOperations.run('project', 'owner', 'ko', 'TRANSLATION', async () => { calls++; }));
  const tts = installLock(t);
  await assert.rejects(targetOperations.run('project', 'owner', 'zh', 'TTS', async () => { throw new AppError(502, 'TTS_TIMEOUT', 'Uncertain'); }));
  assert.equal(tts.operation.targetLanguage, 'zh'); assert.equal(tts.releases, 0);
});

test('ambiguous TTS dispatch retains durable fence and blocks a new target', async t => {
  const state = installLock(t); let calls = 0;
  await assert.rejects(targetOperations.run('project', 'owner', 'en', 'TTS', async () => { throw new AppError(502, 'TTS_UNCERTAIN', 'Uncertain'); }));
  assert.equal(state.operation.targetLanguage, 'en'); assert.equal(state.releases, 0);
  await assert.rejects(targetOperations.run('project', 'owner', 'ja', 'TTS', async () => { calls++; }));
  assert.equal(calls, 0);
});
