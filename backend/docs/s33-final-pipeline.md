# S33 FINAL: media → Gemini → narration

## FINAL E2E actual STT HTTP503 diagnosis - 2026-11-07

Requested recheck08:26 Bangkok: same persisted evidence/logs/journals/manifest,
runtime STOPPED, exact project/job/media/artifact counts confirmed unchanged.
No additional provider metadata/requestID/body available. Diagnosis below remains;
no code edit/test/provider call/restart/Atlas write. Private recheck evidence:
`.agents/runtime/final-real-e2e/stt-503-read-only-recheck.json`.

Run `s33_20261107_9b8fd523da6fc6784ca9` is now **STOPPED_NO_RETRY**, not READY.
Project `6aee7c5c52d5012596619bfb`; job `6aee7d176fd1b6fae4bf2b53`.

- HTTP503 origin: actual upstream HTTP status surfaced by installed GeminiSDK
  2.28.0 during `interactions.create`, stageTRANSCRIPTION. SDK error path derives
  status from response.status; SDK network/timeouts are separate statusless
  connection/timeout error wrappers. Backend did not manufacture503 for a local
  missing config: its Customer response is502/STT_EXECUTION_UNCERTAIN. No raw
  response headers/body/wire capture or correlation IDs remain, so exact Google
  model-serving versus gateway origin and outage/overload subcause are UNKNOWN.
- Modelgemini-3.5-transcribe. Configured endpoint derived from deployed adapter
  and SDK defaults: POST https://generativelanguage.googleapis.com/v1beta/interactions.
  Endpoint is code-derived, not captured request metadata. Payload path is storefalse,
  uploaded audio/WAV reference, AUTO without language_codes, verbatim/word timestamps;
  exact request body was not retained, no replay performed.
- Bangkok07Nov: adapter starts08:21:27.499, invocation08:21:32.955,
  HTTP503 observed08:21:34.681 (1.726sec since invocation). Job started08:21:27.308,
  completed08:21:36.675 (9.367sec). Model validation/media probe/extraction/audio
  probe/upload completed before dispatch; no FILE_POLL, no RESPONSE_VALIDATION
  or timestamp normalization. No evidence of120sec timeout, quota/rate429,
  auth401/model403/404 or media-validation error. Do not assert quota was exhausted,
  model invalid, media corrupted, or provider outage internals without evidence.
- Provider diagnostic: STT_PROVIDER_ERROR/http503/diagnosticundefined;
  providerErrorCode/requestId/operationId absent. inferenceStateRESPONSE_RECEIVED,
  outcomeUNCERTAIN, providerAcceptedUNKNOWN, retryAllowedfalse, cleanupFailedfalse.
  STT invocation1/1 (also one CLAIM_STT), Translation0/1/TTS0/1; maxRetries0
  maps to SDK retry max0. No evidence that remote transcript was created; remote
  processing/charge cannot be excluded or checked without another provider request.
- Scoped persistence FIX WORKED: attested failure journal, exact native
  ProcessingJobFAILED/STT_PROVIDER_ERROR+evidence update followed by ProjectFAILED.
  Atlas readback verifies those states; Customer execution projection isUNCERTAIN,
  retryAllowedfalse, not a safe-to-retry failure. Source statusPENDING_DETECTION,
  progress0; no completed transcript/translation/narration/Result or translation
  attempt/quota receipt exists. Absence of application receipt is not billing proof.
- File nỗi đau.mp4:VIDEO/videoMP4,3409585bytes,28.212245sec; disk bytes and
  SHA256 match native claim. Validated source and extracted WAV evidence preserved.
  No provider lookup/media reprocessing in diagnosis.
- Native first request STOP502/STT_EXECUTION_UNCERTAIN; current guardSTOPPED,
  armedfalse. Run manifest hash and project scope match; main359 source/dist
  files match loaded proof. PID10580 not restarted. Earlier READY was activation
  readiness only; this failure does not authorize another scope or reset.

CODE BUG causing503: **NOT ESTABLISHED / UNKNOWN**; no application edit, new
test or retry policy change warranted by current evidence. Missing response
body/correlationID limits deeper attribution; no fabricated provider details.
Safe next action: preserve consumed allowance and STOPPED evidence; do not retry,
resume, upload/create or automatically issue a run. Any later provider incident
correlation or paid recovery needs separately authorized action. Diagnosis used
Atlas/readiness reads and existing local logs only, no writes/provider calls.
Sanitized private evidence: `.agents/runtime/final-real-e2e/stt-503-diagnosis.json`.

## FINAL REAL E2E controlled activation - 2026-11-07 08:18 Bangkok

**READY_FOR_MANUAL_E2E: YES** (activation only; real workflow NOT_STARTED).
Supersedes the earlier session-blocked preflight below. Fresh run
`s33_20261107_9b8fd523da6fc6784ca9`; Backend PID10580/no watcher,
health200/MongoDB connected/CODE_STABILIZED/normalization and scoped error fixes
LOADED. SIMPLE ON/GEMINI_SIMPLE_V1/thinkingDEFAULT; deploymentVERIFIED.

Customer verified via CDP/application GET auth/me200 CUSTOMER and projects200/32,
same owner before/after controlled restart, refresh disabled. Old read-only18588
stopped only after exact identity/idle-scope checks. Compiled composite initialized
native/storage/quota/transaction guards before MongoDB connection; HTTP business
gate remained CLOSED until final one-use arm.180source/179compiled hashes checked;
no app source or .env change. No test-suite reruns.

Read-only preflight: active owner,5languages/8activeGemini voices/unique index,
application quota20user/200global remaining, storage access, FFmpeg/FFprobe9.0.2.
Old stale project/job whole BSON hashes+STOP journal/control/storage verified,
no unexplained active jobs/projects and no active paid scope. Known stale records
left untouched; not an authority to resume/reset old work. Old S33.1 preparer and
its fixed marker were not rerun/reset. New local preparation/evidence namespace:
`.agents/runtime/final-real-e2e/`, existing tested S33_MANUAL_RUN_V1/native composition.

Before final arming:11 business/catalog hashes identical, old controls/storage
identical, reserved new ObjectId absent from projects, new dispatches all0/no stop.
Manifest and guardREADY; project claim0/1, file claim0/1, STT0/1, Translation0/1,
TTS0/1. One MP3/MP4 <=200MiB/1800sec; sourceAUTO/MANUAL, confirmed source,
one distinct targeten/ja/ko/zh and one active matching Kore/Fenrir voice bound by
actual writers. No broad grants, second file/project, inference retry/concurrency
or restart-resume. Old run remains STOPPED_NO_RETRY with oldSTT1 consumed.

Provider quota USER_REPORTED_AVAILABLE, not PROVIDER_VERIFIED; no billing hard
cap. Existing SIMPLE32groups/2000bytes-group/12000inputbytes and TTS4096UTF16
limits remain: media acceptance does not promise all downstream text fits.

User manually executes at http://localhost:5173; Codex did not create/upload or
dispatch. Stop immediately on FAILED/TIMEOUT/UNCERTAIN, do not retry/restart.
Activation evidence: preparation.json, prearm-verification.json and run-specific
manifest/runtime/armed/activation-result JSONs. No Atlas business writes, inference,
old state repair, .env/secrets, unrelated services, commit/push. Stop after handoff.

## FINAL REAL E2E activation preflight - 2026-11-07

**BLOCKED / USER_LOGIN_REQUIRED; READY_FOR_MANUAL_E2E: NO.** Fresh user approval
for exactly one manual Customer/new-project/MP3-or-MP4/STT1/Translation1/TTS1 run
is valid; no scope created and no allowance consumed/issued by this attempt.

- Actual Customer check01:13:32UTC: CDP9222 reachable, exactly one dashboard tab,
  GET auth/me401 through existing app client with auth refresh disabled. Projects
  GET not attempted. User asked to log in manually; no credential/cookie/token
  extraction, login/logout/refresh or user-interface mutation by Codex.
- Existing PID18588 stays READY_READ_ONLY, health200/MongoDB connected/Web200.
  CODE_STABILIZED180 source/179dist hashes match; SIMPLE ON/DEFAULT, existing
  Gemini model configuration/key-present checks PASS; FFmpeg/FFprobe9.0.2 version
  PASS, storage root present. No model-access or paid provider request.
- No active test scope/inference. Old STOPPED run controls unchanged; known stale
  project/job full BSON hashes match the prior checkpoint, no unexplained active
  job/project. They were not repaired, reset, resumed or treated as a new allowance.
- No new manifest/run/journal/allowance, restart, app source/.env change, tests,
  Atlas business write or provider call. Keep the consumed S33.1 preparation
  marker intact. Next action is valid Customer verification and remaining exact
  owner/quota/scope preflight, then a fresh one-use activation under this approval.

## FINAL DEPLOY read-only activation - 2026-11-07 08:11 Bangkok

**READY_READ_ONLY**, superseding the earlier code-not-loaded checkpoint below.
User approved this controlled restart only; no new E2E run/allowance was issued.

- Preflight PASS: actual8080 owner18044/workspace manual-server/no watcher,
  run STOP_STT/STOPPED, one known stale PROCESSING job and no unexplained active
  jobs; normal startup has no queue worker or auto-resume. App source unchanged
  and180 files match tested CODE_STABILIZED evidence;179 emitted JS files verified.
- Standard command `npm.cmd run start` -> `node dist/server.js`, with runtime-only
  NODE_OPTIONS preload. Existing read-only/auth policy and tested native
  default-DENY/raw-command/write-aggregate boundary install BEFORE entry/connect.
  HTTP business mutation/upload gate precedes Express/Multer. Existing narrow
  authsessions exception retained; external fetch and FFmpeg remain blocked.
- Only old verified PID18044 stopped,8080 released; new Backend PID18588, no
  watcher. `/api`200 and `/api/health`200/MongoDB connected. Actual imports verify
  BOUNDED_TIMELINE_V1 normalization, scoped failure support and error409 mapping;
  source/compiled hashes match. SIMPLE process-only ON/GEMINI_SIMPLE_V1/DEFAULT,
  E2E modeOFF/uninitialized, no manifest or worker bootstrap.
- Offline native/HTTP guard smoke and real GET health/readiness only. No provider
  call, synthetic mutation sent to Atlas, real media or full test-suite rerun.
- Before/after BSON hashes identical for projects/media/jobs/transcripts/segments/
  translations/attempts/narrations/results/languages/voices;8 old control files
  and2 old-run storage files also identical. Old project/job still TRANSCRIBING/
  PROCESSING, old run STOPPED_NO_RETRY/consumedSTT1. New process dispatches0,
  initializedfalse/new allowance0 are NOT a reset of the old run.

Private evidence and startup configuration: `.agents/runtime/final-deploy/`
`{preflight,deploy-proof,runtime,postcheck}.json`, `read-only-preload.mjs` and logs.
These are READ_ONLY deployment evidence, not a run manifest or paid-call grant.
No .env/secrets, application source, old state/journal/allowance or unrelated
service change; no commit/push. Manual E2E remains BLOCKED_FOR_NEW_RUN. Stop here.

## FINAL STABILIZATION - 2026-11-07

**CODE_STABILIZED** for known defects and isolated integration coverage.
**RUNTIME_READY: BLOCKED. REAL_E2E_PASS: NOT_VERIFIED.**
This section supersedes prior source-only strict-timestamp/activation checkpoints;
it does not rewrite their historical evidence or authorize a new run.

- Timestamp policy `BOUNDED_TIMELINE_V1`, tolerance50ms: preserve transcript text
  and word order; merge identical intervals or point words into an adjacent real
  interval, adjust only small overlaps, retain content/explicit segment bounds.
  Extension is bounded against the original anchor, not chained indefinitely.
  No epsilon durations, sorting, dropped words, arbitrary interpolation or
  clamping negative/out-of-media times. Unanchored/all-point/reversed/large-overlap
  timelines fail with a structured diagnostic. Persist numeric-only normalization
  counts/max adjustment in optional STT evidence; no DB migration/backfill.
- Real evidence reproduced: zero-based wordIndex51/start=end13.300s. Regression
  uses that exact fact plus explicitly synthetic neighboring words/audio, passes
  through HTTP STT->normalization->native guarded transcript persistence->source
  confirmation->SIMPLE/quota/approval->TTS->verified MP4/playback/full download.
  Raw original response and neighboring offsets were never saved: this is NOT
  a full replay and does not prove the old response could safely normalize.
- Guard terminal paths: exact run/owner/project/new job or translation attempt
  only; attested STT evidence, Translation failure state/phase/diagnostic and
  TTS/Result failure details. Success/FAILED/UNCERTAIN outcomes stay distinct.
  Job failure persists before project failure sequentially, with a deliberately
  delayed-query regression. Native CAS/one-use grants/commit attestation stay.
  Unknown commit, lost authorization or unavailable DB remain fail closed;
  no claim that diagnostics can always be stored during those failures.
- Root error masking fixed at native error middleware AND Multer: fixed guard
  codes become sanitized409; unknown transaction/receipt commit becomes503 with
  UNCERTAIN; media-no-audio stays422; provider/validation error survives. GET/HEAD
  and missing-media404 do not STOP or consume; no retry/allowance/reset/resume.
- MP3, attached-cover MP3, MP4 audio-only, H264/AAC MP4: real local synthetic
  FFmpeg through actual validation/leases/services; immutable source hashes,
  bounded files, retained/quarantined failed uploads and no second-file/project
  claim. TTS requests explicit WAV from configured Gemini model; PCM-in-WAV is
  converted once to MP3. Undeclared/headerless PCM, malformed/mislabeled/empty or
  silent output fails; no guessed codec/rate. Actual probed Narration duration
  is persisted and scoped metadata checked. No OpenAI dispatch/fallback added.
- Result: positive finite duration, size, H264/AAC/MP4 and source-duration
  tolerance checked; audio/video byte-for-byte authenticated downloads and
  FFprobe playback contract verified in fixtures before COMPLETED. A successful
  committed Result is no longer downgraded to FAILED100% when the later project
  list GET fails; UI reports refresh unavailable and prevents another POST.
- Customer Web preserves structured STT errors after reload, retains UNCERTAIN
  for unknown commits, preserves generation-context errors and keeps no-retry
  controls. No UI redesign. Mobile/Admin unchanged; Mobile transcript uncertainty
  copy remains a documented parity gap, not silently copied from Web.

Files changed in this task (in addition to preserved prior uncommitted work):

- Backend STT: new `services/stt/normalize-timeline.ts`, `gemini-stt.provider.ts`,
  `stt-provider.interface.ts`, `stt-evidence.ts`, `models/ProcessingJob.ts`.
- Backend guard/storage: `services/e2e-{actual-runtime,actual-storage,runtime-boundary}.ts`,
  `middleware/{e2e-multer-storage,error-handler.middleware}.ts`.
- Backend pipeline: `services/{transcription,narration,result}.service.ts`,
  `services/translation/customer-attempt.ts`,
  `services/media-processing/ffmpeg-media-processor.ts`.
- Web: `features/transcript/useTranscriptEditor.ts`,
  `features/processing/{processingService,useProcessing}.ts`.
- Tests: new `stabilization-{timeline,pipeline}.test.ts`, extended
  `helpers/s33-manual-guard-scenario.ts`, `s332-{errors,stt-failure}.test.ts`,
  `customer-multilang.test.ts` (mock metadata now satisfies actual output contract),
  Web `s33-pipeline-ui.test.mjs` and `audio-generation.test.mjs`.

Verification: Backend targeted regression191/191; post-sequential-write38/38;
final release-path42/42 PASS (overlapping suites, not summed). Web103/103 PASS;
Backend/Web TypeScript, lint, build PASS. Web retains3 existing lint warnings and
bundle/static-dynamic-import warnings. Shared design check and7 focused unchanged
Mobile transcript/design tests PASS; no full monorepo suite. Providers mocked,
memory-only DB, isolated synthetic FFmpeg; manual-run harness denies external
fetch. Logs: `backend/.tmp/stabilization-{backend-tests,final-integration,release-check}.log`,
`frontend-web/.tmp-stabilization-web-tests.log`. Main-source hash evidence and
read-only checkpoint are private under `.agents/runtime/final-stabilization/`.

Public contract check (no provider/key/model API request): official
[STT guide](https://aistudio.google.com/docs/transcribe),
[TTS guide](https://aistudio.google.com/docs/speech-generation) and installed
SDK2.28.0 confirm current request shapes/model names; current models unchanged.
This verifies documentation compatibility, not live account access, quota or
speech/translation quality. No new cost/dispatch/size/text limit was introduced.

Runtime checklist / remaining blockers:

1. PID18044 has no watcher and still runs pre-fix S33.1, health/readiness readable
   but guard STOPPED_NO_RETRY/armedfalse, STT1/Translation0/TTS0. No restart here.
2. Old project6aee70cce759b234b089a371/job6aee71776de3d216e6e62f48 remain
   TRANSCRIBING/PROCESSING with no stored transcript/artifact. Logs prove old STT
   failed after provider200; DB state is stale, not permission to resume. Any
   state repair requires separate explicit approval; current prep would block
   on these active-looking records. Do not reset old journal/allowance.
3. Loading a new safe runtime must validate source hashes, active work, guard
   composition before connect/workers, and must not reuse this consumed manifest.
   No new manifest/run/write allowance issued by this stabilization task.
4. For another paid manual test: separate new-run approval, active Customer,
   exact new-project/media/target/voice scope and fresh guard readiness required.
   SIMPLE flags are process-only; .env/secrets unchanged. Provider access/quota
   and real speech/translation/media quality remain unverified here.
5. SIMPLE stays32groups/2000bytes-per-group/12000inputbytes; TTS4096UTF16 units;
   upload200MiB/1800sec does not guarantee downstream text fits. Admission rejects
   overflow without truncating content, silently splitting calls or raising caps.

No Atlas business writes, paid Gemini, real user upload/media encode, old-data
repair/reset/deletion, new run, .env/secrets, Mobile/Admin, commit or push.

## S33.1 final activation - 2026-11-07 07:29 Bangkok

**READY_FOR_MANUAL_E2E** (activation only; real paid E2E NOT_STARTED).
Supersedes prior activation BLOCKED checkpoints below.

- GUARD CODE FIXED / SOURCE MAIN UPDATED /58 targeted tests PASS; Backend
  TypeScript/lint/build PASS reused. No suites rerun or app-source edits here.
- Customer REAL_CUSTOMER_PASS twice through existing CDP tab/application client,
  auth/me200 roleCUSTOMER, projects200/31; final check00:29:36UTC. No token/cookie
  extraction, login/logout/refresh, auto-retry or UI interaction by Codex.
- Read-only Atlas prechecks: correct database/active Customer, activejobs0 and
  activeproject states0,5 active languages/8 active Gemini target voices/unique
  index, application quota20 user/200 global remaining. All9 existing business
  collection BSON snapshots unchanged after restart, including old failed data.
- New one-use run `s33_20261107_751b24c0a4b2018d055d`; local manifest reserves
  one fresh ObjectId only, no project document. Closed HTTP mutation gate until
  fresh Customer+source+health+quota checks, then exclusive/fsynced arm proof.
- Backend PID18044, no watcher; S33_1_LOADED/179 source hashes verified,
  health200/MongoDB connected; SIMPLE ON/GEMINI_SIMPLE_V1/DEFAULT. Composite
  native/storage/quota/transaction guard installed before connect. Manifest and
  guard READY, deployment VERIFIED. Verified old watcher16792/server6672 stopped
  only after no active work. Customer Web5173/PID18320 HTTP200; flagtrue only in
  process. No .env/secret/model changes. FFmpeg/FFprobe9.0.2 version-only PASS.
- STT gemini-3.5-transcribe; translation gemini-3.5-flash;
  TTS gemini-3.8-flash-tts unchanged. Provider quota USER_REPORTED_AVAILABLE,
  live model access NOT_PROVIDER_VERIFIED, cost hard cap UNAVAILABLE; approved
  risk retained, no claim that $1 is enforced.
- Scope: exact verified owner/run/one new project; one MP3/MP4 <=200MiB/1800sec,
  identity claimed after validation, one confirmed source/one different target
  en/ja/ko/zh, one active matching Gemini Kore/Fenrir. STT0/1, Translation0/1,
  TTS0/1; project/file unclaimed. No broad collection grants, old-project mutation,
  duplicate, concurrency, retry, restart-resume or replaced file/target/voice.
- App general media-limits endpoint lists other production formats too; this
  run's actual upload guard accepts MP3/MP4 only. SIMPLE limits remain32groups,
  2000bytes/group/12000inputbytes; TTS4096UTF16 units. File acceptance does not
  guarantee downstream text fits; no truncation or silent extra dispatch allowed.

User must manually create one project at http://localhost:5173, upload one file,
choose AUTO or MANUAL, STT once, confirm source as needed, choose one distinct
target, SIMPLE generate/approve once, matching Kore/Fenrir once, then Result.
On FAILED/TIMEOUT/UNCERTAIN stop immediately: no retry/resume/new run without
diagnosis and any separately required approval. Do not restart this runtime.
Codex performed no real project/upload/provider/encode or Atlas business write.
Private local activation evidence: `.agents/runtime/s33-final/` run-specific
manifest/runtime/armed/activation-result JSONs and `s33-1-preparation.json`.

## S33.1 guard completion and activation checkpoint - 2026-11-07

Supersedes the dated unsupported-contract blockers below; approval for the new
single manual run remains valid. GUARD CODE FIXED, source main UPDATED.

- Updated actual native coordinator/preload, media/Multer/storage, test-run/read
  error handling and target-bound quota transaction. Added `e2e-manual-policy.ts`.
  New contract `S33_MANUAL_RUN_V1` permits one bounded deferred MP3/MP4 claim,
  max200MiB/1800sec; legacy manifest behavior retained. No wildcard writes.
- Source AUTO/MANUAL is truthful; source confirmation, one distinct target from
  en/ja/ko/zh, one active Gemini Kore/Fenrir voice and audio/video completion
  are validated at actual writes. Native scope, exact grants, receipts, committed
  transaction evidence, output leases, first-stop/no-retry/no-resume remain.
- Added `tests/s33-manual-guard.test.ts` and actual-service fixture helper;
  adjusted mutation-stop evidence test. 58 targeted cases PASS, Backend
  typecheck/lint/build PASS. Mock provider/in-memory DB/isolated real synthetic
  FFmpeg only; no live Gemini or Atlas business writes. Prior full suites reused.
- Prepared `.agents/runtime/s33-final/{verify-customer,prepare-new-run,
  manual-server,arm-new-run}.mjs`: safe Customer GETs, read-only prechecks,
  exclusive manifest preparation, guard-before-connect startup with CLOSED HTTP
  mutation gate, then one-use final arming only after fresh Customer/readiness.
  No new run/manifest/allowance created or armed yet.
- At07:27 Bangkok, original safePID18732 is no longer running. Current Backend
  PID6672 under tsx watcher16792 answers health200 but has no controlled S33
  readiness endpoint: guard/runtime scope NOT VERIFIED. Codex did not start,
  stop or restart it. Existing Customer Vite was absent; started PID18320 on5173
  with process-only VITE_CUSTOMER_TRANSLATION_ENABLED=true, HTTP200. No .env edits.
- CDP initially answered200; application-context verification failed without
  HTTP evidence. Latest00:27:36UTC check cannot connect9222:
  **CDP_UNAVAILABLE / SESSION_UNKNOWN**. This does not prove token expiration.

**Activation BLOCKED, not READY_FOR_MANUAL_E2E.** User must reopen Chrome debugging
with Customer session; then verify auth/me200 CUSTOMER and projects200 without
refresh, do read-only job/scope checks and controlled watcher/server replacement,
create one fresh exclusive scope, verify closed-gate runtime and arm once.
Do not upload or invoke inference until that final readiness succeeds.

Date: 2026-11-06. Scope: Backend and Customer Web only. No live provider call,
Atlas business write, seed/migration, real upload, retry, run/manifest reset or
allowance was performed. Existing failed project `6aedea9c7146c4db416c6249` and
job `6aedeaaf7146c4db416c624c` are protected and remain unchanged.

## Verified causes and limits of diagnosis

- The historical provider HTTP503 is confirmed. Its original stage, inference
  dispatch and provider acceptance remain UNKNOWN: the original log lacks those
  fields. Instrumentation cannot reconstruct them or eliminate a provider outage.
- Browser upload validation advertised 500MiB while the Backend default is
  200MiB. Media persistence previously trusted MIME and did not validate streams,
  codec, duration or decodability before recording upload success.
- Official provider verification found a stricter limit for the mode actually
  used: word timestamps limit STT to30minutes, not the plain-transcript one-hour
  ceiling. Upload and the actual STT adapter now share1800seconds and reject
  excess before model lookup/upload/inference.
- TTS had container/frame validation, but ordinary narration persistence could
  mark READY without probing/decoding the final MP3. Header-shaped or silent
  artifacts must not count as completed narration.
- STT UI treated every missing transcript as not started, including legacy jobs
  without safe execution evidence. Upload failure could automatically DELETE its
  already created project and a subsequent attempt could create another project.
- Observed live configuration before integration was GROUPS_V1, Customer
  translation OFF, test-run OFF. Code delivery does not secretly change flags or
  authorize another real attempt.

## Implementation

- Integrates the previously tested nine-file STT patch after baseline SHA256
  checks, preserving unrelated changes. Future job evidence is hidden by default
  and contains allowlisted stage/status/provider code/request and operation IDs,
  invocation/response times, acceptance/outcome and cleanup facts. No raw SDK
  headers/body, URL/key, source text or secrets are persisted/logged.
- Invocation is not proof of network dispatch or provider acceptance. Pre-dispatch
  failure is distinct from post-invocation UNCERTAIN and completed-but-invalid
  response. Legacy FAILED without evidence cannot silently retry. No-speech stays
  a distinct definite failure after a response, without permission to dispatch again.
- Adds authenticated owner-scoped GET `/api/projects/:id/transcription-state`
  and authenticated GET `/api/projects/media-limits`; neither mutates data nor
  invokes AI. UI reload checks execution state and only offers a GET for uncertainty.
- Upload validates extension/MIME aliases, bytes, file size, matching container,
  audio presence, declared video/audio type, codecs, duration and FFmpeg decode
  to a null sink. Audio needs no video. It preserves originals and rejects source
  replacement after transcript or unresolved STT; normal upload uses the existing
  project CAS fence to serialize against STT/target writes. Scope-ON uses its
  existing exact Media lease and independently attested immutable input.
- Stream classification ignores attached album art. MP3 with artwork and audio-only
  MP4 take the Audio Result path; canonical MIME is persisted from verified stream
  type. Stored supported WAV/M4A/MOV/WebM are no longer incorrectly rejected by the
  source-playback GET's former MP3/MP4-only allowlist. Browser codec support still
  varies; Backend decoding, not browser preview success, controls STT admission.
- Metadata ambiguity preserves the uniquely named file for inspection; failed
  validation cleans only the request's new file. No automatic deletion of older
  originals or ambiguous committed uploads. Web retains the known new project ID
  after upload failure, never issues a cleanup DELETE, and fences double clicks.
- New-project form fetches actual Backend limits, blocks creation when limits
  cannot be read, shows browser-readable duration and lets Backend validate codecs.
  Missing browser MIME is normalized from the allowed extension for multipart;
  Backend still validates the actual bytes/container/streams.
- Gemini TTS honors its configured supported model; no implicit fallback from
  OpenAI failure to a second Gemini inference. Existing 120s deadline and zero SDK
  retries remain. WAV is converted once to MP3 and actual bytes/MIME agree.
- Final persisted narration is probed, decoded and checked for acoustic activity
  with FFmpeg astats before READY. Non-silent energy is necessary, not proof of
  intelligible speech, pronunciation, language or transcript fidelity. Those need
  permitted provider/live listening acceptance. Exact run namespace validation
  also requires an installed audio verifier; missing verifier fails closed.
- SIMPLE language/revision/target/quota/approval logic is reused. Approval is
  invoked in the real Customer scope, independently of GROUP_TRANSLATION_ENABLED.
  No source=target, fake AUTO detection, target fallback or quota bypass is added.
- Audio Result remains the current Narration artifact: no dummy Result video or
  mux. Video Result reuses the real renderer with source imagery and H.264/AAC
  output validation. Paid STT/TTS POSTs no longer auto-replay after auth refresh.

## Supported media and admission limits

| Item | Enforced behavior |
| --- | --- |
| Upload formats | MP3, MP4, MOV, WebM (audio or video), WAV, M4A |
| File size | min(`MAX_UPLOAD_SIZE_MB` × 1MiB, existing adapter 500MiB bound); Backend default 200MiB; reported via GET |
| Duration | Positive and at most 1800 seconds: documented STT limit with word timestamps |
| Audio codecs admitted | mp3, aac, opus, vorbis, pcm_s16le/s24le/s32le/f32le/f64le, alac; actual decoding must succeed |
| Video codecs admitted | h264, hevc, vp8, vp9, av1, mpeg4, prores; actual decoding must succeed |
| SIMPLE | Existing 32 groups / 2000 UTF-8 bytes per group / 12000 input bytes / 8192 output tokens, unchanged |
| TTS | Existing 4096 UTF-16 code units and 32MiB audio bound; one inference, no hidden chunk truncation/retry |

500MiB is the application's existing STT adapter admission bound, not a newly
asserted provider quota. A valid 30-minute upload does not guarantee admission to
the smaller one-call SIMPLE/TTS bounds. Exceeding these fails explicitly; the
implementation does not drop groups, invent output, add paid calls or raise caps.

## Official API/SDK verification (no inference)

Checked official [STT model](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-transcribe),
[transcription contract](https://ai.google.dev/gemini-api/docs/transcribe),
[TTS contract](https://ai.google.dev/gemini-api/docs/speech-generation), and installed
`@google/genai` 2.28.0 declarations/implementation. Configured STT
`gemini-3.5-transcribe`, Translation `gemini-3.5-flash`, TTS
`gemini-3.8-flash-tts` are preserved. STT uses Files upload/poll followed by
`v1beta/interactions`, optional BCP47 hints and verbatim word annotations. AUTO
omits language_codes; source confirmation remains mandatory without trustworthy
primary-language metadata. TTS uses text-only Interactions, audio response_format,
speech_config voice Kore/Fenrir and default complete WAV output. No evidence
supports changing these models merely because an old call returned503.

Account model access/quota and provider availability are NOT_VERIFIED; previously
reported quota remains USER_REPORTED_AVAILABLE, not PROVIDER_VERIFIED.

## Tests and delivery

Isolated tests use the actual Express/Multer routes, Mongoose models and real
Media/STT/source/SIMPLE/approval/quota/Narration/Result services with an in-memory
native collection fixture. Only provider network transports are mocked. Synthetic
media is generated locally; FFmpeg/FFprobe decode, conversion and mux run for real.
No user media or Atlas is used for these tests.

- MP3 and MP4 each complete with exactly one STT/Translation/TTS invocation,
  confirmed source revision, reviewed approval and quota receipt1/1. Audio playback
  returns200; MP4 byte-range playback returns206 and H.264/AAC metadata matches.
  Separate complete scenarios cover MP3 artwork and MP4 without video.
- Real HTTP rejects size excess, MIME/extension mismatch, corrupt media and video
  without audio before provider use. Focused adapter tests cover duration excess,
  codec/container mismatch and decoder rejection. Source hash/other project remain
  unchanged; generated temporary paths are request-owned.
- Actual service/HTTP tests cover503,429,403, SDK timeout and forbidden retry;
  silence/corrupt TTS publishes no READY Narration/Result. Scoped run tests reject
  silence, missing verifier, duplicate/restart/concurrency and uncertain commit.
- Web hook tests cover legacy uncertainty, GET-only recheck, duplicate click,
  confirmation cancellation, no-speech, strict MIME/dynamic size and retaining a
  known project ID without DELETE. Existing AUTO/MANUAL, target/old artifact,
  translation and design synchronization regression tests remain in the subset.
- Mobile code is unchanged. Web remains baseline; Mobile dynamic upload limits,
  AUTO/target workflows and safe STT execution-state UX remain a capability gap.

Final source-main results: **Backend237/237, Web72/72 PASS**. Backend TypeScript,
ESLint and build PASS; Web TypeScript, lint and build PASS (three pre-existing lint
warnings in untouched AudioGuideModal/GroupTranslationWorkspace). Both platform
design checks and4 existing Mobile design/metadata tests PASS; Mobile source was
not changed. `git diff --check` for the delivery files PASS. The actual pipeline
integration scenarios use real synthetic FFmpeg; the unrelated older "real
synthetic" STT test is excluded because it directly trusts stale FFMPEG_PATH
instead of the production resolver, while the new actual-service scenarios
exercise the real resolver/extractor/converter/renderer.

Main verification command (from backend; environment changes are test-process-only):

```powershell
$env:E2E_ACTUAL_SCENARIOS='good,browser-empty-reads,commit-unknown,off,silent-audio,missing-audio-verifier'
$env:GROUP_TRANSLATION_ENABLED='true'
node --import tsx --test --test-concurrency=1 --test-skip-pattern='real synthetic' tests/s33-pipeline.test.ts tests/s33-media-validation.test.ts tests/stt-evidence.test.ts tests/stt-stage-instrumentation.test.ts tests/stt-service-instrumentation.test.ts tests/gemini-stt.test.ts tests/gemini-stt-diagnostics.test.ts tests/source-language.test.ts tests/source-media.test.ts tests/e2e-actual-final.test.ts tests/gemini-tts-safety.test.ts tests/customer-multilang.test.ts tests/target-workflow.test.ts tests/e2e-test-run.test.ts
```

The new ordinary MP3/MP4 integration scenarios explicitly unset
GROUP_TRANSLATION_ENABLED and exercise Customer SIMPLE/approval without it.
Runtime acceptance and speech quality are NOT_VERIFIED. Build warnings about the
existing large Web bundle/static+dynamic projectRepository import are not runtime
success evidence.

## Runtime handoff

User authorized stopping only Backend/watcher after confirming no running job.
No restart, SIMPLE/test-run activation or new manifest is part of source delivery.
Required separately controlled process settings for SIMPLE remain
`CUSTOMER_TRANSLATION_ENABLED=true`,
`CUSTOMER_TRANSLATION_METHOD=GEMINI_SIMPLE_V1`,
`VITE_CUSTOMER_TRANSLATION_ENABLED=true`; thinking DEFAULT, Gemini providers.
Do not weaken read-only/scoped writes, use the old exhausted run or retry the
protected failed project. Loading new code alone does not authorize paid/Atlas E2E.

Stop was performed only after native read-only checks found0 active jobs and0
active project states and confirmed PID14116/parent watcher2820 identities. Both
were stopped; no restart occurred. Post-delivery Atlas reads confirm the exact
protected project/job BSON hashes are unchanged and active jobs remain0. Current
disk config remains Customer translation OFF/GROUPS_V1 default/test-run OFF;
max upload200MiB. No .env or guard activation changed. **CODE_READY;
runtime NEEDS_RESTART/configured controlled activation, not production E2E PASS.**

## Final runtime activation — 2026-11-06

User authorized a controlled restart with the explicit fallback to safe mode if
no new run approval or safe scope exists. Started **PID18732**, no watcher, using
the source/main application under `.agents/runtime/s33-final/safe-server.mjs`.
All20 changed Backend source hashes match the tested S33 delivery. No application
source was changed or237/72 suites rerun for activation.

- Backend8080 health200 / MongoDB connected; Customer Web5173 HTTP200. Served
  Web API base is `http://localhost:8080/api` (default); Vite translation flagtrue.
- Process-only SIMPLE ON / `GEMINI_SIMPLE_V1` / thinking DEFAULT; Gemini model IDs
  retained. No `.env`, secrets, old manifest/journal/allowance changes.
- Original default-deny native read-only preload is installed before model
  import/database connect; autoDDL disabled; external fetch and FFmpeg/FFprobe
  subprocesses blocked in this safe process. Existing narrowly validated
  authsessions login/refresh/logout exception retained; no auth operation invoked
  by Codex. Added local process HTTP gate denies business mutation/upload before
  Multer. Unconnected fake-collection guard probe returns the expected DENY;
  no actual Atlas write was attempted.
- Loopback GET `/__s33/readiness` confirms loaded source, actual200MiB/1800sec
  limits, STT evidence contract/AUTO hint behavior, SIMPLE bounds/model and
  TTS model/120s deadline. It does not authorize inference or assert provider
  access/speech/Result runtime acceptance. FFmpeg/FFprobe9.0.2 verified externally
  with `-version` only; encoding remains blocked in safe runtime.
- Chrome CDP9222 is unavailable. Customer session is UNKNOWN, not EXPIRED; no
  cookie/token inspection, login, logout, refresh or authenticated GET attempted.
- No approval exists for a new run. Scoped run remains OFF/unbound, no allowance
  issued. The existing controlled preload/storage adapter is bound to the original
  fixed53.591655sec/4239951byte MP4/hash; it is not an arbitrary-MP3/MP4 manifest
  adapter. It was not weakened or reactivated.

**BLOCKED_FOR_NEW_RUN**: read-only Backend is running and S33 is loaded, but real
upload/STT/Translation/TTS/Result remain blocked. Required: verify Customer through
accessible CDP, obtain explicit new-run approval, and safely prepare matching
media/owner/project scope (including guard adaptation if allowing another media
type/file). Do not reuse the consumed S32 approval/run. No provider call, project,
upload, old-job retry/reset or business write occurred. Evidence:
`.agents/runtime/s33-final/{safe-runtime.json,activation-evidence.json}`.

## Activate one new manual E2E run — 2026-11-06

**New approval is valid and retained**, independently of the consumed S32 run:
one verified Customer/new project/new user-selected MP3 or MP4, at most200MiB and
1800sec, scoped Atlas/storage, FFmpeg, STT1/Translation1/TTS1, accepted cost risk
above$1, no automatic retry/resume. Codex must not create/upload/dispatch.

Customer verification now **REAL_CUSTOMER_PASS** via existing Chrome CDP9222 tab:
GET `/api/auth/me`200/role CUSTOMER and GET projects200/total31. Used the
application's existing API with auth-refresh retry disabled; no cookie/token
extraction, login/logout/refresh or UI action. Identity is stored locally in
`customer-session.json` for later owner binding, never reported with credentials.

**Activation BLOCKED by current guard implementation, not missing approval:**

1. `src/e2e-preload.ts:19` requires the old exact53.591655sec/4239951byte MP4 hash.
   `prepareActualRun` also fixes duration53.591655. The frozen manifest requires
   final media identity before startup; it has no bounded first-upload identity
   claim for a user-selected MP3/MP4.
2. `E2eActualStorage` fixes `input.mp4`/`video/mp4`. Native project transition
   grants allow TTS `TRANSLATED>GENERATING_AUDIO`, but not audio-only completion
   `GENERATING_AUDIO>COMPLETED`; generic MP3 pipeline success does not prove this
   stricter controlled guard supports Audio Result.
3. Actual native grants/receipt/digest/source confirmation are fixed vi→en and
   manifest Kore. Fenrir, another confirmed source or target are not configurable
   simply by issuing a new run ID.
4. The error handler exempts only scoped missing transcript/translations-en
   GET404. A bound owner/new-project GET media404/MEDIA_NOT_FOUND is not exempt
   and invokes stopE2eOnRequestError, contrary to this run's valid-read policy.
   This is a source-verified condition, not a newly executed live failing request.

No valid new manifest or allowance was issued. No old lock/journal/manifest was
reset/reused, no Backend restart or app-code change, no inference/upload/project
or business write, no suite rerun. PID18732 remains read-only, health200 and
MongoDB connected; SIMPLE ON and Web200. Current safe-server readiness contains
the previous pre-approval reason `NEW_RUN_NOT_APPROVED`; it is a static safe-mode
diagnostic and **does not supersede the new recorded approval**. Actual current
blocker is `SCOPED_GUARD_NEW_MEDIA_CONTRACT_UNSUPPORTED` plus the source/target/
voice/read-state constraints above. Updating that diagnostic does not justify a
restart or activation.

Before activation, the guard needs an exact one-use durable media claim and
corresponding native/storage/receipt/audio/target/voice/read policies with focused
tests. Preserve the existing default DENY and successful S33 application code;
do not substitute a collection-wide exemption. No further approval is required
for the identical scope already granted. This attempt ends BLOCKED; no new run
has started.
