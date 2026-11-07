export interface SttSegment { start: number; end: number; text: string }
import type { SttEvidence } from './stt-evidence.js';
import type { TimelineDiagnostic } from './normalize-timeline.js';
import type { LanguageDetection, SourceLanguageMode } from '../source-language-contract.js';
export interface SttResult { text: string; language?: string; languageDetection?: LanguageDetection; duration?: number; segments: SttSegment[]; evidence?:SttEvidence; timelineDiagnostic?:TimelineDiagnostic }
export interface SttInput { filePath: string; mimeType: string; language?: string; sourceLanguageMode?: SourceLanguageMode; onEvidence?:(evidence:SttEvidence)=>void }
export interface SttProvider { transcribe(input: SttInput): Promise<SttResult> }
