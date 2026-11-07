import { AsyncLocalStorage } from 'node:async_hooks';
import { e2eRunEnabled } from './e2e-test-run.js';
import { randomUUID } from 'node:crypto';
import { Project } from '../models/Project.js';
import { ProcessingJob } from '../models/ProcessingJob.js';
import { AppError } from '../utils/app-error.js';

type Fence = { projectId: string; ownerId: string; targetLanguage: string; token: string };
const context = new AsyncLocalStorage<Fence>();
const busy = () => new AppError(409, 'PROJECT_TARGET_BUSY', 'Dự án đang xử lý một ngôn ngữ. Chỉ tải lại trạng thái; không gửi thêm yêu cầu.');
async function release(projectId: string, ownerId: string, token: string) {
  const released = await Project.updateOne({ _id: projectId, userId: ownerId, 'targetOperation.token': token }, { $unset: { targetOperation: 1 } }, { writeConcern: { w: 'majority', j: true } });
  if (released.matchedCount !== 1) throw new AppError(503, 'PROJECT_TARGET_FENCE_UNAVAILABLE', 'Chưa xác nhận được khóa dự án. Chỉ tải lại trạng thái.');
}

async function run<T>(projectId: string, ownerId: string, targetLanguage: string, kind: string, work: () => Promise<T>): Promise<T> {
  const inherited = context.getStore();
  if (inherited) {
    if (inherited.projectId !== projectId || inherited.ownerId !== ownerId || inherited.targetLanguage !== targetLanguage) throw busy();
    return work();
  }
  const token = randomUUID();
  const claimed = await Project.findOneAndUpdate({ _id: projectId, userId: ownerId, targetOperation: null,
    status: { $nin: ['TRANSCRIBING', 'TRANSLATING'] } },
  { $set: { targetOperation: { token, targetLanguage, kind, startedAt: new Date() } } }, { returnDocument: 'after', writeConcern: { w: 'majority', j: true } });
  if (!claimed) {
    if (!await Project.exists({ _id: projectId, userId: ownerId })) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Không tìm thấy dự án.');
    throw busy();
  }
  let retain = false;
  try {
    if (await ProcessingJob.exists({ projectId, status: { $in: ['QUEUED', 'PROCESSING'] } })) throw busy();
    return await context.run({ projectId, ownerId, targetLanguage, token }, work);
  } catch (error) {
    // An uncertain paid dispatch must not be made concurrent with another target.
    // There is deliberately no TTL/automatic takeover; operator recovery is separate.
    retain = e2eRunEnabled() || error instanceof AppError && ['TRANSLATION_ATTEMPT_UNCERTAIN', 'TRANSLATION_ATTEMPT_IN_PROGRESS', 'TRANSLATION_ATTEMPT_FENCE_FAILED', 'TRANSLATION_QUOTA_UNAVAILABLE', 'TRANSLATION_TIMEOUT', 'TRANSLATION_NETWORK_ERROR', 'TRANSLATION_PROVIDER_ERROR', 'TTS_TIMEOUT', 'TTS_UNCERTAIN'].includes(error.code);
    throw error;
  } finally {
    if (!retain) {
      await release(projectId, ownerId, token);
    }
  }
}

export const targetOperations = { run };
