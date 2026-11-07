import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFileSync } from 'node:fs';
import type { spawn } from 'node:child_process';
import { resolveMediaExecutable } from '../src/services/media-processing/media-executable.js';
import { audioFormat } from '../src/services/tts/audio-format.js';
import { GeminiTtsProvider, convertWavToMp3 } from '../src/services/tts/gemini-tts.provider.js';

process.env.NODE_ENV = 'test'; process.env.GEMINI_API_KEY = 'synthetic-not-a-key';
const input = { text: 'Museum English narration.', language: 'en', voice: 'Kore', format: 'mp3' as const };
const mp3 = Buffer.alloc(417); mp3.set([255,251,144,0]);
const wav = Buffer.alloc(46); wav.write('RIFF'); wav.writeUInt32LE(38,4); wav.write('WAVEfmt ',8); wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(24000,24); wav.writeUInt32LE(48000,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(2,40);
const response = (bytes: Buffer, mime?: string) => ({ output_audio: { data: bytes.toString('base64'), mime_type: mime } });

test('resolver preserves valid Windows path and falls back only for absent paths', () => {
  assert.equal(resolveMediaExecutable('ffmpeg', 'C:\\Program Files\\ffmpeg.exe', () => true), 'C:\\Program Files\\ffmpeg.exe');
  assert.equal(resolveMediaExecutable('ffmpeg', 'C:\\old\\ffmpeg.exe', () => false), 'ffmpeg');
  assert.equal(resolveMediaExecutable('ffprobe', 'C:\\old\\ffprobe.exe', () => false), 'ffprobe');
  assert.equal(resolveMediaExecutable('ffmpeg', 'ffmpeg'), 'ffmpeg');
});
test('bytes distinguish real WAV, MP3, ID3-only, truncated and mislabeled data', () => {
  assert.equal(audioFormat(wav), 'wav'); assert.equal(audioFormat(mp3), 'mp3');
  for (const bytes of [Buffer.from('ID3'), mp3.subarray(0,20), Buffer.from('not audio'), wav.subarray(0,44)]) assert.equal(audioFormat(bytes), undefined);
});
test('English Kore regression: valid MP3 returned without conversion', async () => {
  const provider = new GeminiTtsProvider({ dispatch: async (text, voice) => { assert.equal(text,input.text); assert.equal(voice,'Kore'); return response(mp3,'audio/mpeg'); }, convert: async () => { throw Error('must not convert MP3'); } });
  const r = await provider.synthesize(input); assert.equal(r.mimeType,'audio/mpeg'); assert.equal(r.format,'mp3'); assert.deepEqual(Buffer.from(r.audio),mp3);
});
test('WAV converts once and validates MP3 before success', async () => {
  let conversions = 0;
  const r = await new GeminiTtsProvider({ dispatch: async () => response(wav,'audio/wav'), convert: async bytes => { conversions++; assert.deepEqual(bytes,wav); return mp3; } }).synthesize(input);
  assert.equal(conversions,1); assert.equal(audioFormat(Buffer.from(r.audio)),'mp3');
});
test('conversion failure never falls back to WAV or publishes success', async () => {
  await assert.rejects(new GeminiTtsProvider({ dispatch: async () => response(wav), convert: async () => { throw Error('TTS_CONVERSION_FAILED'); } }).synthesize(input), /TTS_CONVERSION_FAILED/);
  await assert.rejects(new GeminiTtsProvider({ dispatch: async () => response(wav), convert: async () => wav }).synthesize(input), /TTS_INVALID_RESPONSE/);
});
test('MIME mismatch and invalid provider bytes are rejected before conversion', async () => {
  for (const r of [response(wav,'audio/mpeg'), response(mp3,'audio/wav'), response(Buffer.from('garbage')), {output_audio:{data:'!!!!'}}]) {
    await assert.rejects(new GeminiTtsProvider({ dispatch: async () => r }).synthesize(input), /TTS_INVALID_RESPONSE/);
  }
});
test('provider deadline aborts once, no retry or late conversion', async () => {
  let calls = 0, conversions = 0; let signal: AbortSignal | undefined; let complete!: (value: ReturnType<typeof response>) => void;
  const p = new GeminiTtsProvider({ deadlineMs: 10, dispatch: async (_text,_voice,s) => { calls++; signal=s; return new Promise(resolve=>{complete=resolve;}); }, convert: async () => { conversions++; return mp3; } }).synthesize(input);
  await assert.rejects(p,/TTS_TIMEOUT/); assert.equal(signal?.aborted,true); complete(response(wav)); await new Promise(r=>setImmediate(r)); assert.equal(calls,1); assert.equal(conversions,0);
});
test('conversion shares finite overall deadline without a second paid dispatch', async () => {
  let calls=0;
  await assert.rejects(new GeminiTtsProvider({deadlineMs:10,dispatch:async()=>{calls++;return response(wav);},convert:async()=>new Promise(()=>{})}).synthesize(input),/TTS_CONVERSION_TIMEOUT/); assert.equal(calls,1);
});
test('ambiguous transport error reports UNCERTAIN without retry', async () => {
  let calls=0; await assert.rejects(new GeminiTtsProvider({dispatch:async()=>{calls++;throw Error('connection lost');}}).synthesize(input),/TTS_UNCERTAIN/); assert.equal(calls,1);
});
function childStub() {
  const child = Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),killed:false,kill:()=>{child.killed=true;return true;}});
  return child;
}
test('missing configured and PATH binary surfaces conversion error (mock ENOENT)', async () => {
  const child=childStub();const fake=(()=>{queueMicrotask(()=>child.emit('error',Object.assign(Error(),{code:'ENOENT'})));return child;}) as unknown as typeof spawn;
  await assert.rejects(convertWavToMp3(wav,new AbortController().signal,fake),/TTS_CONVERSION_FAILED/);assert.equal(child.killed,true);
});
test('conversion abort kills child and does not resolve output', async () => {
  const child=childStub(),controller=new AbortController(); const fake=(()=>child) as unknown as typeof spawn;
  const p=convertWavToMp3(wav,controller.signal,fake); controller.abort();await assert.rejects(p,/TTS_CONVERSION_TIMEOUT/);assert.equal(child.killed,true);
});
test('SDK dispatch explicitly disables retries and stored interaction', () => {
  const source=readFileSync(new URL('../src/services/tts/gemini-tts.provider.ts',import.meta.url),'utf8');
  assert.match(source,/maxRetries: 0/);assert.match(source,/attempts: 1/);assert.match(source,/store: false/);
});
