# S33.2 real E2E failure diagnosis and scoped terminal-write fix

2026-11-07, Asia/Bangkok. Run `s33_20261107_751b24c0a4b2018d055d`.
Project `6aee70cce759b234b089a371`, job `6aee71776de3d216e6e62f48`.
Diagnosis verified; code tested locally. Live run remains STOPPED_NO_RETRY.

## Actual evidence (read only)

Source: run-specific stdout/stderr under `.agents/runtime/s33-final/`, inference
and native journals under `backend/.e2e-control/`, current readiness GET and
native Atlas reads of only this project/job/media and artifact counts.

| Bangkok time | Verified event |
| --- | --- |
| 07:31:33 | Project claimed/inserted; upload writer starts |
| 07:31:34 | MP4 identity claimed and media metadata committed |
| 07:31:51 | STT allowance CLAIM_STT; job PROCESSING; project TRANSCRIBING |
| 07:31:52 | FFmpeg extraction lease completed; Gemini file-upload stage entered |
| 07:31:58.686 | Actual transcription transport invocation timestamp |
| 07:32:06.709 | Provider response HTTP200; RESPONSE_RECEIVED, providerAccepted YES |
| 07:32:06.731 | RESPONSE_VALIDATION / FAILED_RESPONSE / STT_INVALID_RESPONSE |
| 07:32:09.634 | Inference journal STOP_STT |
| 07:32:09.726 | First request STOP: S32_E2E_ACTUAL_WRITE_DENIED |
| 07:33:57 | Later rejected mutation; first request STOP unchanged |

Provider diagnostic `TIMESTAMP_INTERVAL_INVALID`, zero-based wordIndex51:
start and end both `13.300s`, EQUAL, NO_COLLAPSE. This is not the historical503
failure. Response was received and invalidated locally; provider acceptance and
one STT dispatch are proven, not uncertain. No request/operation ID is present
in the captured evidence; do not infer one. Full provider response was not saved,
so adjacent word offsets cannot be reconstructed. Do not fabricate timings or
discard words to force success.

Stored media is VIDEO/video/mp4, 4,239,951bytes,53.591655sec; disk bytes match
metadata and journal hash
`8e37f21fce16be8bf735b7efe22296309582f6cc7529a4aa5aae0d46f86dd1d3`.
It exists as a regular file inside the exact run/project namespace. Original MP4
and extracted WAV remain; no transcript/translation/narration/Result exists.
The second attempted3.3MB/28.21sec file is not the file claimed by this run.

## Root causes

1. STT response validation could not represent the zero-length timestamp within
   the existing positive-duration segment contract. Touching point words already
   merge without invented duration; isolated/unmergeable points remain rejected.
2. `ActualE2eRuntime.validateChange` allowed only STT success transitions and
   job PROCESSING->COMPLETED/SUCCEEDED evidence. The actual service catch tried
   job/project FAILED updates. The native guard denied those terminal writes,
   masking STT_INVALID_RESPONSE with a plain Error. Existing error middleware
   maps that plain Error to HTTP500/INTERNAL_SERVER_ERROR. This HTTP500 is
   established by the logged stack plus handler path, not a retained browser
   Network capture. Gemini itself returned200.
3. Job is still PROCESSING, project TRANSCRIBING/PENDING_DETECTION and evidence
   was not persisted because those writes were denied. These stale DB states
   do not prove current provider work or authorize another dispatch.
4. New-project/upload request is legitimately blocked after one project/file
   claim and run STOP. Error message previously collapsed multiple guard states.
   Translation/TTS dispatches0; translation attempt/quota receipts0. No claim is
   made about provider billing from application receipt absence.

Readiness: PID18044, guard STOPPED, manual STOPPED_NO_RETRY, armedfalse,
projectClaimedtrue/mediaClaimedtrue, dispatches STT1/Translation0/TTS0.
Immutable first request reason has methodPOST/routeOTHER/status0/code
S32_E2E_ACTUAL_WRITE_DENIED; status0 is missing internal request metadata,
not an HTTP response status. STT validation failure precedes this request STOP.

## Fix applied to main source (not loaded into current process)

- `services/e2e-test-run.ts`: internal actual-inference failure observer, preserving
  original exception; structured blocked message includes first fixed stop code.
  GET/HEAD/OPTIONS still do not stop/consume; no retry or new allowance.
- `services/e2e-actual-runtime.ts`: attests a real Gemini STT failure in the current
  exact writer lease. Only permits native updateOne of the same owned new job and
  project to FAILED with identical captured evidence/code and unchanged fields.
  Job failure must precede project failure; exact CAS and one-use grants retained.
  No writes to old project/job, inserts, artifacts, arbitrary evidence or broad
  collection permissions. Run stops after terminal recording; production OFF
  behavior and other inference-stage policies retained. First STOP uses AppError
  code/status, so the primary STT failure is preserved in future journals.
- `services/stt/gemini-stt.provider.ts`: final exception evidence includes cleanup
  outcome, matching the callback and attestation without replacing original error.
  Timestamp validation intentionally unchanged.
- `services/transcription.service.ts`: explicit Vietnamese invalid-response/timing
  message, existing no-retry advice and FAILED versus UNCERTAIN semantics retained.
- `middleware/error-handler.middleware.ts`: exact fixed scoped native errors map
  to structured409 and a stop/no-retry message instead of generic500; arbitrary
  error contents/paths are not exposed.
- `tests/helpers/s33-manual-guard-scenario.ts`, `tests/s332-stt-failure.test.ts`,
  `tests/s332-errors.test.ts`: actual HTTP/native/service path with mocked provider,
  memory-only database and isolated synthetic media. No real user upload/inference.

## Verification and next action

28 focused checks PASS: invalid response/failure persistence, cleanup failure,
post-dispatch503 UNCERTAIN, forged terminal write rejection, happy-path MP4
regression, first-stop/GET behavior, safe before/after-dispatch evidence,
structured409/502, isolated13.300s point rejection. Backend TypeScript/lint/build
PASS. No full monorepo/superseded237+72 suites rerun.

Backend18044 has no watcher and was not restarted. Current memory runs the old
guard; this source-only fix does not repair any existing DB document. No manifest,
journal, allowance or arm file was reset/replaced; no new run was issued.

Do not retry/upload/create a second project or restart to resume. A separately
approved recovery must distinguish loading new code from repairing this stale
job/project, and must separately authorize any data repair or new paid run.
Before another paid attempt, resolve an explicit timestamp-representation policy
with fixtures; current evidence alone does not justify fabricated durations or
guarantee that another provider response will pass. Preserve current media/logs
and consumed allowance for diagnosis. No Atlas writes/provider calls by Codex.
