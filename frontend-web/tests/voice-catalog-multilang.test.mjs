import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { filterVoicesByLanguage, filterVoicesByGender, validateNarrationConfig } from '../src/features/voice/voiceUtils.ts'

const voices = ['en', 'ja', 'ko', 'zh'].flatMap(languageCode => [
  { id: languageCode + '-Kore', name: 'Kore', languageCode, gender: 'Female', isActive: true },
  { id: languageCode + '-Fenrir', name: 'Fenrir', languageCode, gender: 'Male', isActive: true },
])
for (const target of ['en', 'ja', 'ko', 'zh']) test(`voice selector ${target}: target/gender/active filters and saved configuration`, () => {
  const selected = filterVoicesByLanguage([...voices, { ...voices[0], id: 'inactive', languageCode: target, isActive: false }], target)
  assert.equal(selected.length, 2); assert.ok(selected.every(voice => voice.languageCode === target && voice.isActive))
  assert.equal(filterVoicesByGender(selected, 'Female')[0].name, 'Kore')
  assert.equal(filterVoicesByGender(selected, 'Male')[0].name, 'Fenrir')
  const config = { projectId: 'p', translationId: 't-' + target, languageCode: target, voiceId: target + '-Kore', speed: 1 }
  assert.equal(validateNarrationConfig(config, voices), null)
  assert.ok(validateNarrationConfig({ ...config, voiceId: (target === 'en' ? 'ja' : 'en') + '-Kore' }, voices))
  assert.ok(validateNarrationConfig(config, voices.map(voice => ({ ...voice, isActive: false }))))
})

test('voice client uses exact target GET, preserves zh and does not request TTS or preview', async () => {
  const exports = {}, paths = []
  const source = ts.transpileModule(readFileSync(new URL('../src/features/voice/voiceService.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  runInNewContext(source, { exports, require: name => {
    assert.equal(name, '../../lib/api')
    return { api: async (path, options) => {
      assert.equal(options?.method ?? 'GET', 'GET'); paths.push(path)
      const target = new URL(path, 'http://fixture.invalid').searchParams.get('language')
      return { voices: voices.filter(voice => voice.languageCode === target).map(voice => ({ ...voice, gender: voice.gender.toUpperCase(), language: { code: target } })), languages: [] }
    } }
  } })
  for (const target of ['en', 'ja', 'ko', 'zh']) {
    const result = await exports.voiceService.getVoices(target)
    assert.equal(result.length, 2); assert.ok(result.every(voice => voice.languageCode === target))
  }
  assert.deepEqual(paths, ['en', 'ja', 'ko', 'zh'].map(code => '/voices?language=' + code))
})
