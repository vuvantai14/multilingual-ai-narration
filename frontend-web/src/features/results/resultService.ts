import { api, apiBlob } from '../../lib/api';
import { projectRepository } from '../projects/projectRepository';
import type { LanguageCode } from '../projects/types';
import type { HistoryItem, Result } from './types';

export interface LanguageVariant {
  projectId: string;
  language: string;
  name: string;
  flag: string;
  hasResult: boolean;
  status: string;
  isCurrent: boolean;
}

type VideoResultDto = { id: string; projectId: string; narrationId: string; targetLanguage: string; mimeType: string; fileSize: number; duration: number; width: number | null; height: number | null; fileUrl: string; createdAt: string };
type NarrationDto = { id: string; projectId: string; targetLanguage: string; voice?: { id: string; name?: string | null } | null; speed?: number | null; mimeType: string; fileSize: number; duration: number | null; audioUrl: string; createdAt: string };

const newest = <T extends { createdAt: string }>(items: T[]) => [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
const narrationMetadata = (narration?: NarrationDto) => ({
  voiceName: typeof narration?.voice?.name === 'string' && narration.voice.name.trim() ? narration.voice.name : undefined,
  speed: typeof narration?.speed === 'number' && Number.isFinite(narration.speed) && narration.speed > 0 ? narration.speed : undefined,
});

export const resultService = {
  async getByProjectId(projectId: string, language?: LanguageCode, mediaType?: 'AUDIO' | 'VIDEO'): Promise<Result | null> {
    const [{ results }, { narrations }] = await Promise.all([
      api<{ results: VideoResultDto[] }>(`/projects/${projectId}/results`),
      api<{ narrations: NarrationDto[] }>(`/projects/${projectId}/narrations`),
    ]);
    const projectNarrations = narrations.filter(item => item.projectId === projectId);
    const targets = new Set([...results.filter(row => row.projectId === projectId).map(row => row.targetLanguage), ...projectNarrations.map(row => row.targetLanguage)]);
    const selected = language ?? (targets.size === 1 ? [...targets][0] : undefined);
    if (!selected) return null;
    const video = newest(results.filter((item) => item.projectId === projectId && item.targetLanguage === selected));
    if (video) {
      // Use the narration actually rendered into this video, not a newer voice
      // configuration, a same-language neighbour, or another project's record.
      const narration = projectNarrations.find(item => item.id === video.narrationId && item.targetLanguage === video.targetLanguage);
      return { id: video.id, projectId, languageCode: video.targetLanguage, mediaType: 'VIDEO', artifactType: 'VIDEO', createdAt: video.createdAt, mimeType: video.mimeType, fileSize: video.fileSize, duration: video.duration, width: video.width, height: video.height, filePath: video.fileUrl, ...narrationMetadata(narration) };
    }
    if (mediaType === 'VIDEO') return null;
    const audio = newest(projectNarrations.filter((item) => item.targetLanguage === selected));
    if (!audio) return null;
    return { id: audio.id, projectId, languageCode: audio.targetLanguage, mediaType: 'AUDIO', artifactType: 'AUDIO', createdAt: audio.createdAt, mimeType: audio.mimeType, fileSize: audio.fileSize, duration: audio.duration ?? undefined, ...narrationMetadata(audio), filePath: audio.audioUrl };
  },
  async getAvailableLanguages(projectId: string): Promise<string[]> {
    try {
      const [{ results }, { narrations }] = await Promise.all([
        api<{ results: VideoResultDto[] }>(`/projects/${projectId}/results`),
        api<{ narrations: NarrationDto[] }>(`/projects/${projectId}/narrations`),
      ]);
      const set = new Set<string>();
      results.forEach((r) => { if (r.projectId === projectId && r.targetLanguage) set.add(r.targetLanguage); });
      narrations.forEach((n) => { if (n.projectId === projectId && n.targetLanguage) set.add(n.targetLanguage); });
      return Array.from(set);
    } catch {
      return [];
    }
  },
  async getLanguageVariants(projectId: string, currentLanguage?: string): Promise<LanguageVariant[]> {
    try {
      const url = currentLanguage
        ? `/projects/${projectId}/language-variants?language=${encodeURIComponent(currentLanguage)}`
        : `/projects/${projectId}/language-variants`;
      const response = await api<{ variants: LanguageVariant[] }>(url);
      return response.variants;
    } catch {
      return [];
    }
  },
  getFile: (result: Result) => apiBlob(result.filePath),
  async getHistory(): Promise<HistoryItem[]> {
    return Promise.all(projectRepository.getAll().map(async (project) => {
      try { return { ...project, hasResult: Boolean(await resultService.getByProjectId(project.id, undefined, project.mediaType)) }; }
      catch { return { ...project, hasResult: false }; }
    })).then((items) => items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  },
};
