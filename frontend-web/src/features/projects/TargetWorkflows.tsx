import { Link } from 'react-router-dom'
import { Card } from '../../components/common/Card'
import { sourceLanguageLabel } from './sourceLanguage'
import type { Project, TargetWorkflow } from './types'

const labels: Record<TargetWorkflow['status'], string> = { NOT_STARTED: 'Chưa tạo', TRANSLATING: 'Đang dịch', AWAITING_REVIEW: 'Chờ duyệt bản dịch', TRANSLATED: 'Đã duyệt bản dịch',
  GENERATING_AUDIO: 'Đang tạo giọng đọc', AUDIO_READY: 'Âm thanh sẵn sàng, chưa có video', PROCESSING_VIDEO: 'Đang tạo video', COMPLETED: 'Hoàn thành', FAILED: 'Thất bại', BLOCKED: 'Chưa đủ điều kiện' }

export function TargetWorkflows({ project }: { project: Project }) {
  if (!project.targetWorkflows) return null
  return <Card><section aria-label="Trạng thái từng ngôn ngữ"><h2>Thuyết minh theo ngôn ngữ</h2><p>Kết quả của mỗi ngôn ngữ độc lập. Trạng thái dự án cũ không có nghĩa là mọi ngôn ngữ đã hoàn thành.</p>
    <ul>{project.targetWorkflows.map(target => {
      const ready = target.workflow.mediaType === 'AUDIO' ? target.workflow.artifact.narrationReady : target.workflow.artifact.resultReady
      const step = target.workflow.step === 'VOICE' ? 'voice' : target.workflow.step === 'GENERATE' ? 'generate' : target.workflow.step === 'RESULT' ? 'result' : 'translation'
      return <li key={target.targetLanguage}><strong>{sourceLanguageLabel(target.targetLanguage)}</strong> — {labels[target.status]}{' '}
        <Link to={`/projects/${project.id}/${step}?language=${target.targetLanguage}`}>Mở {sourceLanguageLabel(target.targetLanguage)}</Link>{' '}
        {ready && step !== 'result' && <Link to={`/projects/${project.id}/result?language=${target.targetLanguage}`}>Xem kết quả đã có</Link>}
        {target.failureCode && <span role="status"> · {target.failureCode === 'TRANSLATION_ATTEMPT_UNCERTAIN' ? 'Chưa xác định kết quả yêu cầu. Chỉ tải lại trạng thái, không tự dịch lại.' : `Lỗi: ${target.failureCode}`}</span>}
      </li>
    })}</ul>
  </section></Card>
}
