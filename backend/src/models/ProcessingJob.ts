import { model, Schema, type InferSchemaType } from 'mongoose';
import { PROCESSING_JOB_STATUSES, PROCESSING_JOB_TYPES } from '../constants/processing-job.constants.js';
import { STT_STAGES } from '../services/stt/stt-evidence.js';

const processingJobSchema = new Schema(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    type: { type: String, enum: PROCESSING_JOB_TYPES, required: true },
    targetLanguage: { type: String, trim: true, lowercase: true },
    voiceId: { type: Schema.Types.ObjectId, ref: 'Voice' },
    narrationId: { type: Schema.Types.ObjectId, ref: 'Narration' },
    sourceTranscriptId: { type: Schema.Types.ObjectId, ref: 'Transcript' },
    sourceTranscriptRevision: { type: Number, min: 1, validate: Number.isInteger },
    sourceTranslationId: { type: Schema.Types.ObjectId, ref: 'Translation' },
    sourceTranslationRevision: { type: Number, min: 1, validate: Number.isInteger },
    sourceNarrationId: { type: Schema.Types.ObjectId, ref: 'Narration' },
    sourceNarrationRevision: { type: Number, min: 1, validate: Number.isInteger },
    status: { type: String, enum: PROCESSING_JOB_STATUSES, required: true, default: 'QUEUED', index: true },
    progress: { type: Number, required: true, default: 0, min: 0, max: 100 },
    errorMessage: { type: String, trim: true },
    // Optional, operator-only evidence for FUTURE jobs; no backfill/migration.
    // FAILED job lifecycle does not imply safe pre-dispatch failure.
    sttEvidence:{type:new Schema({
      contract:{type:String,enum:['GEMINI_STT_EVIDENCE_V1']},stage:{type:String,enum:STT_STAGES},
      startedAt:String,stageStartedAt:String,observedAt:String,inferenceDispatchAt:String,inferenceResponseAt:String,
      httpStatus:{type:Number,min:200,max:599},providerErrorCode:{type:String,maxlength:80},
      requestId:{type:String,maxlength:128},operationId:{type:String,maxlength:128},
      inferenceState:{type:String,enum:['NOT_DISPATCHED','INVOKED','RESPONSE_RECEIVED']},
      outcome:{type:String,enum:['IN_PROGRESS','FAILED_PRE_DISPATCH','UNCERTAIN','FAILED_RESPONSE','SUCCEEDED']},
      timeline:{type:new Schema({policy:{type:String,enum:['BOUNDED_TIMELINE_V1']},toleranceMs:{type:Number,enum:[50]},pointWords:Number,duplicateIntervals:Number,overlaps:Number,maxAdjustmentMs:{type:Number,min:0,max:50}},{_id:false})},
      providerAccepted:{type:String,enum:['YES','NO','UNKNOWN']},retryAllowed:{type:Boolean,enum:[false]},cleanupFailed:Boolean,
    },{_id:false}),select:false},
    // Operator diagnostics only; ordinary Customer/Admin job responses exclude it.
    diagnostics: { type: new Schema({
      stage: String, code: String, durationMs: Number, exitCode: Number,
      signal: String, systemCode: String, errorName: String, stderr: { type: String, maxlength: 2000 },
    }, { _id: false }), select: false },
    startedAt: { type: Date },
    completedAt: { type: Date },
  },
  { timestamps: true },
);

processingJobSchema.index({ projectId: 1, createdAt: -1 });
processingJobSchema.index({ status: 1, type: 1, createdAt: -1 });
processingJobSchema.index(
  { projectId: 1, type: 1, targetLanguage: 1, status: 1 },
  { unique: true, partialFilterExpression: { type: 'TRANSLATION', status: 'PROCESSING' } },
);
processingJobSchema.index(
  { projectId: 1, type: 1, narrationId: 1, status: 1 },
  { unique: true, partialFilterExpression: { type: 'VIDEO_PROCESSING', status: 'PROCESSING' } },
);
processingJobSchema.index(
  { projectId: 1, type: 1, targetLanguage: 1, voiceId: 1, status: 1 },
  { unique: true, partialFilterExpression: { type: 'TTS', status: 'PROCESSING' } },
);

export type ProcessingJobDocument = InferSchemaType<typeof processingJobSchema>;
export const ProcessingJob = model<ProcessingJobDocument>('ProcessingJob', processingJobSchema);
