import { open, stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { env } from '../config/env.js';
import { MAX_TRANSCRIPTION_DURATION_SECONDS } from '../config/media-limits.js';
import { AppError } from '../utils/app-error.js';
import { getMediaProcessor } from './media-processing/media-processing.service.js';
import { MediaProcessingError } from './media-processing/processing-diagnostics.js';

// This pipeline requires word timestamps. Plain-transcript limits do not apply.
export const MAX_MEDIA_DURATION_SECONDS = MAX_TRANSCRIPTION_DURATION_SECONDS;
export const mediaRules = {
  '.mp4': { type: 'VIDEO', mimes: ['video/mp4'], formats: ['mp4'] },
  '.mov': { type: 'VIDEO', mimes: ['video/quicktime'], formats: ['mov'] },
  '.webm': { type: 'VIDEO', mimes: ['video/webm', 'audio/webm'], formats: ['webm', 'matroska'] },
  '.mp3': { type: 'AUDIO', mimes: ['audio/mpeg', 'audio/mp3'], formats: ['mp3'] },
  '.wav': { type: 'AUDIO', mimes: ['audio/wav', 'audio/x-wav'], formats: ['wav'] },
  '.m4a': { type: 'AUDIO', mimes: ['audio/mp4', 'audio/m4a', 'audio/x-m4a'], formats: ['mov', 'mp4', 'm4a'] },
} as const;
export function mediaLimits() {
  return { maxFileSize: Math.min(Math.floor(env.maxUploadSizeMb * 1024 * 1024), 500 * 1024 * 1024), maxDurationSeconds: MAX_MEDIA_DURATION_SECONDS,
    formats: Object.entries(mediaRules).map(([extension, rule]) => ({ extension, mimeTypes: [...rule.mimes] })) };
}
export function validateMediaName(name: string, mime: string) {
  const extension = extname(name).toLowerCase();
  const rule = mediaRules[extension as keyof typeof mediaRules];
  if (!rule || !(rule.mimes as readonly string[]).includes(mime)) throw new AppError(415, 'MEDIA_TYPE_MISMATCH', 'Định dạng hoặc MIME của tệp không được hỗ trợ hoặc không khớp phần mở rộng.');
  return { extension, rule };
}
export async function validateUploadedMedia(file: { path: string; originalname: string; mimetype: string; size: number }) {
  const { extension, rule } = validateMediaName(file.originalname, file.mimetype);
  const info = await stat(file.path);
  if (info.size > mediaLimits().maxFileSize || file.size > mediaLimits().maxFileSize) throw new AppError(413, 'FILE_TOO_LARGE', 'Tệp vượt dung lượng tối đa cho phép.');
  if (!info.isFile() || info.size <= 0 || info.size !== file.size) throw new AppError(422, 'MEDIA_INVALID_FILE', 'Tệp trống, hỏng hoặc không đọc được.');
  const handle = await open(file.path, 'r');
  const head = Buffer.alloc(16);
  try { await handle.read(head, 0, head.length, 0); } finally { await handle.close(); }
  const signature = extension === '.mp3' ? head.toString('ascii', 0, 3) === 'ID3' || head[0] === 255 && (head[1]! & 224) === 224
    : extension === '.wav' ? head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WAVE'
    : extension === '.webm' ? head.readUInt32BE(0) === 0x1a45dfa3 : head.toString('ascii', 4, 8) === 'ftyp';
  if (!signature) throw new AppError(422, 'MEDIA_INVALID_FILE', 'Nội dung tệp không khớp định dạng hoặc tệp đã hỏng.');
  try {
    const processor = getMediaProcessor();
    const probe = await processor.probe(file.path, 'PROBE_SOURCE');
    if (probe.duration > MAX_MEDIA_DURATION_SECONDS) throw new AppError(422, 'MEDIA_DURATION_EXCEEDED', `Thời lượng media vượt giới hạn xử lý ${MAX_MEDIA_DURATION_SECONDS} giây.`);
    if (!probe.hasAudio) throw new AppError(422, 'MEDIA_AUDIO_REQUIRED', 'Tệp không có âm thanh để tạo bản ghi.');
    const mediaType = probe.hasVideo ? 'VIDEO' : 'AUDIO';
    if ((rule.type === 'AUDIO' || file.mimetype === 'audio/webm') && probe.hasVideo || !(rule.formats as readonly string[]).some(f => probe.format.split(',').includes(f))) throw new AppError(415, 'MEDIA_TYPE_MISMATCH', 'Stream hoặc container không khớp loại tệp đã chọn.');
    if (!['mp3', 'aac', 'opus', 'vorbis', 'pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_f32le', 'pcm_f64le', 'alac'].includes(probe.audioCodec ?? '') || probe.hasVideo && !['h264', 'hevc', 'vp8', 'vp9', 'av1', 'mpeg4', 'prores'].includes(probe.videoCodec ?? '')) throw new AppError(415, 'MEDIA_CODEC_UNSUPPORTED', 'Định dạng hoặc codec không được hỗ trợ.');
    await processor.verifyInput?.(file.path);
    const mimeType = mediaType === 'AUDIO' && file.mimetype.startsWith('video/') ? extension === '.webm' ? 'audio/webm' : 'audio/mp4'
      : ({ 'audio/mp3': 'audio/mpeg', 'audio/x-wav': 'audio/wav', 'audio/m4a': 'audio/mp4', 'audio/x-m4a': 'audio/mp4' } as Record<string, string>)[file.mimetype] ?? file.mimetype;
    return { ...probe, mediaType, mimeType };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof MediaProcessingError && error.diagnostics.code === 'FFMPEG_NOT_AVAILABLE') throw new AppError(503, 'FFMPEG_NOT_AVAILABLE', 'FFmpeg hoặc FFprobe chưa khả dụng.');
    throw new AppError(422, 'MEDIA_INVALID_FILE', 'Tệp âm thanh/video hỏng hoặc không thể giải mã.');
  }
}
