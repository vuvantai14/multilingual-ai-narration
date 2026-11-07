import type { Project } from '../projects/types'
import { resolveWorkflowRouteAccess } from '../projects/workflowRouteGuard.ts'

// Display-only: status alone cannot attest a playable product.
export function libraryProduct(project: Project) {
  const workflow = project.workflow
  if (project.status !== 'COMPLETED' || !workflow || workflow.processing || workflow.state !== 'COMPLETED') return null
  const access = resolveWorkflowRouteAccess(workflow, 'RESULT')
  if (!access.allowed || !access.targetLanguage) return null
  if (workflow.mediaType === 'VIDEO' && workflow.targetLanguage?.source !== 'RESULT') return null
  if (workflow.mediaType === 'AUDIO' && workflow.targetLanguage?.source !== 'NARRATION') return null
  if (workflow.mediaType !== 'VIDEO' && workflow.mediaType !== 'AUDIO') return null
  return { project, mediaType: workflow.mediaType, language: access.targetLanguage,
    path: `/projects/${encodeURIComponent(project.id)}/result?language=${encodeURIComponent(access.targetLanguage)}` }
}
export type LibraryProduct = NonNullable<ReturnType<typeof libraryProduct>>
export function libraryProducts(project: Project): LibraryProduct[] {
  if (!project.targetWorkflows) { const product = libraryProduct(project); return product ? [product] : [] }
  return project.targetWorkflows.flatMap(target => {
    const workflow = target.workflow
    const ready = workflow.mediaType === 'VIDEO' ? workflow.artifact.resultReady : workflow.mediaType === 'AUDIO' && workflow.artifact.narrationReady
    if (!ready || workflow.state === 'BLOCKED' || workflow.targetLanguage?.code !== target.targetLanguage || (workflow.mediaType !== 'AUDIO' && workflow.mediaType !== 'VIDEO')) return []
    return [{ project, mediaType: workflow.mediaType, language: target.targetLanguage,
      path: `/projects/${encodeURIComponent(project.id)}/result?language=${encodeURIComponent(target.targetLanguage)}` }]
  })
}
export function filterLibrary(products: readonly LibraryProduct[], filters: { query: string; media: string; language: string }) {
  const query = filters.query.trim().toLocaleLowerCase('vi')
  return products.filter(item => item.project.name.toLocaleLowerCase('vi').includes(query)
    && (filters.media === 'ALL' || item.mediaType === filters.media)
    && (filters.language === 'ALL' || item.language === filters.language))
}
