import { stat } from 'node:fs/promises';
import { Media } from '../models/Media.js';
import { Transcript } from '../models/Transcript.js';
import { Translation } from '../models/Translation.js';
import { Narration } from '../models/Narration.js';
import { Result } from '../models/Result.js';
import { ProcessingJob } from '../models/ProcessingJob.js';
import { TranslationAttempt } from '../models/TranslationAttempt.js';
import { resolveStoredFile } from '../utils/file.js';
import { CUSTOMER_TRANSLATION_TARGETS } from './translation/customer-languages.js';
import { isRevision, jobProvenance, narrationProvenance, resultProvenance, translationProvenance } from './artifact-provenance.service.js';
import { sourceLanguageState, type SourceLanguageState } from './source-language-contract.js';
import type { ProjectWorkflowSummary } from './project-workflow.service.js';

type Artifact = { _id?: unknown; projectId?: unknown; transcriptId?: unknown; revision?: number | null; sourceTranscriptRevision?: number | null;
  translationId?: unknown; sourceTranslationRevision?: number | null; narrationId?: unknown; sourceNarrationRevision?: number | null;
  targetLanguage?: string | null; languageCode?: string | null; status?: string; audioPath?: string | null; videoPath?: string | null; fileSize?: number;
  alignmentFormat?: string | null; sourceRevision?: string | null; review?: { method?: string | null; sourceRevision?: string | null } | null; available?: boolean };
type Job = Artifact & { type: 'TRANSCRIPTION' | 'TRANSLATION' | 'TTS' | 'VIDEO_PROCESSING'; sourceTranscriptId?: unknown;
  sourceTranslationId?: unknown; sourceNarrationId?: unknown; errorMessage?: string | null; createdAt?: Date; completedAt?: Date | null; progress?: number };
type Attempt = { targetLanguage?: string; state?: string; phase?: string | null; draftJson?: string | null; updatedAt?: Date; diagnosticCode?: string | null };
export type TargetProject = SourceLanguageState & { status: string; targetOperation?: { targetLanguage: string; kind: string; startedAt: Date } | null };
export type TargetEvidence = { mediaType: 'AUDIO' | 'VIDEO' | null; transcript: Artifact | null; translations: Artifact[]; narrations: Artifact[]; results: Artifact[]; jobs: Job[]; attempts: Attempt[] };
export type TargetState = 'NOT_STARTED' | 'TRANSLATING' | 'AWAITING_REVIEW' | 'TRANSLATED' | 'GENERATING_AUDIO' | 'AUDIO_READY' | 'PROCESSING_VIDEO' | 'COMPLETED' | 'FAILED' | 'BLOCKED';
const id = (value: unknown) => value == null ? '' : String(value);
const safeCode = (value: unknown) => typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(value) ? value : 'TARGET_PROCESSING_FAILED';

export function resolveTargetWorkflow(project: TargetProject, target: string, evidence: TargetEvidence) {
  const source = sourceLanguageState(project);
  const sourceReady = source.sourceLanguageStatus === 'CONFIRMED' && !!source.sourceLanguage && evidence.transcript?.languageCode === source.sourceLanguage && ['READY', 'SAVED'].includes(evidence.transcript?.status ?? '') && isRevision(evidence.transcript.revision);
  const translations = evidence.translations.filter(row => row.targetLanguage === target && translationProvenance(row, evidence.transcript) === 'CURRENT'
    && row.status === 'READY' && (row.alignmentFormat !== 'GROUPS_V1' || row.review?.method === 'MANUAL_V1' && row.review.sourceRevision === row.sourceRevision));
  const narrations = evidence.narrations.filter(row => row.languageCode === target && row.status === 'READY' && row.available === true && translations.some(translation => narrationProvenance(row, translation, 'CURRENT') === 'CURRENT'));
  const results = evidence.results.filter(row => row.languageCode === target && row.available === true && narrations.some(narration => resultProvenance(row, narration, 'CURRENT') === 'CURRENT'));
  const jobs = evidence.jobs.filter(job => job.targetLanguage === target && job.type !== 'TRANSCRIPTION' && jobProvenance(job, {
    transcript: evidence.transcript,
    translation: translations.find(row => id(row._id) === id(job.sourceTranslationId)),
    narration: narrations.find(row => id(row._id) === id(job.sourceNarrationId)),
  }) === 'CURRENT').sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0) || id(b._id).localeCompare(id(a._id)));
  const job = jobs[0];
  let state: TargetState = 'NOT_STARTED';
  let step: ProjectWorkflowSummary['step'] = 'TRANSLATION';
  let failureCode: string | null = null;
  let consumed = false;
  for (const attempt of evidence.attempts.filter(row => row.targetLanguage === target)) {
    if (!attempt.draftJson) {
      // Claims from another revision cannot grant retry permission. Be conservative.
      if (['CLAIMED', 'UNCERTAIN', 'FAILED_PRE_DISPATCH', 'FAILED_RESPONSE'].includes(attempt.state ?? '')) {
        consumed = true;
        const pending = attempt.state === 'CLAIMED' && Date.now() - (attempt.updatedAt?.getTime() ?? 0) < 180000;
        state = pending ? 'TRANSLATING' : 'FAILED'; failureCode = pending ? null : safeCode(attempt.diagnosticCode ?? 'TRANSLATION_ATTEMPT_UNCERTAIN');
      }
      continue;
    }
    try {
      if (Buffer.byteLength(attempt.draftJson) > 131072) continue;
      const draft = JSON.parse(attempt.draftJson);
      if (draft.targetLanguage === target && id(draft.transcriptId) === id(evidence.transcript?._id) && draft.transcriptRevision === evidence.transcript?.revision && draft.sourceLanguage === source.sourceLanguage && draft.state === 'DRAFT') {
        consumed = true;
        state = Date.parse(draft.expiresAt) > Date.now() ? 'AWAITING_REVIEW' : 'FAILED';
        if (state === 'FAILED') failureCode = 'TRANSLATION_DRAFT_EXPIRED';
      }
    } catch { consumed = true; state = 'FAILED'; failureCode = 'TRANSLATION_ATTEMPT_UNCERTAIN'; }
  }
  if (translations.length) { state = 'TRANSLATED'; step = 'VOICE'; failureCode = null; }
  if (narrations.length) { state = evidence.mediaType === 'AUDIO' ? 'COMPLETED' : 'AUDIO_READY'; step = evidence.mediaType === 'AUDIO' ? 'RESULT' : 'GENERATE'; }
  if (results.length && evidence.mediaType === 'VIDEO') { state = 'COMPLETED'; step = 'RESULT'; }
  const missingAudio = evidence.narrations.some(row => row.languageCode === target && row.status === 'READY' && row.available === false && translations.some(translation => narrationProvenance(row, translation, 'CURRENT') === 'CURRENT'));
  const missingVideo = evidence.results.some(row => row.languageCode === target && row.available === false && narrations.some(narration => resultProvenance(row, narration, 'CURRENT') === 'CURRENT'));
  if (missingAudio && !narrations.length || missingVideo && !results.length) { state = 'FAILED'; step = missingVideo ? 'GENERATE' : 'VOICE'; failureCode = missingVideo ? 'RESULT_FILE_MISSING' : 'NARRATION_FILE_MISSING'; }
  if (job?.status === 'FAILED') { state = 'FAILED'; step = job.type === 'TTS' ? 'VOICE' : job.type === 'VIDEO_PROCESSING' ? 'GENERATE' : 'TRANSLATION'; failureCode = safeCode(job.errorMessage); }
  const operation = project.targetOperation?.targetLanguage === target ? project.targetOperation : null;
  const activeJob = job && ['QUEUED', 'PROCESSING'].includes(job.status ?? '') ? job : null;
  if (activeJob || operation && state !== 'FAILED') {
    const kind = activeJob?.type ?? operation?.kind;
    step = kind === 'TTS' ? 'VOICE' : kind === 'VIDEO_PROCESSING' ? 'GENERATE' : 'TRANSLATION';
    state = step === 'VOICE' ? 'GENERATING_AUDIO' : step === 'GENERATE' ? 'PROCESSING_VIDEO' : 'TRANSLATING';
  }
  if (!sourceReady || source.sourceLanguage === target || !evidence.mediaType) { state = 'BLOCKED'; failureCode = !sourceReady ? 'SOURCE_LANGUAGE_UNCONFIRMED' : 'TARGET_NOT_AVAILABLE'; }
  const processing = ['TRANSLATING', 'GENERATING_AUDIO', 'PROCESSING_VIDEO'].includes(state);
  const allowedLegacyState = ['TRANSCRIBED', 'TRANSLATED', 'GENERATING_AUDIO', 'FAILED', 'COMPLETED'].includes(project.status);
  const blockedElsewhere = !!project.targetOperation || evidence.jobs.some(row => ['QUEUED', 'PROCESSING'].includes(row.status ?? ''));
  const canResume = sourceReady && allowedLegacyState && !blockedElsewhere && state !== 'BLOCKED' && state !== 'COMPLETED' && !processing
    && !['RESULT_FILE_MISSING', 'NARRATION_FILE_MISSING'].includes(failureCode ?? '')
    && !(step === 'TRANSLATION' && consumed && state !== 'AWAITING_REVIEW');
  const workflow: ProjectWorkflowSummary = { step, state: processing ? 'PROCESSING' : state === 'FAILED' ? 'FAILED' : state === 'COMPLETED' ? 'COMPLETED' : state === 'BLOCKED' ? 'BLOCKED' : 'READY',
    canResume, mediaType: evidence.mediaType, targetLanguage: { code: target, source: results.length ? 'RESULT' : narrations.length ? 'NARRATION' : translations.length ? 'TRANSLATION' : 'JOB' },
    processing: activeJob ? { jobId: id(activeJob._id), type: activeJob.type, status: activeJob.status as 'QUEUED' | 'PROCESSING', progress: activeJob.progress ?? 0 } : null,
    failure: failureCode ? { jobId: id(job?._id), type: job?.type ?? 'TRANSLATION', code: failureCode, failedAt: job?.completedAt?.toISOString() ?? '' } : null,
    artifact: { narrationReady: narrations.length > 0, resultReady: results.length > 0 } };
  return { targetLanguage: target, status: state, failureCode, workflow, translationIds: translations.map(row => id(row._id)), narrationIds: narrations.map(row => id(row._id)), resultIds: results.map(row => id(row._id)) };
}

async function available(path?: string | null, fileSize?: number) {
  if (!path || !fileSize || fileSize <= 0) return false;
  try { const info = await stat(resolveStoredFile(path)); return info.isFile() && info.size === fileSize; } catch { return false; }
}

export async function resolveTargetWorkflows(projectId: string, project: TargetProject) {
  const [media, transcript, translations, narrations, results, jobs, attempts] = await Promise.all([
    Media.findOne({ projectId }).select('mediaType'), Transcript.findOne({ projectId }).select('_id languageCode revision status'),
    Translation.find({ projectId, targetLanguage: { $in: [...CUSTOMER_TRANSLATION_TARGETS] } }), Narration.find({ projectId, status: 'READY' }), Result.find({ projectId }),
    ProcessingJob.find({ projectId }).sort({ createdAt: -1 }), TranslationAttempt.find({ projectId }).select('targetLanguage state phase updatedAt diagnosticCode draftJson'),
  ]);
  const audio = await Promise.all(narrations.map(async row => ({ ...row.toObject(), available: await available(row.audioPath, row.fileSize) })));
  const video = await Promise.all(results.map(async row => ({ ...row.toObject(), available: await available(row.videoPath, row.fileSize) })));
  const evidence: TargetEvidence = { mediaType: media?.mediaType ?? null, transcript, translations, narrations: audio, results: video, jobs, attempts };
  return CUSTOMER_TRANSLATION_TARGETS.filter(target => target !== project.sourceLanguage).map(target => resolveTargetWorkflow(project, target, evidence));
}

export const targetWorkflowReader = { read: resolveTargetWorkflows };
