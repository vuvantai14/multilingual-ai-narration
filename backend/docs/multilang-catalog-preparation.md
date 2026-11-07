# S32.5A — Catalog preparation

Date: 2026-11-05. Status: code/mock checks and read-only Atlas dry-run PASS.
S32.5B: PENDING_APPROVAL. Database migration: NOT APPLIED.

## Source changes

- `src/scripts/language-catalog-data.ts`: vi/en/ja/ko/zh only; zh labelled Simplified Chinese. Existing database labels are not updated.
- `src/scripts/gemini-voice-catalog-data.ts`: eight fixed target/voice combinations, retaining the original two voice definitions.
- `src/scripts/seed-voice-catalog.ts`: only seed languages in the five-code catalog; never recreate French voices through active database languages.
- `scripts/clean-catalog.ts`: retired destructive cleanup entrypoint; exits without connecting or deleting.
- `src/scripts/seed-gemini-voice-catalog.ts`: legacy entrypoint now dry-run only; apply directs operators to the guarded migration.
- New `src/scripts/{multilang-catalog-plan,multilang-catalog-store,prepare-multilang-catalog}.ts`.
- `src/services/narration.service.ts`: voice provider must equal configured provider; fallback lookup stays within that provider. Existing wrong-language/inactive checks retained. No TTS adapter changes.
- `package.json`: `catalog:multilang`, `test:multilang-catalog` scripts; no dependency changes.
- Tests: new `tests/multilang-catalog.test.ts`, updated `tests/language-catalog.test.ts`; new Web `tests/voice-catalog-multilang.test.mjs`. Existing S32.4 changes preserved.

Historical French display labels in analytics/Admin/project history remain read-only compatibility mappings, not catalog seeds. No Mobile or Admin source was changed.

## Read-only Atlas evidence

Database `multilingual_ai_narration`; configured Atlas identity verified by URI database, SRV hostname and replica hello. No URI, credentials or raw host names are recorded here. Identity fingerprint:
`a7fdc07b3a0d77be15bf5f6a175cce1cf28508eed09532386840bb4f94c03868`.

Dry-run: `npm.cmd run catalog:multilang -- --dry-run`.
Plan digest: `f5838219478b060154bb7daf8e15368c4ec17266b06ed46c49d0f4607dddfa23`.
Result: planned=6, existing=2, conflict=0; inserted=0, deleted=0, databaseWrites=0.
Catalog fingerprint and collection counts unchanged before/after. Both required unique indexes verified:
`languages {code:1}` and `voices {provider:1,providerVoiceId:1,languageId:1}` without sparse/partial/collation changes.
Active jobs/project fences=0. No unknown or missing collections.

| Catalog | Actual before/after dry-run | Expected after future approved apply |
| --- | ---: | ---: |
| Languages | 6 | 5 |
| Voices | 38 | 38 |
| Gemini voices | 2 | 8 |
| OpenAI voices | 36 | 30 |

## Exact insert candidates

New ObjectIds are allocated only by a future apply; none exist yet. Unique keys:

| language | languageId | provider | providerVoiceId | gender | active |
| --- | --- | --- | --- | --- | --- |
| ja | 6acc429554c50d7e63bd2137 | gemini | Kore | FEMALE | true |
| ja | 6acc429554c50d7e63bd2137 | gemini | Fenrir | MALE | true |
| ko | 6acc429554c50d7e63bd2138 | gemini | Kore | FEMALE | true |
| ko | 6acc429554c50d7e63bd2138 | gemini | Fenrir | MALE | true |
| zh | 6acc429554c50d7e63bd2139 | gemini | Kore | FEMALE | true |
| zh | 6acc429554c50d7e63bd2139 | gemini | Fenrir | MALE | true |

Existing en Kore `6aea08467711084f8ed07733` and Fenrir `6aea08467711084f8ed07734` are kept byte-for-byte. No Gemini vi or OpenAI additions.

## Exact French removal candidates — not deleted

All voices below belong to French Language `6acc429554c50d7e63bd213a`, provider openai.

| collection | id | code/voice |
| --- | --- | --- |
| voices | 6adcec558b6a60320349c1b2 | coral |
| voices | 6adcec558b6a60320349c1b3 | alloy |
| voices | 6adcec558b6a60320349c1b4 | nova |
| voices | 6adcec558b6a60320349c1b5 | echo |
| voices | 6adcec568b6a60320349c1b6 | onyx |
| voices | 6adcec568b6a60320349c1b7 | fable |
| languages | 6acc429554c50d7e63bd213a | fr |

## Reference coverage

All 16 non-catalog collections were scanned using positive projections of language/voice reference fields; no passwords/tokens, transcript text or media retrieved. Nested draft JSON is parsed in memory, never printed. French codes/locales, Language/Voice IDs, actor entity IDs, language arrays and visitor URL language parameters are checked. Malformed/oversized drafts, unknown collections, scan/count drift or missing evidence block apply.

| Collection | Documents checked | French references / invalid |
| --- | ---: | --- |
| projects | 35 | 0 / 0 |
| transcripts | 24 | 0 / 0 |
| transcriptsegments | 4753 | 0 / 0 |
| translations | 5 | 0 / 0 |
| translationsegments | 0 | 0 / 0 |
| translationattempts | 22 | 0 / 0 |
| narrations | 5 | 0 / 0 |
| results | 3 | 0 / 0 |
| processingjobs | 66 | 0 / 0 |
| media | 35 | 0 / 0 |
| listenevents | 10 | 0 / 0 |
| visitors | 1 | 0 / 0 |
| visitqrs | 0 | 0 / 0 |
| activitylogs | 486 | 0 / 0 |
| users | 11 | 0 / 0 |
| authsessions | 14 | 0 / 0 |

This is a dated schema-based reference audit, not proof about arbitrary undocumented fields. New schemas/collections must be reviewed before apply.

## Apply conditions — no execution authorized here

Separate explicit user approval for S32.5B must name the six inserts and seven deletions. Stop all API/worker/seed writers for the operation: snapshot transactions alone do not stop a new foreign reference from being inserted. Re-run dry-run, review the exact target fingerprint and current plan digest, verify indexes, no references/conflicts/active work and backup/recovery readiness.

Future command shape only:

```powershell
npm.cmd run catalog:multilang -- --apply --approve=S32.5B --confirm-writers-stopped --confirm-target=<fresh-identity> --plan=<fresh-digest>
```

Missing approval fails before connection. Changed plan/target or references fails before writes. Apply uses one manually controlled snapshot transaction, insert-if-absent `$setOnInsert`, then exact-document `deleteOne` (voices before Language). No deleteMany, model initialization, DDL, artifact writes or automatic transaction retry. Existing records are never updated/reactivated. Unknown commit outcome exits for operator review, never automatic replay. A second approved run is a no-op with a fresh digest.

## Verification and limits

Backend 95/95 focused tests across eight files PASS, including catalog safety, native dry-run no-write adapter, mocked apply/idempotency, approval/reference/concurrent drift guards, uncertain commit and current S32.4 regression. Customer Web 21/21 tests across three files PASS (five new selector/client cases). Backend typecheck/lint/build PASS.

No live migration, paid Gemini/TTS, real synthesis, FFmpeg, database artifact/revision/job changes, .env change, Mobile change or commit/push. Runtime ja/ko/zh voices remain unavailable until approved apply. Actual language/pronunciation/Simplified Chinese audio quality is untested. Gemini adapter currently consumes language via text rather than explicit language metadata; this stage verifies unchanged target forwarding to the adapter, not audio quality. Mobile parity remains S32.7.
