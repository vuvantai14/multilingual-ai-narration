import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
Object.assign(process.env, { NODE_ENV: 'test', MONGODB_URI: 'mongodb://127.0.0.1:1/mock_only', JWT_ACCESS_SECRET: randomBytes(32).toString('hex'), JWT_REFRESH_SECRET: randomBytes(32).toString('hex'), JWT_ACCESS_EXPIRES_IN: '15m', JWT_REFRESH_EXPIRES_IN: '1d', MAX_UPLOAD_SIZE_MB: '200' });
const { validateUploadedMedia, validateMediaName, mediaLimits } = await import('../src/services/media-validation.js');
const { setMediaProcessorForTests } = await import('../src/services/media-processing/media-processing.service.js');
const { sttExecutionState } = await import('../src/services/stt/stt-execution-state.js');
test('actual upload validation rejects over-duration, unsupported codec, wrong container and corrupt decode before metadata', async t => {
  await mkdir('.tmp', { recursive: true }); const directory = await mkdtemp(resolve('.tmp', 's33-validation-')), path = resolve(directory, 'fixture.mp3');
  const bytes = Buffer.alloc(417); bytes.set([255, 251, 144, 0]); await writeFile(path, bytes);
  const input = { path, originalname: 'fixture.mp3', mimetype: 'audio/mpeg', size: bytes.length };
  const good = { hasAudio: true, hasVideo: false, duration: 2, format: 'mp3', audioCodec: 'mp3', fileSize: bytes.length };
  t.after(() => setMediaProcessorForTests());
  for (const [patch, code] of [[{ duration: 1801 }, 'MEDIA_DURATION_EXCEEDED'], [{ audioCodec: 'unsupported' }, 'MEDIA_CODEC_UNSUPPORTED'], [{ format: 'flac' }, 'MEDIA_TYPE_MISMATCH'], [{ hasAudio: false }, 'MEDIA_AUDIO_REQUIRED']] as const) {
    setMediaProcessorForTests({ probe: async () => ({ ...good, ...patch }), composeNarration: async () => { throw Error('must not encode'); } });
    await assert.rejects(validateUploadedMedia(input), (error: unknown) => (error as { code: string }).code === code);
  }
  setMediaProcessorForTests({ probe: async () => good, verifyInput: async () => { throw Error('decoder rejected truncated frames'); }, composeNarration: async () => { throw Error('must not encode'); } });
  await assert.rejects(validateUploadedMedia(input), (error: unknown) => (error as { code: string }).code === 'MEDIA_INVALID_FILE');
});
test('name/MIME and actual configured upload limits are consistent without accepting cross-audio MIME', () => {
  assert.equal(mediaLimits().maxFileSize, 200 * 1024 * 1024); assert.equal(mediaLimits().maxDurationSeconds, 1800);
  for (const [name, mime] of [['x.mp3', 'audio/mp4'], ['x.mp4', 'audio/mpeg'], ['x.exe', 'audio/mpeg'], ['x.mp4.exe', 'video/mp4']]) assert.throws(() => validateMediaName(name!, mime!));
  for (const [name, mime] of [['x.MP3', 'audio/mpeg'], ['x.mp4', 'video/mp4'], ['x.webm', 'audio/webm'], ['x.m4a', 'audio/x-m4a']]) assert.doesNotThrow(() => validateMediaName(name!, mime!));
});
test('execution-state projection never equates legacy FAILED with non-dispatch; completed no-speech is definite but cannot retry', () => {
  assert.deepEqual(sttExecutionState(null), { state: 'NOT_STARTED', retryAllowed: true });
  assert.equal(sttExecutionState({ status: 'FAILED' }).state, 'UNCERTAIN');
  const pre = { contract: 'GEMINI_STT_EVIDENCE_V1', outcome: 'FAILED_PRE_DISPATCH', inferenceState: 'NOT_DISPATCHED', providerAccepted: 'NO' } as const;
  assert.equal(sttExecutionState({ status: 'FAILED', sttEvidence: pre }).retryAllowed, true);
  assert.equal(sttExecutionState({ status: 'FAILED', sttEvidence: { ...pre, inferenceDispatchAt: '2026-11-06T00:00:00Z' } }).retryAllowed, false);
  assert.deepEqual(sttExecutionState({ status: 'FAILED', errorMessage: 'STT_NO_SPEECH', sttEvidence: { contract: pre.contract, outcome: 'FAILED_RESPONSE', inferenceState: 'RESPONSE_RECEIVED', providerAccepted: 'YES' } }), { state: 'FAILED', errorCode: 'STT_NO_SPEECH', retryAllowed: false });
});
