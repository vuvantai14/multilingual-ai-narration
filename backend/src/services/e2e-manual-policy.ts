import { SOURCE_LANGUAGES } from './source-language-contract.js';

export const MANUAL_RUN_CONTRACT = 'S33_MANUAL_RUN_V1';
export const MANUAL_MEDIA_BYTES = 200 * 1024 * 1024;
export const MANUAL_MEDIA_SECONDS = 1800;
export const MANUAL_TARGETS = ['en', 'ja', 'ko', 'zh'];
export class ManualRunSelections {
  source?: string;
  target?: string;
  voiceId?: string;
  constructor(private readonly record: (event: string) => void) {}
  claimSource(code: unknown) {
    if (!SOURCE_LANGUAGES.includes(code as never) || this.source && this.source !== code) throw Error('S33_SOURCE_CLAIM_DENIED');
    if (!this.source) { this.record(`S33_SOURCE_CLAIM_${code}`); this.source = String(code); }
    return this.source;
  }
  claimTarget(code: unknown) {
    if (!this.source || !MANUAL_TARGETS.includes(String(code)) || code === this.source || this.target && this.target !== code) throw Error('S33_TARGET_CLAIM_DENIED');
    if (!this.target) { this.record(`S33_TARGET_CLAIM_${code}`); this.target = String(code); }
    return this.target;
  }
  claimVoice(id: string, name: unknown, language: unknown) {
    if (!this.target || language !== this.target || !['Kore', 'Fenrir'].includes(String(name)) || !/^[a-f0-9]{24}$/.test(id) || this.voiceId && this.voiceId !== id) throw Error('S33_VOICE_CLAIM_DENIED');
    if (!this.voiceId) { this.record(`S33_VOICE_CLAIM_${id}`); this.voiceId = id; }
    return this.voiceId;
  }
}
