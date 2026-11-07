import { api } from '../../lib/api'
import type { LanguageCode, SourceLanguageMode } from './types'
import { createSourcePayload } from './sourceLanguage'
import { uploadMimeType } from './mediaUpload'

export type UploadOptions = { projectId?: string; onProjectCreated?: (id: string) => void; projectName: string; description: string; sourceLanguage?: LanguageCode; sourceLanguageMode?: SourceLanguageMode; file: File; signal: AbortSignal; onProgress: (progress: number) => void }
export type ExistingProjectUploadOptions = { projectId: string; file: File; signal: AbortSignal; onProgress: (progress: number) => void }
type CreatedProject = { project: { id: string } }

export async function uploadMediaToProject({ projectId, file, signal, onProgress }: ExistingProjectUploadOptions): Promise<void> {
  onProgress(0)
  const form = new FormData()
  const mime = uploadMimeType({ name: file.name, mimeType: file.type })
  form.append('file', mime && file.type !== mime ? new Blob([file], { type: mime }) : file, file.name)
  await api(`/projects/${encodeURIComponent(projectId)}/media`, { method: 'POST', signal, body: form })
  onProgress(100)
}

export async function uploadProjectMedia({ projectName, description, sourceLanguage, sourceLanguageMode, file, signal, onProgress, projectId, onProjectCreated }: UploadOptions): Promise<void> {
  onProgress(0)
  const source = createSourcePayload(sourceLanguageMode ?? (sourceLanguage ? 'MANUAL' : 'AUTO'), sourceLanguage)
  const project = projectId ? { id: projectId } : (await api<CreatedProject>('/projects', { method: 'POST', signal, body: JSON.stringify({ name: projectName, description, ...source }) })).project
  onProjectCreated?.(project.id)
  // Preserve the known project and uploaded original; never delete on an ambiguous response.
  await uploadMediaToProject({ projectId: project.id, file, signal, onProgress })
  void import('./projectRepository').then(({ projectRepository }) => projectRepository.refresh()).catch(() => {})
}
