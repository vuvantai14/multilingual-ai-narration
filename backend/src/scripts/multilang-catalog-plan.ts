import { createHash } from 'node:crypto';
import { LANGUAGE_CATALOG } from './language-catalog-data.js';
import { GEMINI_VOICE_LANGUAGES, planGeminiVoices, type ExistingVoice } from './gemini-voice-catalog-data.js';

export class CatalogMigrationError extends Error {}
export type Row = Record<string, unknown> & { _id: unknown };
export const REVIEWED_COLLECTIONS = Object.freeze(['languages', 'voices', 'projects', 'transcripts', 'transcriptsegments',
  'translations', 'translationsegments', 'narrations', 'results', 'processingjobs', 'translationattempts', 'media',
  'listenevents', 'visitors', 'visitqrs', 'activitylogs', 'users', 'authsessions']);
// Positive projection: do not retrieve passwords, tokens, URIs, transcripts or media.
export const REFERENCE_FIELDS = Object.freeze(['sourceLanguage', 'detectedSourceLanguage', 'targetLanguage', 'languageCode',
  'language', 'languageId', 'languageIds', 'languages', 'voiceId', 'voiceIds', 'targetOperation', 'draftJson', 'entityType', 'entityId', 'targetPath']);
export type ReferenceEvidence = { collection: string; checked: number; references: number; invalid: number; sampleIds: string[] };
export type Snapshot = { targetIdentity: string; languages: Row[]; voices: Row[]; languageIndex: boolean; voiceIndex: boolean;
  collections: string[]; counts: Record<string, number>; references: ReferenceEvidence[]; activeWork: number };
const text = (value: unknown) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const id = (value: unknown) => String(value ?? '');
const objectId = (value: unknown): value is { toHexString(): string } => value != null && typeof value === 'object' && 'toHexString' in value && typeof value.toHexString === 'function';
const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (objectId(value)) return value.toHexString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])]));
  return value;
}
export const catalogDigest = (languages: readonly Row[], voices: readonly Row[]) => hash(canonical({
  languages: [...languages].sort((a, b) => id(a._id).localeCompare(id(b._id))),
  voices: [...voices].sort((a, b) => id(a._id).localeCompare(id(b._id))),
}));

export function referenceEvidence(collection: string, rows: readonly Row[], languageIds: readonly string[], voiceIds: readonly string[]): ReferenceEvidence {
  const forbidden = new Set([...languageIds, ...voiceIds]);
  let references = 0, invalid = 0;
  const sampleIds: string[] = [];
  const walk = (value: unknown, key = '', depth = 0): boolean => {
    if (depth > 30) throw new CatalogMigrationError('REFERENCE_DEPTH_EXCEEDED');
    if (value == null) return false;
    if (objectId(value)) return forbidden.has(value.toHexString());
    if (typeof value === 'string') {
      if (forbidden.has(text(value))) return true;
      if (/language|locale/i.test(key) && /^fr(?:$|[-_])/.test(text(value))) return true;
      if (key === 'targetPath') {
        const url = new URL(value, 'http://reference.invalid');
        if (['language', 'lang'].some(field => /^fr(?:$|[-_])/.test(text(url.searchParams.get(field)))) || /(?:^|\/)fr(?:$|[-_/])/i.test(decodeURIComponent(url.pathname))) return true;
      }
      if (key === 'draftJson') {
        if (Buffer.byteLength(value) > 131072) throw new CatalogMigrationError('DRAFT_NOT_INSPECTABLE');
        return walk(JSON.parse(value), '', depth + 1);
      }
      return false;
    }
    if (Array.isArray(value)) return value.some(item => walk(item, key, depth + 1));
    if (typeof value === 'object') return Object.entries(value).some(([field, item]) => field !== '_id' && walk(item, field, depth + 1));
    return false;
  };
  for (const row of rows) {
    try { if (walk(row)) { references++; if (sampleIds.length < 5) sampleIds.push(id(row._id)); } }
    catch { invalid++; }
  }
  return { collection, checked: rows.length, references, invalid, sampleIds };
}

export function planMultilangCatalog(snapshot: Snapshot) {
  const blockers: string[] = [];
  const languages = snapshot.languages, voices = snapshot.voices;
  if (!/^[a-f0-9]{64}$/.test(snapshot.targetIdentity)) blockers.push('TARGET_IDENTITY_UNVERIFIED');
  if ([...languages, ...voices].some(row => !objectId(row._id)) || voices.some(row => !objectId(row.languageId))) blockers.push('CATALOG_ID_ANOMALY');
  if (!snapshot.languageIndex || !snapshot.voiceIndex) blockers.push('UNIQUE_INDEX_MISSING_OR_UNSUITABLE');
  const unknown = snapshot.collections.filter(name => !REVIEWED_COLLECTIONS.includes(name));
  const missing = REVIEWED_COLLECTIONS.filter(name => !snapshot.collections.includes(name));
  if (unknown.length || missing.length) blockers.push('COLLECTION_COVERAGE_UNVERIFIED');
  if (snapshot.references.length !== snapshot.collections.filter(name => !['languages', 'voices'].includes(name)).length
    || new Set(snapshot.references.map(row => row.collection)).size !== snapshot.references.length
    || snapshot.collections.some(name => !['languages', 'voices'].includes(name) && !snapshot.references.some(row => row.collection === name))) blockers.push('REFERENCE_SCAN_INCOMPLETE');
  if (snapshot.references.some(row => row.invalid)) blockers.push('REFERENCE_SCAN_INVALID');
  if (snapshot.references.some(row => row.checked !== snapshot.counts[row.collection])) blockers.push('REFERENCE_SCAN_COUNT_CHANGED');
  if (snapshot.references.some(row => row.references)) blockers.push('FRENCH_REFERENCES_FOUND');
  if (snapshot.activeWork) blockers.push('ACTIVE_WORK_PRESENT');
  const codes = languages.map(row => text(row.code));
  if (new Set(codes).size !== codes.length) blockers.push('DUPLICATE_LANGUAGE_CODES');
  if (languages.some(row => typeof row.code !== 'string' || row.code !== text(row.code) || !['vi', 'en', 'ja', 'ko', 'zh', 'fr'].includes(row.code))) blockers.push('LANGUAGE_ANOMALY');
  for (const expected of LANGUAGE_CATALOG) if (languages.filter(row => row.code === expected.code && row.isActive === true).length !== 1) blockers.push(`LANGUAGE_NOT_ACTIVE_${expected.code.toUpperCase()}`);
  const keys = voices.map(row => `${text(row.provider)}|${text(row.providerVoiceId)}|${id(row.languageId)}`);
  if (new Set(keys).size !== keys.length) blockers.push('DUPLICATE_VOICE_KEYS');
  if (voices.some(row => !['openai', 'gemini'].includes(String(row.provider)) || typeof row.providerVoiceId !== 'string' || !row.providerVoiceId || !languages.some(language => id(language._id) === id(row.languageId)) || typeof row.isActive !== 'boolean')) blockers.push('VOICE_ANOMALY');
  const frenchLanguages = languages.filter(row => text(row.code) === 'fr');
  const frenchIds = new Set(frenchLanguages.map(row => id(row._id)));
  const frenchVoices = voices.filter(row => frenchIds.has(id(row.languageId)));
  if (frenchLanguages.length > 1 || frenchVoices.some(row => row.provider !== 'openai')) blockers.push('FRENCH_CATALOG_ANOMALY');
  const create: Array<{ languageCode: string; document: Record<string, unknown> }> = [];
  let existing = 0;
  for (const code of GEMINI_VOICE_LANGUAGES) {
    const language = languages.find(row => row.code === code);
    if (!language) continue;
    const records: ExistingVoice[] = voices.map(row => ({ languageId: row.languageId, provider: typeof row.provider === 'string' ? row.provider : '',
      providerVoiceId: typeof row.providerVoiceId === 'string' ? row.providerVoiceId : '', name: typeof row.name === 'string' ? row.name : '', gender: typeof row.gender === 'string' ? row.gender : '', isActive: row.isActive === true }));
    const plan = planGeminiVoices(records, id(language._id));
    if (plan.conflicts.length) blockers.push(`GEMINI_CONFLICT_${code.toUpperCase()}`);
    if (code === 'en' && plan.existing !== 2) blockers.push('EN_BASELINE_MISMATCH');
    existing += plan.existing;
    for (const voice of plan.planned) create.push({ languageCode: code, document: { ...voice, languageId: language._id } });
  }
  const remove = [
    ...frenchVoices.map(document => ({ collection: 'voices' as const, document })),
    ...frenchLanguages.map(document => ({ collection: 'languages' as const, document })),
  ];
  const uniqueBlockers = [...new Set(blockers)];
  const digest = hash(canonical({ version: 'S32.5B', target: snapshot.targetIdentity,
    catalog: catalogDigest(languages, voices), create, remove, blockers: uniqueBlockers }));
  return { digest, targetIdentity: snapshot.targetIdentity, planned: create.length, existing, conflict: uniqueBlockers.length,
    blockers: uniqueBlockers, create, remove, eligibleFrench: uniqueBlockers.length ? [] : remove,
    unknownCollections: unknown, missingCollections: missing, references: snapshot.references, activeWork: snapshot.activeWork,
    indexes: { languageCodeUnique: snapshot.languageIndex, voiceCompoundUnique: snapshot.voiceIndex },
    before: { languages: languages.length, voices: voices.length, gemini: voices.filter(row => row.provider === 'gemini').length, openai: voices.filter(row => row.provider === 'openai').length },
    expectedAfter: { languages: languages.length - frenchLanguages.length, voices: voices.length + create.length - frenchVoices.length,
      gemini: voices.filter(row => row.provider === 'gemini').length + create.length, openai: voices.filter(row => row.provider === 'openai').length - frenchVoices.length },
  };
}
export type MigrationOptions = { apply: boolean; approval?: string; plan?: string; target?: string; maintenance: boolean };
export function migrationOptions(args: readonly string[]): MigrationOptions {
  const options: MigrationOptions = { apply: false, maintenance: false }, seen = new Set<string>();
  for (const arg of args) {
    const [flag, ...parts] = arg.split('='); const value = parts.join('=');
    if (seen.has(flag!)) throw new CatalogMigrationError('INVALID_OPTIONS'); seen.add(flag!);
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === '--confirm-writers-stopped') options.maintenance = true;
    else if (flag === '--approve' && value === 'S32.5B') options.approval = value;
    else if (flag === '--plan' && /^[a-f0-9]{64}$/.test(value ?? '')) options.plan = value;
    else if (flag === '--confirm-target' && /^[a-f0-9]{64}$/.test(value ?? '')) options.target = value;
    else throw new CatalogMigrationError('INVALID_OPTIONS');
  }
  if (seen.has('--apply') && seen.has('--dry-run')) throw new CatalogMigrationError('INVALID_OPTIONS');
  return options;
}
export function assertMigrationApproval(options: MigrationOptions, plan?: ReturnType<typeof planMultilangCatalog>) {
  if (!options.apply) return;
  if (options.approval !== 'S32.5B' || !options.maintenance || !options.plan || !options.target) throw new CatalogMigrationError('S32_5B_APPROVAL_AND_MAINTENANCE_REQUIRED');
  if (plan && (plan.conflict || options.plan !== plan.digest || options.target !== plan.targetIdentity)) throw new CatalogMigrationError('PLAN_CHANGED_OR_REFERENCES_UNSAFE');
}
