import { e2eInference } from '../e2e-test-run.js';
import { spawn } from 'node:child_process';
import { actualAssets } from '../e2e-runtime-boundary.js';
import { e2eRunEnabled } from '../e2e-test-run.js';
import { GoogleGenAI } from '@google/genai';
import { resolveMediaExecutable } from '../media-processing/media-executable.js';
import { audioFormat } from './audio-format.js';
import type { TtsProvider, TtsProviderInput, TtsProviderResult } from './tts-provider.interface.js';

export const GEMINI_TTS_MODEL = 'gemini-3.8-flash-tts';
export const TTS_DEADLINE_MS = 120_000;
const MAX_AUDIO_BYTES = 32 * 1024 * 1024;
export type TtsAudioResponse = { output_audio?: { data?: string; mime_type?: string; mimeType?: string } };
type Dispatch = (text: string, voice: string, signal: AbortSignal) => Promise<TtsAudioResponse>;
type Convert = (bytes: Buffer, signal: AbortSignal) => Promise<Buffer>;

const GEMINI_VOICE_MAP: Record<string, string> = {
  kore: 'Kore',
  aoede: 'Aoede',
  leda: 'Leda',
  puck: 'Puck',
  fenrir: 'Fenrir',
  orus: 'Orus',
  zephyr: 'Zephyr',
  charon: 'Charon',
  coral: 'Kore',
  alloy: 'Aoede',
  nova: 'Leda',
  echo: 'Fenrir',
  onyx: 'Orus',
  fable: 'Puck',
};


export async function convertWavToMp3(bytes: Buffer, signal: AbortSignal, spawnProcess: typeof spawn = spawn): Promise<Buffer> {
  if(e2eRunEnabled())return actualAssets().convert(bytes,signal);
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error('TTS_CONVERSION_TIMEOUT')); return; }
    const child = spawnProcess(resolveMediaExecutable('ffmpeg'), ['-nostdin', '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-c:a', 'libmp3lame', '-b:a', '128k', '-f', 'mp3', 'pipe:1'], { shell: false, windowsHide: true });
    const chunks: Buffer[] = []; let size = 0, settled = false;
    const finish = (error?: Error) => { if (settled) return; settled = true; signal.removeEventListener('abort', abort); if (error) { child.kill('SIGKILL'); reject(error); } else resolve(Buffer.concat(chunks)); };
    const abort = () => finish(new Error('TTS_CONVERSION_TIMEOUT'));
    signal.addEventListener('abort', abort, { once: true });
    child.stdout!.on('data', (chunk: Buffer) => { size += chunk.length; if (size > MAX_AUDIO_BYTES) finish(new Error('TTS_CONVERSION_FAILED')); else chunks.push(chunk); });
    // Drain diagnostics without logging provider text, secrets or paths.
    child.stderr!.resume();
    child.stdin!.on('error', () => finish(new Error('TTS_CONVERSION_FAILED')));
    child.on('error', () => finish(new Error('TTS_CONVERSION_FAILED')));
    child.on('close', code => finish(code === 0 ? undefined : new Error('TTS_CONVERSION_FAILED')));
    child.stdin!.end(bytes);
    if (signal.aborted) abort();
  });
}

export class GeminiTtsProvider implements TtsProvider {
  constructor(private readonly testing?: { dispatch: Dispatch; convert?: Convert; deadlineMs?: number }) {
    if (testing && process.env.NODE_ENV !== 'test') throw new Error('TTS_TEST_INJECTION_REQUIRES_TEST_ENV');
  }
  public async synthesize(input: TtsProviderInput): Promise<TtsProviderResult> { return e2eInference('TTS', () => this.synthesizeInternal(input)); }
  private async synthesizeInternal(input: TtsProviderInput): Promise<TtsProviderResult> {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) throw new Error('TTS_NOT_CONFIGURED');
    if (!input.text.trim() || input.text.length > 4096) throw new Error('TTS_TEXT_TOO_LARGE');
    const model = process.env.TTS_MODEL?.trim() || GEMINI_TTS_MODEL;
    if (model !== GEMINI_TTS_MODEL) throw new Error('TTS_NOT_CONFIGURED');
    if (!['en', 'ja', 'ko', 'zh'].includes(input.language)) throw new Error('TTS_NOT_CONFIGURED');
    const controller = new AbortController();
    let dispatched = false, received = false;
    const timeoutCode = () => received ? 'TTS_CONVERSION_TIMEOUT' : dispatched ? 'TTS_TIMEOUT' : 'TTS_NOT_CONFIGURED';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { const error = new Error(timeoutCode()); controller.abort(); reject(error); }, this.testing?.deadlineMs ?? TTS_DEADLINE_MS); });
    const work = async (): Promise<TtsProviderResult> => {
      const voice = GEMINI_VOICE_MAP[input.voice.toLowerCase()] || input.voice || 'Kore';
      const dispatch: Dispatch = this.testing?.dispatch ?? (async (text, voiceName, signal) => {
        const client = new GoogleGenAI({ apiKey, httpOptions: { timeout: TTS_DEADLINE_MS, retryOptions: { attempts: 1 } } });
        return await client.interactions.create({ model, store: false,
          input: [{ type: 'user_input', content: [{ type: 'text', text }] }],
          response_format: { type: 'audio',mime_type:'audio/wav' }, generation_config: { speech_config: [{ voice: voiceName }] },
        }, { signal, timeout: TTS_DEADLINE_MS, maxRetries: 0 }) as TtsAudioResponse;
      });
      let response: TtsAudioResponse;
      try { dispatched = true; response = await dispatch(input.text, voice, controller.signal); received = true; }
      catch (error) {
        if (controller.signal.aborted || error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) throw new Error('TTS_TIMEOUT');
        // A transport failure after dispatch cannot prove that synthesis did not run.
        throw new Error('TTS_UNCERTAIN');
      }
      if (controller.signal.aborted) throw new Error('TTS_TIMEOUT');
      const encoded = response.output_audio?.data;
      if (!encoded || encoded.length > Math.ceil(MAX_AUDIO_BYTES / 3) * 4 || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('TTS_INVALID_RESPONSE');
      const bytes = Buffer.from(encoded, 'base64');
      const format = audioFormat(bytes);
      const mime = (response.output_audio?.mime_type ?? response.output_audio?.mimeType)?.split(';')[0]?.trim().toLowerCase();
      if (!format || mime && !(format === 'wav' ? ['audio/wav', 'audio/x-wav', 'audio/wave'] : ['audio/mpeg', 'audio/mp3']).includes(mime)) throw new Error('TTS_INVALID_RESPONSE');
      const mp3 = format === 'mp3' ? bytes : await (this.testing?.convert ?? convertWavToMp3)(bytes, controller.signal);
      if (controller.signal.aborted) throw new Error('TTS_CONVERSION_TIMEOUT');
      if (mp3.length > MAX_AUDIO_BYTES || audioFormat(mp3) !== 'mp3') throw new Error('TTS_INVALID_RESPONSE');
      return { audio: new Uint8Array(mp3), format: 'mp3', mimeType: 'audio/mpeg', provider: 'gemini', model };
    };
    try { return await Promise.race([work(), deadline]); }
    finally { if (timer) clearTimeout(timer); }
  }
}
