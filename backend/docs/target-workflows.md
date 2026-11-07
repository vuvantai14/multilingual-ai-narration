# S32.4 — Per-target workflow and artifact isolation

Implementation: 2026-11-05. Baseline: `315800f`. Backend + Customer Web only.
No live database, provider, FFmpeg, migration, seed or deployment was executed.

## Contract and compatibility

`GET /api/projects/:id` keeps the existing `status`, `progress` and `workflow`
and adds `targetWorkflows` for en/ja/ko/zh, excluding the confirmed source.
Each entry contains `targetLanguage`, `status`, `failureCode`, `workflow`,
`translationIds`, `narrationIds` and `resultIds`. The IDs only represent CURRENT
artifacts; audio/video additionally require an existing file with matching size.
This read summary is not a reservation or execution permission.

States: NOT_STARTED, TRANSLATING, AWAITING_REVIEW, TRANSLATED,
GENERATING_AUDIO, AUDIO_READY, PROCESSING_VIDEO, COMPLETED, FAILED, BLOCKED.
VIDEO needs a current Result; AUDIO needs a current Narration. Neither progress
100 nor a completed processing job alone proves completion. A failed latest
operation remains FAILED while earlier valid artifacts remain separately readable.

Customer SIMPLE may translate a new target on a COMPLETED project. Approval,
TTS start/failure and video start/failure preserve that legacy COMPLETED state.
Legacy status describes the original project lifecycle, not completion of every
language. Dashboard/Admin aggregate calculations are unchanged. Non-SIMPLE
translation state gates are retained.

## Binding and persistence

- Translation: exact current transcript + target, reviewed digest and revision.
  Existing translations are not overwritten and attempts/quota rules remain.
- Narration: exact translation + voice + speed, matching target and source revision.
  Existing unique index remains `(translationId, voiceId, speed)`. Backend speed
  remains 1; Web reflects the returned saved speed rather than inventing a value.
- Result: exact narration + project, matching language and the full current
  provenance chain. Existing `(projectId, narrationId)` unique index remains.
- UUID filenames keep targets/configurations separate. No schema/index migration
  or reclassification of legacy unknown provenance is performed.
- Narration completion now stores narration, completed job and legacy terminal
  transition in one transaction with sequential source revision fences. Result
  retains its transaction. Post-commit response failure never deletes saved files.

The only optional schema addition is `Project.targetOperation`:
`{token,targetLanguage,kind,startedAt}`. Missing fields match the idle CAS without
backfilling old documents. The field is not exposed in the public project DTO.
Normal authorized processing writes it; this implementation session did not.

## Concurrency and uncertain outcomes

Translation preview/generation, approval, TTS and video composition acquire a
project-wide CAS with majority+journal acknowledgement. An active job in any
target prevents new work. Release checks the exact owner token. Nested calls may
reuse only the same project/owner/target. Existing admission, quota, attempt and
idempotency mechanisms remain in place. Source confirmation/edit/transcription
also respect the fence. Controlled read-only readiness does not acquire a fence.

There is deliberately no TTL, automatic takeover, retry or recovery write.
Uncertain translation dispatch/ledger outcomes and TTS timeouts retain the project fence. A
process crash or failed release can also leave it held. Inspect provider receipts,
attempts, jobs and artifact provenance before any separately authorized operator
recovery. Never clear a lock simply because it is old. Existing artifacts remain
readable. A rolling deployment mixing old and new workers cannot prove this
cross-process guarantee; replace old workers before live acceptance.

## Customer Web

Detail exposes per-target status. Translation/Voice/Generate/Result select the
explicit target and key their workspaces by project + target. Missing target with
the new contract shows a picker; legacy payloads retain their former behavior.
Services no longer pick a latest artifact across different targets. Late result
and media responses are ignored, with object URLs cleaned up.

Adding a language navigates within the same project rather than cloning it.
Result tabs and library items use target-specific artifact evidence. A failed
replacement cannot hide an earlier current downloadable artifact. Library
detail reads are GET-only, bounded to four concurrent projects; this adds N+1
reads and needs performance acceptance for large libraries. Source-specific
media validation still applies; VIDEO never masquerades as an audio Result.

## Changed files

Backend:

- `src/models/Project.ts`
- `src/services/{target-operation,target-workflow,project,narration,result,source-language,transcription}.service.ts`
- `src/services/translation/{group-translation.service,customer-simple-preflight}.ts`
- `tests/{target-workflow,customer-multilang,customer-translation,downstream-stale-guards,group-translation,source-language,group-admission}.test.ts`
- This document.

Customer Web:

- `src/features/projects/{TargetWorkflows.tsx,targetWorkflow.ts,AddLanguageModal.tsx,types.ts,projectRepository.ts,useProjects.ts}`
- `src/features/results/{libraryPresentation,resultService,useCompleteHistory,useResult}.ts`
- `src/features/translation/translationService.ts`
- `src/features/voice/narrationService.ts`
- `src/features/processing/generationService.ts`
- `src/pages/{TranslationPage,VoicePage,GeneratePage,ResultPage,ProjectDetailPage,HistoryPlaceholder}.tsx`
- `tests/{target-workflow,audio-generation,narration-library,project-form-polish}.test.mjs`

Local handoff: `.agents/skills/multilang-progress/{PROGRESS,DECISIONS,CHANGELOG}.md`.
The existing `.agents` ignore rule is unchanged.

## Verification

Focused Backend mocks cover completed en -> ja/ko/zh, failed ja + explicit retry,
exact artifacts and unchanged en bytes/documents, second voice isolation,
concurrent TTS/video requests, revision drift during synthesis, attempts,
quota/admission, source contracts and legacy regression. Tests reject real DB
connections and external network; synthetic bytes and mocked composition are
not real audio/video generation. Disposable files remain inside backend/.tmp.

Focused Web fixtures cover target selection, exact narration/translation joins,
ambiguous missing targets, VIDEO versus AUDIO, draft/review/error regression,
late responses/object URL cleanup, same-project add-language navigation and
bounded/aborted library loads. TypeScript, lint, builds and design checks are
required. Exact final totals are in the progress skill.

Real browser/session, filesystem performance, Atlas transaction/failover and paid
translation/TTS/media acceptance: NOT RUN / PARTIAL. No claim of live PASS.
Gemini voices for ja/ko/zh are still S32.5; missing voices remain a real capability
gate rather than a fallback to another provider. Mobile parity remains S32.7:
no Mobile application file was changed. Shared design adapters and four focused
Mobile design/token tests passed without changing Mobile logic.
