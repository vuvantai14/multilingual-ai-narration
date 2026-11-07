import type { TtsProvider, TtsProviderInput, TtsProviderResult } from './tts-provider.interface.js';
import { OpenAiTtsProvider } from './openai-tts.provider.js';
import { GeminiTtsProvider } from './gemini-tts.provider.js';

let testProvider: TtsProvider | undefined;

class ResilientTtsProvider implements TtsProvider {
  private openai = new OpenAiTtsProvider();
  private gemini = new GeminiTtsProvider();

  public async synthesize(input: TtsProviderInput): Promise<TtsProviderResult> {
    const provider = process.env.TTS_PROVIDER?.trim().toLowerCase() || 'openai';
    if (provider === 'gemini') {
      return this.gemini.synthesize(input);
    }
    return this.openai.synthesize(input);
  }
}

export const getTtsProvider = (): TtsProvider => {
  if (testProvider) return testProvider;
  const provider = process.env.TTS_PROVIDER?.trim().toLowerCase();
  if (provider !== 'openai' && provider !== 'gemini') throw new Error('TTS_NOT_CONFIGURED');
  return new ResilientTtsProvider();
};

export const setTtsProviderForTests = (provider?: TtsProvider): void => { testProvider = provider; };
