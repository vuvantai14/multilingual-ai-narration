import { validateUploadedMedia } from './media-validation.js';
import { scopedAudit } from './e2e-runtime-boundary.js';
import { guardedActualWriter } from './e2e-runtime-boundary.js';
import type { Types } from 'mongoose';
import type { Express } from 'express';
import { ActivityLog } from '../models/ActivityLog.js';
import { Media, type MediaDocument } from '../models/Media.js';
import { Project } from '../models/Project.js';
import { Transcript } from '../models/Transcript.js';
import { ProcessingJob } from '../models/ProcessingJob.js';
import { targetOperations } from './target-operation.service.js';
import { e2eRunEnabled } from './e2e-test-run.js';
import { readSttExecutionState } from './stt/stt-execution-state.js';
import { AppError } from '../utils/app-error.js';
import { safeDeleteStoredFile, safeOriginalName } from '../utils/file.js';
import { toStoragePath } from '../middleware/upload.middleware.js';

const serialize = (media: MediaDocument & { _id: Types.ObjectId; createdAt: Date; updatedAt: Date }) => ({
  id: media._id.toString(), projectId: media.projectId.toString(), originalName: media.originalName,
  mediaType: media.mediaType, mimeType: media.mimeType, fileSize: media.fileSize,
  duration: media.duration ?? null, createdAt: media.createdAt, updatedAt: media.updatedAt,
});

const log = async (userId: string, action: string, entityId: Types.ObjectId, description: string) => {
  try { await scopedAudit(() => ActivityLog.create({ userId, action, entityType: 'Media', entityId, description })); } catch { /* best effort */ }
};

export const upload = async (projectId: string, userId: string, file: Express.Multer.File) => {
  let entered = false;
  const work = () => { entered = true; return uploadInternal(projectId, userId, file); };
  try {
    return await guardedActualWriter({ projectId, ownerId: userId }, () => e2eRunEnabled()
      ? work()
      : targetOperations.run(projectId, userId, 'SOURCE_MEDIA', 'MEDIA_UPLOAD', work), 'Media');
  } catch (error) {
    // An upload rejected before entering the writer still owns its unique new file.
    // A failed/ambiguous read must preserve it, never delete a potentially committed original.
    if (!entered && !e2eRunEnabled()) { try { if (!await Media.exists({ projectId, storagePath: toStoragePath(file.path) })) await safeDeleteStoredFile(toStoragePath(file.path)); } catch { /* keep for explicit inspection */ } }
    throw error;
  }
};
const uploadInternal = async (projectId: string, userId: string, file: Express.Multer.File) => {
  const storagePath = toStoragePath(file.path);
  let metadataWriteStarted = false;
  try {
    if (!await Project.exists({ _id: projectId, userId })) throw new AppError(404, 'PROJECT_NOT_FOUND', 'Không tìm thấy dự án.');
    if (await Transcript.exists({ projectId })) throw new AppError(409, 'SOURCE_MEDIA_LOCKED', 'Dự án đã có bản ghi. Không thay thế tệp nguồn và artifact hiện có.');
    if (await ProcessingJob.exists({ projectId, status: { $in: ['QUEUED', 'PROCESSING'] } })) throw new AppError(409, 'PROJECT_TARGET_BUSY', 'Dự án đang xử lý. Không thay thế tệp nguồn.');
    if ((await readSttExecutionState(projectId)).state === 'UNCERTAIN') throw new AppError(409, 'SOURCE_MEDIA_LOCKED', 'Lần tạo bản ghi trước chưa xác định kết quả. Giữ nguyên tệp nguồn; không tải lại hoặc thay thế.');
    const old = await Media.findOne({ projectId });
    const validated = await validateUploadedMedia(file);
    const mediaType = validated.mediaType;
    metadataWriteStarted = true;
    const media = await Media.findOneAndUpdate(
      { projectId },
      { $set: { originalName: safeOriginalName(file.originalname), fileName: file.filename, mediaType, mimeType: validated.mimeType, fileSize: file.size, storagePath, duration: validated.duration } },
      { upsert: true, returnDocument: 'after', runValidators: true },
    );
    await Project.updateOne({ _id: projectId, userId }, { $set: { status: 'UPLOADED', progress: 0 } });
    // Preserve previous originals/artifacts. Cleanup is an explicit retention task.
    void log(userId, old ? 'MEDIA_REPLACED' : 'MEDIA_UPLOADED', media._id, old ? 'Media nguồn đã được thay thế.' : 'Media nguồn đã được tải lên.');
    return serialize(media);
  } catch (error) {
    if (!metadataWriteStarted) await safeDeleteStoredFile(storagePath);
    throw error;
  }
};

export const get = async (projectId: string) => {
  const media = await Media.findOne({ projectId });
  if (!media) throw new AppError(404, 'MEDIA_NOT_FOUND', 'Không tìm thấy media nguồn.');
  return serialize(media);
};

export const remove = async (projectId: string, userId: string) => {
  const media = await Media.findOneAndDelete({ projectId });
  if (!media) throw new AppError(404, 'MEDIA_NOT_FOUND', 'Không tìm thấy media nguồn.');
  await Project.updateOne({ _id: projectId, userId }, { $set: { status: 'DRAFT', progress: 0 } });
  await safeDeleteStoredFile(media.storagePath);
  void log(userId, 'MEDIA_DELETED', media._id, 'Media nguồn đã được xóa.');
};
