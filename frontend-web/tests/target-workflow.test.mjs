import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { createRequire } from 'node:module'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { projectForTarget } from '../src/features/projects/targetWorkflow.ts'
import { libraryProducts } from '../src/features/results/libraryPresentation.ts'

const require = createRequire(import.meta.url)
function load(file, overrides = {}, globals = {}, suffix = '') {
  const exports = {}
  const source = ts.transpileModule(readFileSync(new URL('../src/' + file, import.meta.url), 'utf8') + suffix, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  runInNewContext(source, { exports, queueMicrotask, console, URL, AbortController, ...globals,
    require: name => name in overrides ? overrides[name] : require(name) })
  return exports
}
const workflow = (target, ready = false) => ({ step: ready ? 'RESULT' : 'TRANSLATION', state: ready ? 'COMPLETED' : 'READY', canResume: !ready,
  mediaType: 'VIDEO', targetLanguage: { code: target, source: ready ? 'RESULT' : 'JOB' }, artifact: { narrationReady: ready, resultReady: ready }, processing: null, failure: null })
const project = { id: 'p', name: 'Museum', status: 'COMPLETED', sourceLanguage: 'vi', mediaType: 'VIDEO',
  targetWorkflows: ['en', 'ja', 'ko', 'zh'].map(code => ({ targetLanguage: code, status: code === 'en' ? 'COMPLETED' : 'NOT_STARTED', workflow: workflow(code, code === 'en') })) }

test('COMPLETED legacy status never selects another target workflow; old English data is unchanged', () => {
  const before = JSON.stringify(project)
  for (const target of ['ja', 'ko', 'zh']) {
    const chosen = projectForTarget(project, target)
    assert.equal(chosen.status, 'COMPLETED'); assert.equal(chosen.workflow.step, 'TRANSLATION')
    assert.equal(chosen.workflow.canResume, true); assert.equal(chosen.workflow.targetLanguage.code, target)
  }
  assert.equal(projectForTarget(project, 'vi').workflow.state, 'BLOCKED')
  assert.equal(projectForTarget(project, 'en').workflow.state, 'COMPLETED')
  const legacy = { id: 'old', status: 'COMPLETED', workflow: workflow('en', true) }
  assert.equal(projectForTarget(legacy, 'en'), legacy)
  assert.equal(JSON.stringify(project), before)
})

test('library and read-only result preserve earlier verified artifact even when another target/replacement failed', () => {
  const targets = project.targetWorkflows.map(target => target.targetLanguage === 'ja' ? { ...target, status: 'FAILED', workflow: { ...workflow('ja'), state: 'FAILED' } } : target)
  const mixed = { ...project, targetWorkflows: targets }
  assert.deepEqual(libraryProducts(mixed).map(row => row.language), ['en'])
  const replacement = { ...mixed, targetWorkflows: targets.map(target => target.targetLanguage === 'en' ? { ...target, status: 'FAILED', workflow: { ...target.workflow, state: 'FAILED', step: 'VOICE' } } : target) }
  assert.equal(projectForTarget(replacement, 'en').workflow.state, 'FAILED')
  assert.equal(projectForTarget(replacement, 'en', true).workflow.state, 'COMPLETED')
  assert.equal(libraryProducts(replacement)[0].path, '/projects/p/result?language=en')
  assert.equal(libraryProducts({ ...mixed, targetWorkflows: [] }).length, 0)
  const blocked = { ...project, targetWorkflows: [{ ...project.targetWorkflows[0], workflow: { ...workflow('en', true), state: 'BLOCKED' } }] }
  assert.equal(libraryProducts(blocked).length, 0)
  assert.equal(projectForTarget(blocked, 'en', true).workflow.state, 'BLOCKED')
  const mismatched = { ...project, targetWorkflows: [{ ...project.targetWorkflows[0], workflow: workflow('ja', true) }] }
  assert.equal(libraryProducts(mismatched).length, 0)
  assert.equal(projectForTarget(mismatched, 'en', true).workflow.state, 'BLOCKED')
})

test('target selector displays independent statuses and explicit target links, with no automatic request', () => {
  const { TargetWorkflows } = load('features/projects/TargetWorkflows.tsx', {
    'react-router-dom': { Link: ({ to, children }) => React.createElement('a', { href: to }, children) },
    '../../components/common/Card': { Card: ({ children }) => React.createElement('div', null, children) },
    './sourceLanguage': { sourceLanguageLabel: code => code },
  })
  const html = renderToStaticMarkup(React.createElement(TargetWorkflows, { project }))
  assert.match(html, /\/result\?language=en/)
  for (const target of ['ja', 'ko', 'zh']) assert.match(html, new RegExp('/translation\\?language=' + target))
  assert.match(html, /Hoàn thành/); assert.match(html, /Chưa tạo/)
})

test('result lookup without an explicit target is ambiguous; VIDEO cannot fall back to audio or another language', async () => {
  const results = [{ id: 'r-en', projectId: 'p', narrationId: 'n-en', targetLanguage: 'en', createdAt: '2026-11-05', fileUrl: '/en.mp4' }]
  const narrations = ['en', 'ja'].map(target => ({ id: 'n-' + target, projectId: 'p', targetLanguage: target, createdAt: '2026-11-05', audioUrl: '/' + target + '.mp3' }))
  const { resultService } = load('features/results/resultService.ts', { '../../lib/api': { api: async path => path.endsWith('/results') ? { results } : { narrations } }, '../projects/projectRepository': { projectRepository: {} } })
  assert.equal(await resultService.getByProjectId('p'), null)
  assert.equal(await resultService.getByProjectId('p', 'ja', 'VIDEO'), null)
  assert.equal((await resultService.getByProjectId('p', 'ja', 'AUDIO')).languageCode, 'ja')
  assert.equal((await resultService.getByProjectId('p', 'en', 'VIDEO')).id, 'r-en')
  assert.equal(await resultService.getByProjectId('p', 'ko'), null)
})

test('narration configuration joins exact translation and target, preserving saved voice and speed', async () => {
  const { narrationService } = load('features/voice/narrationService.ts', {
    '../translation/translationService': { translationService: { getSavedTranslation: async (_id, target) => ({ id: 't-' + target, targetLanguage: target }) } },
    '../../lib/api': { api: async () => ({ narrations: [
      { id: 'n-en', translationId: 't-en', targetLanguage: 'en', voice: { id: 'v-en' }, speed: 1 },
      { id: 'n-ja', translationId: 't-ja', targetLanguage: 'ja', voice: { id: 'v-ja' }, speed: 0.9 },
      { id: 'wrong', translationId: 'other', targetLanguage: 'ja', voice: { id: 'wrong' }, speed: 1.5 },
    ] }) }, './voiceService': {}, './voiceUtils': { translationRevision: value => value.id },
    '../../localization/confirmationMessages.mjs': {}, '../../utils/confirmationGuard.mjs': {},
  })
  const ja = await narrationService.getConfig('p', 'ja')
  assert.equal(ja.narrationId, 'n-ja'); assert.equal(ja.voiceId, 'v-ja'); assert.equal(ja.speed, 0.9)
  assert.equal(await narrationService.getConfig('p', 'ko'), null)
})

function hooks() {
  const slots = []; let cursor = 0, pending = []
  return {
    react: { useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }] },
      useRef(initial) { return slots[cursor++] ??= { current: initial } },
      useEffect(effect, deps) { const i = cursor++, old = slots[i]; if (!old || deps.some((value, index) => value !== old.deps[index])) pending.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: effect() } }) } },
    render(fn) { cursor = 0; pending = []; const value = fn(); pending.forEach(effect => effect()); return value },
  }
}
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(done => setImmediate(done)) }
test('late result/media responses from previous target cannot overwrite selected target or leak object URLs', async () => {
  const h = hooks(), pending = new Map(), blobs = new Map(), revoked = []; let urls = 0
  const { useResult } = load('features/results/useResult.ts', { react: h.react,
    './resultService': { resultService: { getByProjectId: (_p, target) => new Promise(resolve => pending.set(target, resolve)), getFile: value => new Promise(resolve => blobs.set(value.languageCode, resolve)) } },
  }, { URL: { createObjectURL: () => 'blob:' + ++urls, revokeObjectURL: value => revoked.push(value) } })
  let target = 'en'; const render = () => h.render(() => useResult('p', target, 'VIDEO'))
  render(); await flush(); pending.get('en')({ languageCode: 'en' }); await flush()
  target = 'ja'; render(); await flush(); pending.get('ja')({ languageCode: 'ja' }); await flush(); blobs.get('ja')({}); await flush()
  blobs.get('en')({}); await flush()
  assert.equal(render().result.languageCode, 'ja'); assert.equal(render().mediaUrl, 'blob:1'); assert.equal(urls, 1)
  target = 'ko'; render(); await flush(); assert.deepEqual(revoked, ['blob:1']); assert.equal(render().mediaUrl, null)
})

test('library reads per-project evidence with bounded GET concurrency', async () => {
  const h = hooks(); let active = 0, peak = 0, reads = 0
  const { useCompleteHistory } = load('features/results/useCompleteHistory.ts', { react: h.react,
    '../projects/projectRepository': { projectRepository: {
      listPage: async () => ({ projects: Array.from({ length: 9 }, (_, i) => ({ id: 'p' + i, updatedAt: '2026-11-05' })), pagination: { totalPages: 1 } }),
      getProjectForResume: async id => { active++; reads++; peak = Math.max(peak, active); await new Promise(done => setImmediate(done)); active--; return { id, targetWorkflows: project.targetWorkflows } },
    } }, '../projects/projectDataState': { collectionDataState: () => 'READY' },
  })
  const render = () => h.render(() => useCompleteHistory())
  render(); await flush(); await flush()
  assert.equal(reads, 9); assert.equal(peak, 4); assert.equal(render().projects.length, 9)
  assert.equal(render().projects[0].targetWorkflows.length, 4)
})

test('adding a target navigates in the same project without creating or cloning any project', () => {
  const h = hooks(), paths = []
  const { AddLanguageModal } = load('features/projects/AddLanguageModal.tsx', { react: h.react,
    'react-router-dom': { useNavigate: () => path => paths.push(path) },
    '../../components/common/Button': { Button: 'Button' }, '../../components/common/Card': { Card: 'Card' },
  }, { document: { activeElement: null, addEventListener() {}, removeEventListener() {} }, HTMLElement: class {} })
  function find(tree, predicate) {
    if (Array.isArray(tree)) return tree.map(item => find(item, predicate)).find(Boolean)
    if (!tree || typeof tree !== 'object') return undefined
    return predicate(tree) ? tree : find(tree.props?.children, predicate)
  }
  const render = () => h.render(() => AddLanguageModal({ projectId: 'p', projectName: 'Museum', existingLanguages: ['en'], sourceLanguage: 'ko', open: true, onClose() {} }))
  let tree = render()
  assert.deepEqual(Array.from(find(tree, item => item.type === 'select').props.children, item => item.props.value), ['ja', 'zh'])
  find(tree, item => item.type === 'select').props.onChange({ target: { value: 'zh' } }); tree = render()
  find(tree, item => item.type === 'Button' && item.props.variant === 'primary').props.onClick()
  assert.deepEqual(paths, ['/projects/p/translation?language=zh'])
})

test('obsolete library requests cannot overwrite a newer reload', async () => {
  const h = hooks(), oldSignals = []; let release, requests = 0
  const old = new Promise(done => { release = done })
  const { useCompleteHistory } = load('features/results/useCompleteHistory.ts', { react: h.react,
    '../projects/projectRepository': { projectRepository: {
      listPage: async () => ({ projects: [{ id: ++requests === 1 ? 'old' : 'new', updatedAt: '2026-11-05' }], pagination: { totalPages: 1 } }),
      getProjectForResume: async (id, signal) => { if (id === 'old') { oldSignals.push(signal); await old } return { id } },
    } }, '../projects/projectDataState': { collectionDataState: () => 'READY' },
  })
  const render = () => h.render(() => useCompleteHistory())
  render(); await flush(); render().reload(); render(); await flush()
  assert.equal(oldSignals[0].aborted, true); assert.equal(render().projects[0].id, 'new')
  release(); await flush(); assert.equal(render().projects[0].id, 'new')
})

test('Result passes only completed artifact languages to add-language modal, including no-result branch', () => {
  let result = { id: 'r', projectId: 'p', languageCode: 'en', mediaType: 'VIDEO', artifactType: 'VIDEO' }
  const deps = {
    react: { useState: initial => [initial, () => {}], useEffect() {} },
    'react-router-dom': { useNavigate: () => () => {}, Link: 'Link' },
    '../features/projects/TargetWorkflows': {}, '../features/projects/sourceLanguage': { sourceLanguageLabel: code => code },
    '../features/projects/useProjects': {}, '../features/projects/workflowRouteGuard': {},
    '../features/results/useResult': { useResult: () => ({ result, loading: false, error: null }) },
    '../features/results/resultUtils': { resultRows: () => [] }, '../features/results/resultService': {},
    '../features/projects/AddLanguageModal': { AddLanguageModal: 'AddLanguageModal' }, '../styles/results.css': {},
    '../components/layout/PageHeader': { PageHeader: 'PageHeader' }, '../components/common/WorkflowRouteGuard': {},
  }
  for (const name of ['Card','Badge','Button','ErrorState','Spinner','WorkflowSteps']) deps['../components/common/' + name] = { [name]: name }
  const { workspace } = load('pages/ResultPage.tsx', deps, {}, '\nexports.workspace = ResultWorkspace;')
  const find = tree => Array.isArray(tree) ? tree.map(find).find(Boolean) : tree && typeof tree === 'object' ? tree.type === 'AddLanguageModal' ? tree : find(tree.props?.children) : null
  for (const value of [result, null]) {
    result = value
    const modal = find(workspace({ project, language: 'en' }))
    assert.ok(modal); assert.deepEqual(Array.from(modal.props.existingLanguages), ['en'])
    assert.equal(modal.props.sourceLanguage, 'vi')
  }
})

test('add-language modal traps Tab/ShiftTab, Escape closes, cleanup returns opener focus', () => {
  const h = hooks(), listeners = new Map(); let open = true
  const document = { activeElement: null, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) }
  class Element { isConnected = true; focus() { document.activeElement = this } }
  const opener = new Element(), first = new Element(), last = new Element(); document.activeElement = opener
  const dialog = { querySelectorAll: () => [first,last], contains: item => [first,last].includes(item) }
  const close = () => { open = false }
  const { AddLanguageModal } = load('features/projects/AddLanguageModal.tsx', { react: h.react,
    'react-router-dom': { useNavigate: () => () => {} }, '../../components/common/Button': { Button: 'Button' }, '../../components/common/Card': { Card: 'Card' },
  }, { document, HTMLElement: Element })
  const render = () => h.render(() => AddLanguageModal({ projectId: 'p', projectName: 'Museum', existingLanguages: ['en'], sourceLanguage: 'vi', open, onClose: close }))
  const tree = render(); tree.props.ref.current = dialog
  let prevented = 0
  document.activeElement = last; listeners.get('keydown')({ key: 'Tab', shiftKey: false, preventDefault() { prevented++ } }); assert.equal(document.activeElement, first)
  listeners.get('keydown')({ key: 'Tab', shiftKey: true, preventDefault() { prevented++ } }); assert.equal(document.activeElement, last)
  listeners.get('keydown')({ key: 'Escape', preventDefault() { prevented++ } }); assert.equal(open, false)
  render(); assert.equal(document.activeElement, opener); assert.equal(listeners.size, 0); assert.equal(prevented, 3)
})

test('Customer translation workspace and preflight have distinct sibling keys for each target', () => {
  for (const target of ['en','ja','ko','zh']) {
    const exports = {}
    const source = readFileSync(new URL('../src/pages/TranslationPage.tsx', import.meta.url), 'utf8').replaceAll('import.meta.env', '({VITE_CUSTOMER_TRANSLATION_ENABLED:"true"})')
    const deps = {
      'react-router-dom': { useParams: () => ({ projectId: 'p' }), useSearchParams: () => [new URLSearchParams({ language: target })] },
      '../features/projects/useProjects': { useProject: () => ({ project, isLoading: false }) },
      '../features/projects/sourceLanguage': { sourceState: () => ({ confirmed: true }) },
      '../features/projects/workflowRouteGuard': { resolveWorkflowRouteAccess: () => ({ allowed: true, canMutate: true, targetLanguage: target }) },
      '../features/translation/GroupTranslationWorkspace': { GroupTranslationWorkspace: 'Workspace' },
      '../features/translation/CustomerSimplePreflight': { CustomerSimplePreflight: 'Preflight' },
    }
    runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
      exports, require: name => name in deps ? deps[name] : name === 'react/jsx-runtime' ? require(name) : {}, URLSearchParams,
    })
    const siblings = exports.TranslationPage().props.children
    assert.equal(siblings[0].type, 'Workspace'); assert.equal(siblings[1].type, 'Preflight')
    assert.notEqual(siblings[0].key, siblings[1].key)
    assert.ok(siblings.every(child => child.key.includes(target)))
  }
})
