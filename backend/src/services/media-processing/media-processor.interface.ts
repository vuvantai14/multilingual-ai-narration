import type { ProcessingStage } from './processing-diagnostics.js';
export interface MediaProbeResult {
  duration: number;
  format: string;
  fileSize: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width?: number;
  height?: number;
  videoCodec?: string;
  audioCodec?: string;
}

export interface ComposeNarrationInput {
  sourceVideoPath: string;
  narrationAudioPath: string;
  outputPath: string;
}

export interface MediaProcessingResult extends MediaProbeResult {
  mimeType: 'video/mp4';
}

export interface MediaProcessor {
  probe(inputPath: string, stage?: ProcessingStage): Promise<MediaProbeResult>;
  verifyInput?(inputPath: string): Promise<void>;
  verifyNarrationAudio?(inputPath: string): Promise<void>;
  composeNarration(input: ComposeNarrationInput): Promise<MediaProcessingResult>;
}
