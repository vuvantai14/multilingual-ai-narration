import type { MediaType } from './types'

export const MAX_MEDIA_FILE_SIZE = 200 * 1024 * 1024
export type UploadStatus = 'idle' | 'selected' | 'validating' | 'uploading' | 'success' | 'failed' | 'cancelled'
export type MediaFile = { name?: string; size?: number; mimeType?: string | null }

const extensionMimes: Record<string, string[]> = {
  mp4: ['video/mp4'], mov: ['video/quicktime'], webm: ['video/webm', 'audio/webm'],
  mp3: ['audio/mpeg', 'audio/mp3'], wav: ['audio/wav', 'audio/x-wav'], m4a: ['audio/mp4', 'audio/x-m4a', 'audio/m4a'],
}
const knownMimeTypes: Record<string, MediaType> = {
  'video/mp4': 'VIDEO', 'video/quicktime': 'VIDEO', 'video/webm': 'VIDEO',
  'audio/mpeg': 'AUDIO', 'audio/mp3': 'AUDIO', 'audio/wav': 'AUDIO', 'audio/x-wav': 'AUDIO',
  'audio/mp4': 'AUDIO', 'audio/x-m4a': 'AUDIO', 'audio/m4a': 'AUDIO', 'audio/webm': 'AUDIO',
}
export function uploadMimeType(file: MediaFile): string | null {
  const extension = file.name?.split('.').pop()?.toLowerCase()
  if (!extension || !extensionMimes[extension]) return null
  const mime = file.mimeType?.toLowerCase().split(';')[0].trim()
  return !mime || mime === 'application/octet-stream' ? extensionMimes[extension][0]! : extensionMimes[extension].includes(mime) ? mime : null
}

export function getMediaType(file: MediaFile): MediaType | null {
  const extension = file.name?.split('.').pop()?.toLowerCase()
  if (!extension || !extensionMimes[extension]) return null
  const byExtension = ['mp4', 'mov', 'webm'].includes(extension) ? 'VIDEO' : 'AUDIO'
  const mime = file.mimeType?.toLowerCase().split(';')[0].trim()
  if (!mime || mime === 'application/octet-stream') return byExtension
  const byMime = knownMimeTypes[mime]
  return byMime && extensionMimes[extension].includes(mime) ? byMime : null
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const unit = bytes < 1024 ** 2 ? 'KB' : bytes < 1024 ** 3 ? 'MB' : 'GB'
  const divisor = unit === 'KB' ? 1024 : unit === 'MB' ? 1024 ** 2 : 1024 ** 3
  return `${Number((bytes / divisor).toFixed(1))} ${unit}`
}

export function validateMediaFile(file: MediaFile | null, maxFileSize = MAX_MEDIA_FILE_SIZE): { valid: true; mediaType: MediaType } | { valid: false; error: string } {
  if (!file) return { valid: false, error: 'Hãy chọn một tệp video hoặc âm thanh.' }
  if (!file.name?.trim()) return { valid: false, error: 'Không có tên tệp.' }
  const mediaType = getMediaType(file)
  if (!mediaType) return { valid: false, error: 'Định dạng tệp không được hỗ trợ. Hãy dùng MP4, MOV, WEBM, MP3, WAV hoặc M4A.' }
  if (typeof file.size !== 'number' || !Number.isFinite(file.size) || file.size <= 0) return { valid: false, error: 'Không xác định được dung lượng hoặc tệp đang trống.' }
  if (file.size > maxFileSize) return { valid: false, error: `Tệp vượt dung lượng tối đa cho phép (${formatFileSize(maxFileSize)}).` }
  return { valid: true, mediaType }
}

export function validateProjectName(name: string): string | null {
  return name.trim().length >= 3 ? null : 'Tên dự án phải có ít nhất 3 ký tự.'
}
