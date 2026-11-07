import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { validateMediaFile, getMediaType, uploadMimeType } from '../src/features/projects/mediaUpload.ts'

const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(r => setImmediate(r)) }
class ApiError extends Error { constructor(code, message) { super(message); this.code = code } }
function editorFixture(service) {
  const slots = []; let cursor = 0, effects = []
  const changed = (a, b) => !a || b.some((v, i) => v !== a[i])
  const react = {
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = value; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }] },
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value } },
    useCallback(fn, deps) { const i = cursor++; if (!slots[i] || changed(slots[i].deps, deps)) slots[i] = { fn, deps }; return slots[i].fn },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || changed(slots[i].deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() } }) },
  }
  const exports = {}
  const source = readFileSync(new URL('../src/features/transcript/useTranscriptEditor.ts', import.meta.url), 'utf8')
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, Error, DOMException, AbortController, require: name => {
    if (name === 'react') return react
    if (name.endsWith('/api')) return { ApiError }
    if (name.includes('transcriptService')) return { transcriptService: service }
    if (name.includes('transcriptUtils')) return { hasTranscriptChanges: () => false, getSegmentErrors: () => ({}) }
    throw Error('unmocked dependency: ' + name)
  } })
  return () => { cursor = 0; effects = []; const editor = exports.useTranscriptEditor('owned-fixture'); effects.forEach(f => f()); return editor }
}
test('browser validates strict extension/MIME pairs and server size; no 500 MB promise', () => {
  assert.equal(getMediaType({ name: 'sound.webm', mimeType: 'audio/webm' }), 'AUDIO')
  assert.equal(getMediaType({ name: 'sound.mp3', mimeType: 'audio/mp4' }), null)
  assert.equal(uploadMimeType({ name: 'sound.mp3', mimeType: '' }), 'audio/mpeg')
  assert.equal(validateMediaFile({ name: 'x.mp3', mimeType: 'audio/mpeg', size: 1025 }, 1024).valid, false)
})
test('reloading a legacy/uncertain STT cannot dispatch; checking status is GET-only', async () => {
  let generated = 0, reads = 0
  const render = editorFixture({ getTranscript: async () => null, executionState: async () => { reads++; return { state: 'UNCERTAIN', retryAllowed: false } }, generateTranscript: async () => { generated++; throw Error('must not dispatch') } })
  render(); await flush(); let editor = render(); assert.equal(editor.status, 'UNCERTAIN'); assert.equal(editor.retryAllowed, false)
  await editor.generate(); editor.retryLoad(); await flush(); editor = render(); assert.equal(editor.status, 'UNCERTAIN'); assert.equal(generated, 0); assert.equal(reads, 2)
})
test('STT double-click is fenced; post-invocation 503 stays uncertain without another POST', async () => {
  let generated = 0, reject
  const render = editorFixture({ getTranscript: async () => null, executionState: async () => ({ state: 'NOT_STARTED', retryAllowed: true }), generateTranscript: () => { generated++; return new Promise((_r, j) => { reject = j }) } })
  render(); await flush(); const editor = render(); const first = editor.generate(); await editor.generate(); assert.equal(generated, 1)
  reject(new ApiError('STT_EXECUTION_UNCERTAIN', 'Gemini HTTP 503; không gửi lại')); await first
  const current = render(); assert.equal(current.status, 'UNCERTAIN'); assert.equal(current.retryAllowed, false); assert.match(current.error, /503/); await current.generate(); assert.equal(generated, 1)
})
test('completed no-speech failure remains FAILED and not retryable', async () => {
  const render = editorFixture({ getTranscript: async () => null, executionState: async () => ({ state: 'FAILED', errorCode: 'STT_NO_SPEECH', retryAllowed: false }) })
  render(); await flush(); const editor = render(); assert.equal(editor.status, 'FAILED'); assert.equal(editor.retryAllowed, false); assert.match(editor.error, /Không nhận diện được lời nói/)
})

test('stored invalid-response error remains specific after reload, without a retry POST', async () => {
  let calls = 0
  const render = editorFixture({ getTranscript: async () => null, executionState: async () => ({ state: 'FAILED', errorCode: 'STT_INVALID_RESPONSE', retryAllowed: false }), generateTranscript: async () => { calls++; throw Error('must not dispatch') } })
  render(); await flush(); let editor = render(); assert.match(editor.error, /mốc thời gian không hợp lệ/)
  assert.equal(editor.status, 'FAILED'); await editor.generate(); editor.retryLoad(); await flush(); editor = render()
  assert.match(editor.error, /Không tự gửi lại/); assert.equal(editor.retryAllowed, false); assert.equal(calls, 0)
})

test('structured API response failure preserves original message and code without treating it as uncertain or retrying', async () => {
  let calls = 0
  const render = editorFixture({ getTranscript: async () => null, executionState: async () => ({ state: 'NOT_STARTED', retryAllowed: true }), generateTranscript: async () => { calls++; throw new ApiError('STT_INVALID_RESPONSE', 'Gemini: mốc thời gian không hợp lệ; không retry.') } })
  render(); await flush(); await render().generate(); const editor = render()
  assert.equal(editor.status, 'FAILED'); assert.equal(editor.error, 'Gemini: mốc thời gian không hợp lệ; không retry.'); assert.equal(editor.retryAllowed, false)
  await editor.generate(); assert.equal(calls, 1)
})
test('unknown native transaction commit stays UNCERTAIN and cannot issue another POST', async () => {
  let calls = 0
  const render = editorFixture({ getTranscript: async () => null, executionState: async () => ({ state: 'NOT_STARTED', retryAllowed: true }), generateTranscript: async () => { calls++; throw new ApiError('S32_E2E_TRANSACTION_UNCERTAIN', 'UNCERTAIN: không retry.') } })
  render(); await flush(); await render().generate(); const editor = render()
  assert.equal(editor.status, 'UNCERTAIN'); assert.equal(editor.retryAllowed, false); await editor.generate(); assert.equal(calls, 1)
})
test('cancelling before confirmation does not fabricate dispatch uncertainty', async () => {
  const render = editorFixture({ getTranscript: async () => null, executionState: async () => ({ state: 'NOT_STARTED', retryAllowed: true }), generateTranscript: async () => { throw new DOMException('Đã hủy', 'AbortError') } })
  render(); await flush(); await render().generate(); const editor = render(); assert.equal(editor.status, 'NOT_STARTED'); assert.equal(editor.retryAllowed, true)
})
test('upload failure preserves a created project; subsequent upload reuses its ID without DELETE', async () => {
  const calls = [], exports = {}; let created
  const source = readFileSync(new URL('../src/features/projects/uploadService.ts', import.meta.url), 'utf8')
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports, FormData, Blob, require: name => {
    if (name.endsWith('/api')) return { api: async (path, init) => { calls.push([path, init.method]); if (path === '/projects') return { project: { id: 'new-owned-project' } }; throw Error('ambiguous upload response') } }
    if (name === './sourceLanguage') return { createSourcePayload: () => ({ sourceLanguageMode: 'AUTO' }) }
    if (name === './mediaUpload') return { uploadMimeType }
    throw Error('unexpected dependency: ' + name)
  } })
  const options = { projectName: 'Fixture', description: '', file: new File(['fixture'], 'x.mp3', { type: 'audio/mpeg' }), signal: new AbortController().signal, onProgress() {}, onProjectCreated: id => { created = id } }
  await assert.rejects(exports.uploadProjectMedia(options)); assert.equal(created, 'new-owned-project')
  await assert.rejects(exports.uploadProjectMedia({ ...options, projectId: created }))
  assert.deepEqual(calls, [['/projects', 'POST'], ['/projects/new-owned-project/media', 'POST'], ['/projects/new-owned-project/media', 'POST']])
})
