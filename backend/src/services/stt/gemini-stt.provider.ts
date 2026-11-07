import { normalizeTimeline, TimelineError } from './normalize-timeline.js';
import { e2eInference } from '../e2e-test-run.js';
import { MAX_TRANSCRIPTION_DURATION_SECONDS } from '../../config/media-limits.js';
import { resolveMediaExecutable } from '../media-processing/media-executable.js';
import { denyUnscopedTestStorage, actualAssets } from '../e2e-runtime-boundary.js';
import { e2eRunEnabled } from '../e2e-test-run.js';
import { GoogleGenAI } from '@google/genai';
import { access, constants, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { FfmpegMediaProcessor } from '../media-processing/ffmpeg-media-processor.js';
import type { SttInput, SttProvider, SttResult } from './stt-provider.interface.js';
import { SttTrace, safeSttMetadata, type SttEvidence, type SttStage } from './stt-evidence.js';

export const GEMINI_STT_MODEL = 'gemini-3.5-transcribe';
export const geminiTranscriptionConfig = (language?: string) => ({
  ...(language ? { language_codes: [language] } : {}),
  mode: { type: 'verbatim' as const, timestamp_granularities: ['word'] as ['word'] },
});
export const GEMINI_STT_ERRORS = ['STT_NOT_CONFIGURED', 'STT_INVALID_KEY', 'STT_MODEL_UNAVAILABLE', 'STT_QUOTA_EXCEEDED', 'STT_INVALID_FILE', 'STT_FILE_TOO_LARGE', 'STT_DURATION_EXCEEDED', 'STT_TIMEOUT', 'STT_INVALID_RESPONSE', 'STT_NO_SPEECH', 'STT_PROVIDER_ERROR'] as const;
// Internal diagnostics contain fixed metadata and, in development only, bounded numeric timestamp evidence.
export const GEMINI_STT_DIAGNOSTIC_CODES = ['RESPONSE_SCHEMA_INVALID', 'INTERACTION_NOT_COMPLETED', 'SOURCE_DURATION_INVALID', 'TRANSCRIPT_EMPTY', 'WORD_ANNOTATIONS_MISSING', 'WORD_SCHEMA_INVALID', 'TIMESTAMP_MISSING', 'TIMESTAMP_FORMAT_INVALID', 'TIMESTAMP_NON_FINITE', 'TIMESTAMP_OVERLAP_OR_ORDER', 'TIMESTAMP_INTERVAL_INVALID', 'TIMESTAMP_BEYOND_DURATION'] as const;
export type GeminiSttDiagnostic = Readonly<{
  code: typeof GEMINI_STT_DIAGNOSTIC_CODES[number];
  wordIndex?: number;
  wordCount?: number;
  issueCount?: number;
  field?: 'start_offset' | 'end_offset';
  timestampEvidence?: TimestampIntervalEvidence;
}>;
type TimestampValue = Readonly<{ raw: string | number; type: 'string' | 'number'; decimalPlaces: number; parsed: number }>;
type TimestampIntervalEvidence = Readonly<{
  valuesSuppressed: boolean;
  startType: string;
  endType: string;
  start?: TimestampValue;
  end?: TimestampValue;
  relation?: 'EQUAL' | 'REVERSED';
  precision?: 'PRECISION_COLLAPSE' | 'NO_COLLAPSE';
}>;
const scalarType = (value: unknown) => value === null ? 'null' : typeof value;
const safeTimestamp = (value: unknown): TimestampValue | undefined => {
  if (typeof value !== 'string' && typeof value !== 'number') return;
  if (typeof value === 'number' && (!Number.isFinite(value) || value < 0)) return;
  const raw = String(value);
  if (raw.length > 64 || !/^\d+(?:\.\d+)?s?(?![\s\S])/.test(raw)) return;
  const numeric = raw.replace(/s$/, '');
  const parsed = Number(numeric);
  if (!Number.isFinite(parsed)) return;
  return Object.freeze({ raw: value, type: typeof value as 'string' | 'number', decimalPlaces: numeric.split('.')[1]?.length ?? 0, parsed });
};
// Canonical decimal comparison avoids calling 1.0s vs 1.00s a precision collapse.
const exactDecimal = (value: string | number) => {
  const [integer = '', fraction = ''] = String(value).replace(/s$/, '').split('.');
  return `${integer.replace(/^0+(?=\d)/, '')}.${fraction.replace(/0+$/, '')}`;
};
export const timestampIntervalEvidence = (rawStart: unknown, rawEnd: unknown): TimestampIntervalEvidence => {
  const start = safeTimestamp(rawStart); const end = safeTimestamp(rawEnd);
  const types = { startType: scalarType(rawStart), endType: scalarType(rawEnd) };
  // Suppress both values if either is unsafe. Never coerce objects or serialize provider payloads.
  if (!start || !end) return Object.freeze({ ...types, valuesSuppressed: true });
  if (end.parsed > start.parsed) return Object.freeze({ ...types, valuesSuppressed: true });
  return Object.freeze({ ...types, valuesSuppressed: false, start, end,
    relation: end.parsed === start.parsed ? 'EQUAL' : 'REVERSED',
    precision: end.parsed === start.parsed && exactDecimal(start.raw) !== exactDecimal(end.raw) ? 'PRECISION_COLLAPSE' : 'NO_COLLAPSE',
  });
};
export class GeminiSttError extends Error {
  constructor(public readonly code: typeof GEMINI_STT_ERRORS[number], public readonly httpStatus?: number, public readonly diagnostic?: GeminiSttDiagnostic, public readonly evidence?:SttEvidence) { super(code); }
}
export interface GeminiTransport {
  checkModel(model: string, signal: AbortSignal): Promise<void>;
  upload(file: string, mime: string, signal: AbortSignal): Promise<{ name?: string; uri?: string; state?: string }>;
  getFile(name: string, signal: AbortSignal): Promise<{ name?: string; uri?: string; state?: string }>;
  deleteFile(name: string): Promise<void>;
  transcribe(model: string, uri: string, mime: string, language: string | undefined, signal: AbortSignal, onResponse?:(metadata:unknown)=>void): Promise<unknown>;
}
const sdkTransport = (key: string): GeminiTransport => {
  const ai = new GoogleGenAI({ apiKey: key, httpOptions: { timeout: 120_000, retryOptions: { attempts: 1 } } });
  return {
    async checkModel(model, signal) { await ai.models.get({ model, config: { abortSignal: signal } }); },
    upload: (file, mime, signal) => ai.files.upload({ file, config: { mimeType: mime, abortSignal: signal } }),
    getFile: (name, signal) => ai.files.get({ name, config: { abortSignal: signal } }),
    async deleteFile(name) { await ai.files.delete({ name, config: { httpOptions: { timeout: 10_000 } } }); },
    transcribe: async (model, uri, mime, language, signal, onResponse) => {
      const data=await ai.interactions.create({
      model, store: false,
      input: [{ type: 'audio', uri, mime_type: mime }],
      generation_config: { transcription_config: geminiTranscriptionConfig(language) },
      }, { signal, timeout: 120_000, maxRetries: 0 });
      // Public SDK wrapper exposes metadata from this SAME request.
      onResponse?.({status:data.sdkHttpResponse?.responseInternal.status,headers:data.sdkHttpResponse?.headers});return data;
    },
  };
};
const wordSchema = z.object({ type: z.literal('word_info'), text: z.string().trim().min(1), start_offset: z.string(), end_offset: z.string() });
const outputSchema = z.object({ status: z.literal('completed'), output_text: z.string().optional(), steps: z.array(z.object({ type: z.string(), content: z.array(z.object({ type: z.string(), text: z.string().optional(), annotations: z.array(z.unknown()).optional() })).optional() })) });
const invalidResponse = (code: GeminiSttDiagnostic['code'], details: Omit<GeminiSttDiagnostic, 'code'> = {}): never => {
  throw new GeminiSttError('STT_INVALID_RESPONSE', undefined, Object.freeze({ code, ...details }));
};
const offset = (value: string, wordIndex: number, field: 'start_offset' | 'end_offset'): number => {
  if (!value) return invalidResponse('TIMESTAMP_MISSING', { wordIndex, field });
  if (!/^\d+(?:\.\d+)?s$/.test(value)) return invalidResponse('TIMESTAMP_FORMAT_INVALID', { wordIndex, field });
  const result = Number(value.slice(0, -1));
  if (!Number.isFinite(result)) return invalidResponse('TIMESTAMP_NON_FINITE', { wordIndex, field });
  return result;
};
export const mapGeminiTranscript = (value: unknown, duration: number, language?: string): SttResult => {
  if (typeof value === 'object' && value !== null && 'status' in value && typeof value.status === 'string' && value.status !== 'completed') {
    return invalidResponse('INTERACTION_NOT_COMPLETED');
  }
  const output = outputSchema.safeParse(value);
  if (!output.success) return invalidResponse('RESPONSE_SCHEMA_INVALID', { issueCount: output.error.issues.length });
  if (!Number.isFinite(duration) || duration <= 0) return invalidResponse('SOURCE_DURATION_INVALID');
  const contents = output.data.steps.filter((s) => s.type === 'model_output').flatMap((s) => s.content ?? []);
  const text = (output.data.output_text ?? contents.filter((c) => c.type === 'text').map((c) => c.text ?? '').join(' ')).trim();
  if (!text) throw new GeminiSttError('STT_NO_SPEECH', undefined, Object.freeze({ code: 'TRANSCRIPT_EMPTY' }));
  const words = contents.flatMap((c,boundary) => (c.annotations ?? []).filter((a) => typeof a === 'object' && a !== null && 'type' in a && a.type === 'word_info').map(word=>({word,boundary})));
  if (!words.length) return invalidResponse('WORD_ANNOTATIONS_MISSING', { wordCount: 0 });
  const invalidInterval = (wordIndex: number, rawStart: string, rawEnd: string): never => invalidResponse('TIMESTAMP_INTERVAL_INVALID', {
    wordIndex,
    ...((process.env.NODE_ENV ?? 'development') === 'development'
      ? { timestampEvidence: timestampIntervalEvidence(rawStart, rawEnd) } : {}),
  });
  const annotations = words.map(({word,boundary}, wordIndex) => {
    const annotation = word as Record<string, unknown>;
    for (const field of ['start_offset', 'end_offset'] as const) {
      if (annotation[field] === undefined || annotation[field] === null || annotation[field] === '') return invalidResponse('TIMESTAMP_MISSING', { wordIndex, field });
      if (typeof annotation[field] !== 'string') return invalidResponse('TIMESTAMP_FORMAT_INVALID', { wordIndex, field });
    }
    const parsed = wordSchema.safeParse(word);
    if (!parsed.success) return invalidResponse('WORD_SCHEMA_INVALID', { wordIndex, issueCount: parsed.error.issues.length });
    const start = offset(parsed.data.start_offset, wordIndex, 'start_offset'); const end = offset(parsed.data.end_offset, wordIndex, 'end_offset');
    // Equal source offsets may be represented as part of a touching phrase below.
    // Reversed intervals and floating-point collapse remain invalid.
    if (end < start || (end === start && exactDecimal(parsed.data.start_offset) !== exactDecimal(parsed.data.end_offset))) {
      return invalidInterval(wordIndex, parsed.data.start_offset, parsed.data.end_offset);
    }
    if (end > duration) return invalidResponse('TIMESTAMP_BEYOND_DURATION', { wordIndex });
    return { start, end, text: parsed.data.text, wordIndex, boundary, rawStart: parsed.data.start_offset, rawEnd: parsed.data.end_offset };
  });
  try {
    const normalized=normalizeTimeline(annotations,duration);
    return { text, duration, language, segments:normalized.segments,timelineDiagnostic:normalized.diagnostic };
  } catch(error) {
    if(error instanceof TimelineError){
      if(error.code==='TIMESTAMP_INTERVAL_INVALID'){const w=annotations[error.wordIndex]!;return invalidInterval(error.wordIndex,w.rawStart,w.rawEnd);}
      return invalidResponse(error.code,{wordIndex:error.wordIndex,wordCount:words.length});
    }
    throw error;
  }
};
const mapError = (error: unknown): GeminiSttError => {
  if (error instanceof GeminiSttError) return error;
  const e = error as { status?: number; code?: number; name?: string; message?: string } | null;
  const status = safeSttMetadata(error).httpStatus;
  if (['TimeoutError','AbortError','APIConnectionTimeoutError','APIUserAbortError','RequestTimeoutError','RequestAbortedError'].includes(e?.name??'')
    || error instanceof Error&&['APIConnectionTimeoutError','APIUserAbortError','RequestTimeoutError','RequestAbortedError'].includes(error.constructor.name)) return new GeminiSttError('STT_TIMEOUT',status);
  if (status === 401 || (status === 400 && e?.message?.includes('API_KEY_INVALID'))) return new GeminiSttError('STT_INVALID_KEY', status);
  if (status === 400) return new GeminiSttError('STT_PROVIDER_ERROR', status);
  if (status === 403 || status === 404) return new GeminiSttError('STT_MODEL_UNAVAILABLE', status);
  if (status === 429) return new GeminiSttError('STT_QUOTA_EXCEEDED', status);
  return new GeminiSttError('STT_PROVIDER_ERROR', status);
};
export class GeminiSttProvider implements SttProvider {
  constructor(private readonly transport?: GeminiTransport, private readonly probe = (file: string) => new FfmpegMediaProcessor().probe(file), private readonly extract = async (source: string, destination: string) => {
    denyUnscopedTestStorage();
    await promisify(execFile)(resolveMediaExecutable('ffmpeg'), ['-nostdin', '-y', '-i', source, '-map', '0:a:0', '-vn', '-c:a', 'pcm_s16le', destination], { timeout: 120_000, windowsHide: true });
  }) {}
  async transcribe(input: SttInput): Promise<SttResult> { return e2eInference('STT', () => this.transcribeInternal(input)); }
  private async transcribeInternal(input: SttInput): Promise<SttResult> {
    const trace=new SttTrace();
    const publish=()=>{try{input.onEvidence?.(trace.snapshot());}catch{/* Diagnostic failure never replaces the original provider outcome. */}};
    const stage=(name:SttStage)=>{trace.enter(name);publish();};
    let httpMetadata:unknown;
    const signal = AbortSignal.timeout(120_000);
    let temporary: string | undefined; let uploadedName: string | undefined;
    let client:GeminiTransport|undefined;
    let completed:SttResult|undefined;
    let failure:GeminiSttError|undefined;
    try {
      stage('LOCAL_VALIDATION');
      const key = process.env.GEMINI_API_KEY?.trim();
      if (!key) throw new GeminiSttError('STT_NOT_CONFIGURED');
      const model = process.env.GEMINI_STT_MODEL?.trim() || GEMINI_STT_MODEL;
      if (model !== GEMINI_STT_MODEL) throw new GeminiSttError('STT_MODEL_UNAVAILABLE');
      client=this.transport??sdkTransport(key);
      if (!['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/webm', 'video/mp4', 'video/webm', 'video/quicktime'].includes(input.mimeType)) throw new GeminiSttError('STT_INVALID_FILE');
      let disk;
      try { await access(input.filePath, constants.R_OK); disk = await stat(input.filePath); } catch { throw new GeminiSttError('STT_INVALID_FILE'); }
      if (!disk.isFile() || disk.size <= 0) throw new GeminiSttError('STT_INVALID_FILE');
      if (disk.size > 500 * 1024 * 1024) throw new GeminiSttError('STT_FILE_TOO_LARGE');
      let source;
      stage('MEDIA_PROBE');
      try { source = await this.probe(input.filePath); } catch { throw new GeminiSttError('STT_INVALID_FILE'); }
      if (!source.hasAudio || !Number.isFinite(source.duration) || source.duration <= 0) throw new GeminiSttError('STT_INVALID_FILE');
      if (source.duration > MAX_TRANSCRIPTION_DURATION_SECONDS) throw new GeminiSttError('STT_DURATION_EXCEEDED');
      // Verify access to the configured model BEFORE uploading private media.
      stage('MODEL_VALIDATION');
      await client.checkModel(model, signal);
      let file = input.filePath; let mime = input.mimeType === 'audio/x-wav' ? 'audio/wav' : input.mimeType === 'audio/x-m4a' ? 'audio/m4a' : input.mimeType;
      if (mime.startsWith('video/') || mime === 'audio/mp4') {
        stage('AUDIO_EXTRACTION');
        mime = 'audio/wav';
        if(e2eRunEnabled()){file=(await actualAssets().extract(input.filePath)).path;}
        else{temporary = await mkdtemp(join(tmpdir(), 'gemini-stt-')); file = join(temporary, 'audio.wav');try { await this.extract(input.filePath, file); } catch { throw new GeminiSttError('STT_INVALID_FILE'); }}
        const extracted = await stat(file);
        if (!extracted.size || extracted.size > 500 * 1024 * 1024) throw new GeminiSttError('STT_FILE_TOO_LARGE');
        stage('AUDIO_PROBE');const audio = await this.probe(file);
        if (!audio.hasAudio || !Number.isFinite(audio.duration) || audio.duration <= 0) throw new GeminiSttError('STT_INVALID_FILE');
      }
      stage('FILE_UPLOAD');let remote = await client.upload(file, mime, signal); uploadedName = remote.name;
      while (remote.state === 'PROCESSING') {
        if (!uploadedName || signal.aborted) throw new GeminiSttError('STT_TIMEOUT');
        stage('FILE_POLL');
        await new Promise<void>((resolve, reject) => { const abort = () => { clearTimeout(timer); reject(new GeminiSttError('STT_TIMEOUT')); }; const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 1000); signal.addEventListener('abort', abort, { once: true }); });
        remote = await client.getFile(uploadedName, signal);
      }
      if (!remote.uri || !uploadedName || remote.state !== 'ACTIVE') throw new GeminiSttError('STT_INVALID_FILE');
      const hint = input.sourceLanguageMode === 'AUTO' ? undefined : input.language;
      const language = hint ? ({ vi: 'vi-VN', en: 'en-US', ja: 'ja-JP', ko: 'ko-KR', zh: 'cmn-Hans-CN' } as Record<string, string>)[hint] ?? hint : undefined;
      // Timestamp is the invocation boundary, NOT proof bytes were sent/accepted.
      trace.dispatch();publish();
      const response=await client.transcribe(model,remote.uri,mime,language,signal,metadata=>{httpMetadata=metadata;});
      trace.response(response,httpMetadata);publish();stage('RESPONSE_VALIDATION');
      completed=mapGeminiTranscript(response,source.duration,hint);if(completed.timelineDiagnostic)trace.normalized(completed.timelineDiagnostic);trace.success();publish();
    } catch (error) {trace.fail(error);publish();failure=mapError(error);}
    finally {
      if (uploadedName&&client) { try { await client.deleteFile(uploadedName); } catch {trace.cleanupFailed();publish();} }
      if (temporary) { try { await rm(temporary, { recursive: true, force: true }); } catch {trace.cleanupFailed();publish();} }
    }
    // The attested failure and service callback must share the final snapshot,
    // including any cleanup failure; cleanup never replaces the original code.
    if(failure)throw new GeminiSttError(failure.code,failure.httpStatus,failure.diagnostic,trace.snapshot());
    return{...completed!,evidence:trace.snapshot()};
  }
}
