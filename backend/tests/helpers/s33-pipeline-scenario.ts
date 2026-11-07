import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import mongoose from 'mongoose';
import { memoryNative } from './e2e-memory-native.js';

const kind = process.argv[2] ?? 'mp4', audioOnly = ['mp3', 'mp3-cover', 'mp4-audio'].includes(kind), mp3Input = ['mp3', 'mp3-cover'].includes(kind);
mkdirSync('.tmp', { recursive: true });
const root = mkdtempSync(resolve('.tmp', 's33-')), oid = (v: string) => new mongoose.mongo.ObjectId(v);
Object.assign(process.env, { NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:1/isolated_no_network', JWT_ACCESS_SECRET: randomBytes(32).toString('hex'), JWT_REFRESH_SECRET: randomBytes(32).toString('hex'), JWT_ACCESS_EXPIRES_IN: '15m', JWT_REFRESH_EXPIRES_IN: '1d', UPLOAD_DIR: root, STT_PROVIDER: 'gemini', TTS_PROVIDER: 'gemini', TRANSLATION_PROVIDER: 'gemini', CUSTOMER_TRANSLATION_ENABLED: 'true', CUSTOMER_TRANSLATION_METHOD: 'GEMINI_SIMPLE_V1', GEMINI_API_KEY: 'isolated-synthetic-key', MAX_UPLOAD_SIZE_MB: '2' });
for (const key of ['S32_E2E_TEST_RUN_ENABLED', 'CONTROLLED_PROVIDER_MODE', 'GROUP_TRANSLATION_ENABLED', 'TTS_MODEL', 'GEMINI_STT_MODEL']) delete process.env[key];
const db = memoryNative(), ownerId = '2'.repeat(24), voiceId = '3'.repeat(24), languageId = '4'.repeat(24);
db.seed('users', { _id: oid(ownerId), name: 'Isolated fixture', role: 'CUSTOMER', status: 'ACTIVE' });
db.seed('languages', { _id: oid(languageId), code: 'en', name: 'English', isActive: true });
db.seed('voices', { _id: oid(voiceId), provider: 'gemini', providerVoiceId: 'Kore', languageId: oid(languageId), name: 'Kore', gender: 'FEMALE', isActive: true });
const old = { _id: oid('e'.repeat(24)), userId: oid('d'.repeat(24)), name: 'Protected old project', status: 'COMPLETED', progress: 100 };
db.seed('projects', old);
mongoose.set('autoCreate', false); mongoose.set('autoIndex', false); mongoose.set('bufferCommands', false);
mongoose.connection.readyState = 1; mongoose.connection.db = { collection: (name: string) => db.collection(name) } as never;
mongoose.startSession = async () => new db.MemorySession() as never; mongoose.connection.startSession = mongoose.startSession;
const { resolveMediaExecutable } = await import('../../src/services/media-processing/media-executable.js');
const ffmpeg = resolveMediaExecutable('ffmpeg');
function encode(args: string[], path: string) { execFileSync(ffmpeg, ['-nostdin', '-v', 'error', '-n', ...args, path], { timeout: 15000, windowsHide: true, stdio: 'pipe' }); }
const input = resolve(root, 'fixture.' + (mp3Input ? 'mp3' : 'mp4'));
encode(kind === 'mp3-cover' ? ['-f', 'lavfi', '-i', 'sine=frequency=600:duration=2', '-f', 'lavfi', '-i', 'color=c=purple:s=160x120:d=0.04', '-map', '0:a', '-map', '1:v', '-c:a', 'libmp3lame', '-c:v', 'mjpeg', '-id3v2_version', '3', '-disposition:v', 'attached_pic']
  : audioOnly ? ['-f', 'lavfi', '-i', 'sine=frequency=600:duration=2', '-c:a', mp3Input ? 'libmp3lame' : 'aac'] : ['-f', 'lavfi', '-i', 'color=c=purple:s=160x120:d=2', '-f', 'lavfi', '-i', 'sine=frequency=600:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest'], input);
const bytes = readFileSync(input), hash = createHash('sha256').update(bytes).digest('hex');
const wav = resolve(root, 'provider.wav'); encode(['-f', 'lavfi', '-i', kind === 'silent-tts' ? 'anullsrc=r=24000:cl=mono:d=1.5' : 'sine=frequency=800:duration=1.5', '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le'], wav);
let stt = 0, translation = 0, tts = 0;
const { GeminiSttProvider } = await import('../../src/services/stt/gemini-stt.provider.js');
const { setSttProviderForTests } = await import('../../src/services/stt/stt.service.js');
setSttProviderForTests(new GeminiSttProvider({ checkModel: async () => { if (kind === 'fail403') throw { status: 403, error: { status: 'PERMISSION_DENIED' } }; }, upload: async () => ({ name: 'fixture', uri: 'fixture://isolated', state: 'ACTIVE' }), getFile: async () => { throw Error('unexpected poll'); }, deleteFile: async () => {}, transcribe: async (_m, _u, _mime, language) => { stt++; assert.equal(language, undefined); if (kind === 'fail503' || kind === 'fail429') throw { status: Number(kind.slice(4)), error: { status: kind === 'fail503' ? 'UNAVAILABLE' : 'RESOURCE_EXHAUSTED' } }; if (kind === 'timeout') throw Object.assign(new Error('fixture transport deadline'), { name: 'APIConnectionTimeoutError' }); return { status: 'completed', output_text: 'Di sản bảo tàng.', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Di sản bảo tàng.', annotations: [{ type: 'word_info', text: 'Di sản bảo tàng.', start_offset: '0s', end_offset: '1.5s' }] }] }] }; } }));
const { GeminiTtsProvider } = await import('../../src/services/tts/gemini-tts.provider.js');
const { setTtsProviderForTests } = await import('../../src/services/tts/tts.service.js');
setTtsProviderForTests(new GeminiTtsProvider({ dispatch: async (text, voice) => { tts++; assert.equal(text, 'Museum heritage.'); assert.equal(voice, 'Kore'); return { output_audio: { data: (kind === 'corrupt-tts' ? Buffer.from('not audio') : readFileSync(wav)).toString('base64'), mime_type: 'audio/wav' } }; } }));
const { GeminiGroupTranslationProvider } = await import('../../src/services/translation/gemini-group-translation.provider.js');
const { GroupTranslationService } = await import('../../src/services/translation/group-translation.service.js');
const { GroupDraftStore } = await import('../../src/services/translation/group-draft-store.js');
const groups = new GroupTranslationService(new GeminiGroupTranslationProvider({ metadata: async () => ({ supportedActions: ['generateContent'] }), generate: async (_m, input) => { translation++; assert.equal(input.targetLanguage, 'en'); return { text: JSON.stringify({ outcome: 'translated', groups: input.groups.map(g => ({ groupId: g.groupId, translatedText: 'Museum heritage.' })) }), finishReason: 'STOP' }; } }), new GroupDraftStore());
const project = await import('../../src/services/project.service.js'), source = await import('../../src/services/source-language.service.js'), transcript = await import('../../src/services/transcription.service.js'), narration = await import('../../src/services/narration.service.js'), result = await import('../../src/services/result.service.js');
const created = await project.create(ownerId, { name: 'S33 isolated fixture', sourceLanguageMode: 'AUTO' }), projectId = created.id;
const { app } = await import('../../src/app.js'), { signAccessToken } = await import('../../src/utils/jwt.js');
const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
const base = 'http://127.0.0.1:' + (server.address() as { port: number }).port, headers = { authorization: 'Bearer ' + signAccessToken(ownerId, 'CUSTOMER') };
try {
  const limits = await fetch(base + '/api/projects/media-limits', { headers }); assert.equal(limits.status, 200); assert.equal((await limits.json()).data.maxFileSize, 2 * 1024 * 1024);
  async function upload(data: Buffer, name: string, mime: string) { const form = new FormData(); form.append('file', new Blob([new Uint8Array(data)], { type: mime }), name); return fetch(base + '/api/projects/' + projectId + '/media', { method: 'POST', headers, body: form }); }
  // Actual middleware + service reject invalid uploads before any provider dispatch.
  assert.equal((await upload(Buffer.alloc(2 * 1024 * 1024 + 1), 'large.mp3', 'audio/mpeg')).status, 413);
  assert.equal((await upload(bytes, 'wrong.mp3', 'video/mp4')).status, 415);
  assert.equal((await upload(Buffer.from('not an mp3'), 'broken.mp3', 'audio/mpeg')).status, 422);
  const silent = resolve(root, 'no-audio.mp4'); encode(['-f', 'lavfi', '-i', 'color=s=160x120:d=1', '-c:v', 'libx264'], silent);
  assert.equal((await upload(readFileSync(silent), 'no-audio.mp4', 'video/mp4')).status, 422);
  assert.equal(stt + translation + tts, 0); assert.equal(db.documents('media').length, 0);
  const uploaded = await upload(bytes, 'fixture.' + (mp3Input ? 'mp3' : 'mp4'), mp3Input ? 'audio/mpeg' : 'video/mp4'); const uploadedData = await uploaded.json(); assert.equal(uploaded.status, 201, JSON.stringify(uploadedData));
  assert.equal(uploadedData.data.media.mediaType, audioOnly ? 'AUDIO' : 'VIDEO');
  const sourcePlayback = await fetch(base + `/api/projects/${projectId}/media/file`, { headers: { ...headers, Range: 'bytes=0-63' } }); assert.equal(sourcePlayback.status, 206);
  if (kind.startsWith('fail') || kind === 'timeout') {
    const response = await fetch(base + `/api/projects/${projectId}/transcription`, { method: 'POST', headers });
    assert.equal(response.status, kind === 'fail403' ? 503 : 502);
    const state = await (await fetch(base + `/api/projects/${projectId}/transcription-state`, { headers })).json();
    assert.equal(state.data.state, kind === 'fail403' ? 'FAILED' : 'UNCERTAIN');
    assert.equal(state.data.retryAllowed, kind === 'fail403');
    assert.equal(stt, kind === 'fail403' ? 0 : 1); assert.equal(translation + tts, 0);
    const job = db.documents('processingjobs')[0]!, evidence = job.sttEvidence as { stage: string; httpStatus?: number; outcome: string };
    assert.equal(evidence.stage, kind === 'fail403' ? 'MODEL_VALIDATION' : 'TRANSCRIPTION');
    if (kind !== 'timeout') assert.equal(evidence.httpStatus, Number(kind.slice(4)));
    if (kind !== 'fail403') { const retry = await fetch(base + `/api/projects/${projectId}/transcription`, { method: 'POST', headers }); assert.equal(retry.status, 409); assert.equal(stt, 1); }
    assert.equal(db.documents('transcripts').length, 0); assert.equal(db.documents('narrations').length, 0);
    assert.deepEqual(db.documents('projects').find(p => String(p._id) === String(old._id)), old);
    console.log(JSON.stringify({ kind, status: 'SAFE_STOP', stt, stage: evidence.stage, atlas: false }));
    process.exitCode = 0;
  } else {
  const transcribed = await transcript.transcribe(projectId, ownerId); assert.equal(transcribed.transcript.sourceLanguageStatus, 'NEEDS_CONFIRMATION');
  await assert.rejects(groups.customerGenerate(projectId, ownerId, 'en'), (e: unknown) => (e as { code: string }).code === 'SOURCE_LANGUAGE_UNCONFIRMED'); assert.equal(translation, 0);
  await assert.rejects(source.confirmSourceLanguage(projectId, ownerId, 'vi', transcribed.transcript.revision + 1));
  await source.confirmSourceLanguage(projectId, ownerId, 'vi', transcribed.transcript.revision);
  const draft = await groups.customerGenerate(projectId, ownerId, 'en');
  const { withCustomerTranslation } = await import('../../src/services/translation/customer-scope.js');
  await assert.rejects(narration.generate(projectId, ownerId, 'en', voiceId)); assert.equal(tts, 0);
  await withCustomerTranslation(() => groups.approve(projectId, ownerId, draft.draftId, { outputDigest: draft.outputDigest, reviewed: true }));
  if (kind === 'silent-tts' || kind === 'corrupt-tts') {
    await assert.rejects(narration.generate(projectId, ownerId, 'en', voiceId), (error: unknown) => (error as { code: string }).code === 'TTS_INVALID_RESPONSE');
    assert.deepEqual([stt, translation, tts], [1, 1, 1]); assert.equal(db.documents('narrations').length, 0); assert.equal(db.documents('results').length, 0);
    assert.equal(db.documents('projects').find(p => String(p._id) === projectId)!.status, 'FAILED');
    assert.equal(db.documents('processingjobs').find(j => j.type === 'TTS')!.status, 'FAILED');
    assert.deepEqual(db.documents('projects').find(p => String(p._id) === String(old._id)), old);
    console.log(JSON.stringify({ kind, status: 'SAFE_STOP', invalidAudio: true }));
  } else {
  const audio = await narration.generate(projectId, ownerId, 'en', voiceId);
  const { FfmpegMediaProcessor } = await import('../../src/services/media-processing/ffmpeg-media-processor.js'); const processor = new FfmpegMediaProcessor();
  const audioRow = db.documents('narrations')[0]!, audioPath = resolve(root, String(audioRow.audioPath)), audioProbe = await processor.probe(audioPath);
  assert.equal(audioProbe.hasAudio, true); assert.equal(audioProbe.audioCodec, 'mp3'); assert.ok(audioProbe.duration > 0);
  const playback = await fetch(base + `/api/projects/${projectId}/narrations/${audio.narration.id}/audio`, { headers }); assert.equal(playback.status, 200); assert.match(playback.headers.get('content-type')!, /audio\/mpeg/); assert.ok((await playback.arrayBuffer()).byteLength > 100);
  if (audioOnly) { assert.equal(audio.project.status, 'COMPLETED'); assert.equal(db.documents('results').length, 0); await assert.rejects(result.process(projectId, ownerId, audio.narration.id)); }
  else { const final = await result.process(projectId, ownerId, audio.narration.id); assert.equal(final.project.status, 'COMPLETED'); const row = db.documents('results')[0]!, probe = await processor.probe(resolve(root, String(row.videoPath))); assert.equal(probe.videoCodec, 'h264'); assert.equal(probe.audioCodec, 'aac'); const response = await fetch(base + `/api/projects/${projectId}/results/${row._id}/file`, { headers: { ...headers, Range: 'bytes=0-127' } }); assert.equal(response.status, 206); assert.match(response.headers.get('content-type')!, /video\/mp4/); }
  assert.deepEqual([stt, translation, tts], [1, 1, 1]); assert.equal(createHash('sha256').update(readFileSync(input)).digest('hex'), hash);
  assert.deepEqual(db.documents('projects').find(p => String(p._id) === String(old._id)), old);
  assert.deepEqual(db.documents('translationattempts').filter(a => a.kind === 'QUOTA').map(a => a.count), [1, 1]);
  assert.equal(readdirSync(resolve(root, 'projects', projectId)).some(p => p.endsWith('.tmp')), false);
  console.log(JSON.stringify({ kind, status: 'COMPLETE', dispatches: [stt, translation, tts], media: audioOnly ? 'AUDIO_RESULT' : 'H264_AAC_MP4', realProvider: false, atlas: false }));
  }
  }
} finally { await new Promise<void>((r, j) => server.close(e => e ? j(e) : r())); }
