import type { Project } from './types'

export function projectForTarget(project: Project, language?: string | null, resultView = false): Project {
  if (!project.targetWorkflows || !language) return project
  const selected = project.targetWorkflows.find(target => target.targetLanguage === language)
  if (!selected || selected.workflow.targetLanguage?.code !== language) return { ...project, workflow: { step: 'UNKNOWN', state: 'BLOCKED', canResume: false, mediaType: project.mediaType ?? null, targetLanguage: null, processing: null, failure: null, artifact: { narrationReady: false, resultReady: false } } }
  const hasResult = selected.workflow.mediaType === 'AUDIO' ? selected.workflow.artifact.narrationReady : selected.workflow.artifact.resultReady
  // A failed replacement never hides an earlier verified artifact for this target.
  const workflow = resultView && hasResult && selected.workflow.state !== 'BLOCKED' ? { ...selected.workflow, step: 'RESULT' as const, state: 'COMPLETED' as const, canResume: false } : selected.workflow
  return { ...project, workflow }
}
