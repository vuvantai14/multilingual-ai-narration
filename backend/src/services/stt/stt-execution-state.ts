import { ProcessingJob } from '../../models/ProcessingJob.js';
import type { SttEvidence } from './stt-evidence.js';

type StoredEvidence = { [K in 'contract' | 'outcome' | 'inferenceState' | 'providerAccepted' | 'inferenceDispatchAt']?: SttEvidence[K] | null };
export function sttExecutionState(job: { status: string; errorMessage?: string | null; sttEvidence?: StoredEvidence | null } | null) {
  if (!job) return { state: 'NOT_STARTED', retryAllowed: true } as const;
  if (job.status === 'COMPLETED') return { state: 'COMPLETED', retryAllowed: false } as const;
  if (['PROCESSING', 'QUEUED'].includes(job.status)) return { state: 'PROCESSING', retryAllowed: false } as const;
  const e = job.sttEvidence;
  if (e?.contract === 'GEMINI_STT_EVIDENCE_V1' && e.outcome === 'FAILED_RESPONSE' && e.providerAccepted === 'YES' && e.inferenceState === 'RESPONSE_RECEIVED') return { state: 'FAILED', retryAllowed: false, errorCode: job.errorMessage ?? null } as const;
  const safe = e?.contract === 'GEMINI_STT_EVIDENCE_V1' && e.outcome === 'FAILED_PRE_DISPATCH' && e.inferenceState === 'NOT_DISPATCHED' && e.providerAccepted === 'NO' && !e.inferenceDispatchAt;
  return { state: safe ? 'FAILED' : 'UNCERTAIN', retryAllowed: Boolean(safe), errorCode: job.errorMessage ?? null } as const;
}
export async function readSttExecutionState(projectId: string) {
  const job = await ProcessingJob.findOne({ projectId, type: 'TRANSCRIPTION' }).sort({ createdAt: -1, _id: -1 }).select('status errorMessage +sttEvidence');
  return sttExecutionState(job);
}
