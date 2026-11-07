import { ApiError } from '../../lib/api'
import { useCallback, useEffect, useRef, useState } from 'react'
import { transcriptService } from './transcriptService'
import { getSegmentErrors, hasTranscriptChanges } from './transcriptUtils'
import type { Transcript, TranscriptSegmentUpdate, TranscriptStatus } from './types'

type FailedAction = 'load' | 'generate' | 'save' | null
const storedFailureMessages: Record<string, string> = {
  STT_NO_SPEECH: 'Không nhận diện được lời nói trong tệp.',
  STT_INVALID_RESPONSE: 'Gemini đã trả phản hồi nhưng bản ghi hoặc mốc thời gian không hợp lệ.',
  STT_MODEL_UNAVAILABLE: 'Model tạo bản ghi không khả dụng hoặc chưa được cấp quyền.',
  STT_QUOTA_EXCEEDED: 'Dịch vụ tạo bản ghi đã hết hạn mức hoặc bị giới hạn yêu cầu.',
  STT_INVALID_FILE: 'Tệp nguồn không hợp lệ hoặc không thể xử lý.',
}

function copyTranscript(transcript: Transcript): Transcript {
  return { ...transcript, segments: transcript.segments.map((segment) => ({ ...segment })) }
}

export function useTranscriptEditor(projectId: string) {
  const [status, setStatus] = useState<TranscriptStatus>('LOADING')
  const [draft, setDraft] = useState<Transcript | null>(null)
  const [saved, setSaved] = useState<Transcript | null>(null)
  const [generatedBaseline, setGeneratedBaseline] = useState<Transcript | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [failedAction, setFailedAction] = useState<FailedAction>(null)
  const [retryAllowed, setRetryAllowed] = useState(false)
  const generationLock = useRef(false)
  const operationRef = useRef<AbortController | null>(null)
  const dirty = hasTranscriptChanges(draft, saved)
  const segmentErrors = draft ? getSegmentErrors(draft.segments) : {}
  const hasInvalidSegments = !draft?.segments.length || Object.keys(segmentErrors).length > 0
  const busy = status === 'LOADING' || status === 'GENERATING' || status === 'SAVING'
  const canSave = false
  const canReset = false

  const requestTranscript = useCallback(() => {
    operationRef.current?.abort()
    const controller = new AbortController()
    operationRef.current = controller
    void transcriptService.getTranscript(projectId, { signal: controller.signal }).then(async (result) => {
      if (controller.signal.aborted) return
      setDraft(result)
      setSaved(result)
      setGeneratedBaseline(result)
      if (result) { setStatus('SAVED'); return }
      const execution = await transcriptService.executionState(projectId, { signal: controller.signal })
      if (controller.signal.aborted) return
      setRetryAllowed(execution.retryAllowed)
      setStatus(execution.state === 'UNCERTAIN' ? 'UNCERTAIN' : execution.state === 'PROCESSING' ? 'GENERATING' : execution.state === 'FAILED' ? 'FAILED' : 'NOT_STARTED')
      if (execution.state === 'UNCERTAIN') setError('Không xác định được kết quả xử lý. Vui lòng kiểm tra trạng thái, không gửi lại yêu cầu.')
      if (execution.state === 'FAILED') setError(`${storedFailureMessages[execution.errorCode ?? ''] ?? 'Bản ghi chưa được tạo. Hãy kiểm tra cấu hình và trạng thái.'} Không tự gửi lại yêu cầu.`)
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return
      setError(cause instanceof Error ? cause.message : 'Không thể tải bản ghi.')
      setFailedAction('load')
      setStatus('FAILED')
    })
  }, [projectId])

  useEffect(() => {
    requestTranscript()
    return () => operationRef.current?.abort()
  }, [requestTranscript])

  function retryLoad() {
    setStatus('LOADING')
    setError(null)
    setFailedAction(null)
    requestTranscript()
  }

  function acceptConfirmedTranscript(value: Transcript) {
    operationRef.current?.abort()
    setDraft(value)
    setSaved(copyTranscript(value))
    setGeneratedBaseline(copyTranscript(value))
    setStatus('SAVED')
    setError(null)
    setFailedAction(null)
  }

  function applySegmentUpdate(update: TranscriptSegmentUpdate) {
    const apply = (value: Transcript | null) => value ? {
      ...value,
      fullText: update.transcript.fullText,
      revision: update.transcript.revision,
      segments: value.segments.map((segment) => segment.backendSegmentId === update.segment.id
        ? { ...segment, text: update.segment.text }
        : segment),
    } : value
    setDraft((value) => apply(value))
    setSaved((value) => apply(value))
    setGeneratedBaseline((value) => apply(value))
    setStatus('SAVED')
    setError(null)
    setFailedAction(null)
  }

  async function generate() {
    if (busy || status === 'UNCERTAIN' || !retryAllowed || generationLock.current) return
    generationLock.current = true
    setRetryAllowed(false)
    operationRef.current?.abort()
    const controller = new AbortController()
    operationRef.current = controller
    setStatus('GENERATING')
    setError(null)
    setFailedAction(null)
    try {
      const result = await transcriptService.generateTranscript(projectId, { signal: controller.signal })
      if (controller.signal.aborted) return
      setDraft(result)
      setSaved(copyTranscript(result))
      setGeneratedBaseline(copyTranscript(result))
      setStatus('SAVED')
    } catch (cause) {
      if (controller.signal.aborted) return
      if (cause instanceof DOMException && cause.name === 'AbortError' && cause.message === 'Đã hủy') { setStatus('NOT_STARTED'); setRetryAllowed(true); return }
      setError(cause instanceof Error ? cause.message : 'Không thể tạo bản ghi.')
      setFailedAction('generate')
      setStatus(cause instanceof ApiError && ['STT_EXECUTION_UNCERTAIN', 'STT_ATTEMPT_UNCERTAIN', 'S32_E2E_TRANSACTION_UNCERTAIN', 'S32_QUOTA_COMMIT_UNCERTAIN'].includes(cause.code) || !(cause instanceof ApiError) ? 'UNCERTAIN' : 'FAILED')
    } finally { generationLock.current = false }
  }

  function updateSegment(segmentId: string, text: string) {
    void segmentId; void text
  }

  async function saveTranscript() {
    if (!draft || !dirty || hasInvalidSegments || busy) return
    operationRef.current?.abort()
    const controller = new AbortController()
    operationRef.current = controller
    setStatus('SAVING')
    setError(null)
    setFailedAction(null)
    try {
      const result = await transcriptService.saveTranscript(projectId, draft, { signal: controller.signal })
      if (controller.signal.aborted) return
      setDraft(result)
      setSaved(copyTranscript(result))
      setGeneratedBaseline(copyTranscript(result))
      setStatus('SAVED')
    } catch (cause) {
      if (controller.signal.aborted) return
      setError(cause instanceof Error ? cause.message : 'Không thể lưu bản ghi.')
      setFailedAction('save')
      setStatus('FAILED')
    }
  }

  function resetChanges() {
    const baseline = saved ?? generatedBaseline
    if (!baseline || !canReset) return
    setDraft(copyTranscript(baseline))
    setStatus(saved ? 'SAVED' : 'READY')
    setError(null)
    setFailedAction(null)
  }

  return { status, retryAllowed, draft, dirty, segmentErrors, hasInvalidSegments, canSave, canReset, error, failedAction, generate, updateSegment, saveTranscript, resetChanges, retryLoad, refreshTranscript: requestTranscript, applySegmentUpdate, acceptConfirmedTranscript }
}
