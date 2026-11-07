# S32.6B.1 PREP — E2E media preparation

> **FINAL READY update, 2026-11-06:** see [CONTROL section11](s32-6b1-control.md#11-final-ready--one-time-manual-web-preparation-2026-11-06). Actual Customer GET401 TOKEN_EXPIRED; FFmpeg/FFprobe9.0.2 + required codecs available; narrow expected-empty-GET fix14tests/typecheck/lint/build PASS. Provider quota UNKNOWN, runtime/scoped-write/paid activation unapproved. **BLOCKED/NO-GO; EXECUTE NOT_STARTED.** Earlier snapshots below are historical.

> **Latest: S32.6B.1 READY check, 2026-11-05 — BLOCKED / NO-GO.** See section10 for current evidence and execution proposal. Sections1–9 preserve the PREP snapshot; section10 supersedes their media/retry/runtime observations. EXECUTE remains NOT_STARTED.

Checked 2026-11-05 (Asia/Bangkok). **PREP: BLOCKED; recommendation: NO-GO. EXECUTE: NOT_STARTED.**
This document grants no execution, paid-call, guard-change or Atlas-write permission.
VERIFIED = observed runtime/read or inspected code; ESTIMATED = explicit scenario; UNKNOWN = insufficient evidence.

**FIX follow-up (2026-11-05):** the findings below are the PREP snapshot. The resolver and TTS code defects have since been addressed and mock-tested; see [s32-6b1-fix.md](s32-6b1-fix.md). No environment setting was changed and no real conversion/provider run was performed. NO-GO remains.

## 1. Media — MEDIA_REQUIRED

No separate, rights-confirmed test media was found in the workspace media inventory (excluding dependencies, build output and local agent artifacts). Six existing project media/artifact files were found; none was selected for execution.

Read-only inventory of the existing source below, **not an approved candidate**:

| Field | Observation |
| --- | --- |
| Path | `backend/uploads/projects/6aea02a2dffc2cd1c7c17164/cd778e93-1cfc-47cb-99c2-11f06da55449.mp4` |
| Container / size | MP4 family / 2,616,768 bytes |
| Duration | 59.187664 seconds |
| Video / audio | H.264 / AAC |
| Audio sample rate / channels | 44,100 Hz / 2 |
| Technical limits | Below default 200 MiB upload and 3,600-second STT limits |
| Suitability | Not 15–30 seconds; rights, speech clarity, speakers and sensitivity UNKNOWN; not selected |

Metadata came from direct `ffprobe` on PATH; no conversion/output file or provider call occurred. Metadata does not prove spoken language or permission.

Required input: user-owned/authorized MP4, preferably H.264 + AAC, 15–30 seconds, one clear Vietnamese speaker, low noise, no sensitive material, preferably under 10 MiB. A video is preferable because this plan specifically includes an MP4 Result. Obtain explicit usage permission; record SHA-256 and metadata before any future upload. No download or recording was performed.

## 2. Runtime and configuration

Configuration classifications refer to this check, not previous acceptance snapshots. `.env` was parsed without displaying sensitive values; it was not edited.

| Item | Status | Evidence / limitation |
| --- | --- | --- |
| Backend :8080 | CONFIGURED | GET `/api/health`: 200, database `connected` |
| Customer Web :5173 | CONFIGURED | HTTP 200 |
| MongoDB | CONFIGURED | Native read connected to `multilingual_ai_narration`; no DDL/model initialization |
| Customer session | CONFIGURED | Existing Chrome CDP session GET `/auth/me`: CUSTOMER; no refresh/login/logout |
| Gemini credential | CONFIGURED | Nonempty only; provider account validity/access UNKNOWN, no provider API called |
| STT / translation / TTS provider | CONFIGURED | `.env`: gemini for all three |
| STT model | CONFIGURED | `gemini-3.5-transcribe`, adapter matches configured model |
| Translation model | CONFIGURED | `.env` primary `gemini-3.5-flash`; actual model dispatch not exercised |
| TTS model | CONFIGURED | Adapter constant `gemini-3.8-flash-tts` |
| Customer SIMPLE runtime | INVALID | Live preflight reports method GROUPS_V1, customerEnabled=false, thinkingDefault=true |
| en Kore | CONFIGURED | Real Customer GET `/voices?language=en` includes Gemini Kore |
| Local storage | CONFIGURED | Default uploads root; existing source readable. Free space/write capability not exercised |
| FFmpeg / FFprobe on PATH | CONFIGURED | Both `9.0.2-full_build-www.gyan.dev`, version commands successful |
| Backend FFmpeg / FFprobe configured paths | INVALID | Both configured executables absent; adapter gives explicit env paths priority over PATH |
| STT / SIMPLE timeout-retry policy | CONFIGURED | Static policies below; no live provider check |
| TTS finite deadline / explicit no-retry | MISSING | Adapter omits explicit SDK deadline/retry override; conversion spawn has no timer |
| Worker | UNKNOWN | Server entry only connects DB and listens; no worker started here. External/other-process worker absence not proved |
| Read-only guard | UNKNOWN | Existing local preload policy inspected, no modifications; health/preflight do not attest current process preload. No write probe was attempted |

Live GET simple-preflight for an existing completed English project returned BLOCKED:
`QUOTA_NOT_VERIFIED`, `DEPLOYMENT_NOT_VERIFIED`, `INVALID_PROJECT_STATE`.
Its runtime is GROUPS_V1 and Customer translation OFF. This is an old-project observation, not preflight for a new E2E project and not evidence that S32.4 SIMPLE support failed. No attempt was made to bypass the state gate.

## 3. Limits and quota

| Concern | VERIFIED code/config | Actual available capacity |
| --- | --- | --- |
| Project count | No numeric account project cap identified in create service | UNKNOWN; not a guarantee of unlimited capacity |
| Upload | One file, default 200 MiB; MIME allowlist in upload middleware | Candidate missing |
| STT | Nonempty, <=500 MiB, audio stream, duration >0 and <=3,600 sec | Provider RPM/TPM/billing quota UNKNOWN |
| SIMPLE source | Bounded source 2 MiB / 20,000 segments | Candidate transcript unavailable |
| SIMPLE input | <=32 groups, <=2,000 UTF-8 bytes/group, <=12,000 bytes complete input JSON | Candidate groups unavailable; CJK measured as UTF-8 bytes |
| SIMPLE output | maxOutputTokens 8,192; response envelope and draft ceiling 128 KiB | Actual output/thinking usage UNKNOWN |
| Translation app quota | Default Customer20/global200 per UTC day; env overrides absent on disk | Native read below; live API quota NOT VERIFIED |
| TTS | Text <=4,096 JS UTF-16 code units, one synthesis of translation.fullText | Provider quota UNKNOWN; do not equate characters with tokens |
| Concurrency | Durable project target-operation CAS, active-job checks; one target operation/project | Snapshot: 0 jobs in PENDING/QUEUED/PROCESSING/UNCERTAIN; does not prove no retained lock/attempt or external writer |
| Global concurrency | GroupAdmission exists for explicitly configured test/controlled contexts | No verified global production numeric cap for this E2E path |
| Rate limits | No numeric media/translation/TTS route rate limiter established in inspected app path | Provider rate limits UNKNOWN; application quota is separate |

Native read of the owner's and global UTC `2026-11-05` quota receipt IDs found no documents. Code defines absent receipts as consumed=0; with disk defaults that implies **20/20 and 200/200 at that observation**, not a reservation, not verification of the running process policy, and not Gemini quota. Live preflight returned before quota evidence. Recheck the actual eligible project/runtime and provider dashboard before EXECUTE; do not assume sufficient provider capacity.

Quota reservation is transactional in `translationattempts` at the first external dispatch boundary (including model metadata). It is not simply charged only after successful translation. Failure/uncertainty must not trigger a fresh generation or presumed refund. PREP used only reads; no claim/reservation/refund was invoked.

## 4. Intended pipeline and provider calls

The following is the **conditional SIMPLE path after approved configuration and safety readiness**, not the current disabled runtime. AUTO STT does not force language_codes; missing trustworthy language metadata leads to NEEDS_CONFIRMATION. Confirm vi using the actual transcript revision before translating en. No extra detection AI call is required.

| Step | Model | Normal inference requests | Auxiliary calls / reuse |
| --- | --- | --- | --- |
| STT AUTO | gemini-3.5-transcribe | 1 interactions.create | models.get; files.upload; files.get polls while PROCESSING; best-effort files.delete |
| Confirm source vi | None | 0 | Atlas write in future, no AI |
| Generate SIMPLE en | Selected primary gemini-3.5-flash on disk | 1 generateContent | 1 models.get; entire admitted group array in one request, not per group |
| Review / approve | None | 0 | Durable draft reused; approval persists translation |
| Gemini TTS Kore | gemini-3.8-flash-tts | 1 interactions.create | Full translation in one request, not per segment; local audio conversion |
| Result | None | 0 | Local FFmpeg compose/probe, future Atlas/filesystem writes |

Normal: **3 inference calls**, plus 4 logical auxiliary operations and P file-status polls: **7+P logical operations**. Resumable upload can use multiple wire HTTP requests; this is not a seven-HTTP-request guarantee. SDK request accounting/poll timing must be observed later without logging credentials or media content.

STT explicitly sets retry attempts1 and interactions maxRetries0; SIMPLE uses attempts1 plus a one-dispatch transport fence and no error-triggered model fallback. TTS uses no override: the installed SDK CreateInteraction defaults to maxRetries4, retryable408/409/429/5xx and connection errors, backoff500ms..8s/maxElapsedTime30s. Thus a single TTS invocation can make **up to 5 transport attempts**. This is SDK retry, despite no application retry loop. Provider execution/billing after ambiguous failures is UNKNOWN.

Conditional worst-case inference transport count: **1 STT + 1 translation + 5 TTS = 7**; approximately **11+P logical operations** before upload protocol details. This is a single user invocation with no manual retries; it is not a strict total HTTP or cost bound. STT polling shares a120-second abort budget, with1-second waits, but exact poll count depends on latency. TTS has no finite configured end-to-end deadline, so worst elapsed time is not bounded by the backoff window.

Dedup: durable translation key includes owner/project/target/source digest and model/input binding; persisted draft/approval must be reused. Narration checks existing translation/voice/speed and revision/provenance; Result checks existing narration identity/provenance. No cache/dedup promises exactly-once provider billing after transport ambiguity. On timeout/UNCERTAIN stop, read status, retain fences as implemented, seek operator decision; never reset/retry automatically.

## 5. Cost — ESTIMATED components, total UNKNOWN

Official pricing read on2026-11-05: [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing). No provider API used. Standard paid rates only; free tier/account eligibility not assumed. Rates can change; confirm immediately before approval.

| Step/model | Unit/rate USD | Input/output scenario | Normal estimate | Worst-case estimate / certainty |
| --- | --- | --- | --- | --- |
| STT gemini-3.5-transcribe | $2/M audio input tokens; $12/M text output tokens; published blended approximation $0.005/min | Proposed15–30 sec, actual tokens unavailable | Approx $0.00125–0.0025 using published minute approximation | One dispatch; actual output/charges UNKNOWN; estimate only |
| SIMPLE gemini-3.5-flash | $1.50/M input; $9/M output including thinking | Input I/output O tokens UNKNOWN | `(1.50*I + 9*O)/1e6` | One fenced generation;8,192 configured output-token cap is not a measured token usage; total UNKNOWN |
| TTS gemini-3.8-flash-tts | $0.50/M input; $9/M audio output through2026-12-31 | Text T tokens UNKNOWN; hypothetical English audio15–30 sec | Published audio equivalent $0.00225/10sec => $0.003375–0.00675 audio plus `0.50*T/1e6` | Up to5 transport attempts: conservatively5 times single-call scenario if each billed; actual output duration/ambiguity UNKNOWN |
| Metadata/upload/polls/delete, Atlas/storage, local CPU | Not inference-token estimates | Transfer, retention and account services depend on deployment | UNKNOWN; local processing makes no Gemini inference call | Do not assume auxiliary/storage costs or API quotas are zero |

The15–30-second English audio duration is a scenario, not guaranteed by Vietnamese source duration. No token count is invented from characters or UTF-8 bytes. **Normal and worst-case total: UNKNOWN**, because no approved media/text, actual token usage, account limits or enforceable TTS deadline/cost ceiling exists.

Proposed approval budget: **at most US$1 for one isolated run**, conditional on verified account budget enforcement and retry policy; not an approval and not presently a hard code-enforced cap. Before execution approve either a finite no-retry/deadline solution or a proven externally enforced ceiling. Later record sanitized usage counts/durations and billing totals only; no paid countTokens request in PREP.

## 6. Future writes and isolation map — none executed

| Stage | Collections potentially written | Files/provider state potentially written |
| --- | --- | --- |
| Create new test project | projects, activitylogs | None required yet |
| Upload once | media, projects, activitylogs | `uploads/projects/<newId>/<uuid>.<ext>`; upload replacement may delete old media, so never reuse an old project |
| STT | projects, processingjobs, transcripts, transcriptsegments, activitylogs | Temporary extracted WAV for video; remote Gemini file upload/delete |
| Confirm source | projects, transcripts (revision/fences) | No artifact rewrite |
| SIMPLE generate/review | projects targetOperation, translationattempts claim/quota/durable draft | Provider inference; local draft state where applicable |
| Approve translation | translations, projects, translationattempts approval state and transcript revision fence; activitylogs if emitted by path | No TTS/artifact generation |
| TTS | projects, processingjobs, narrations, transcript/translation revision fences, activitylogs | `uploads/projects/<newId>/narrations/narration-en-<uuid>.mp3`, temporary file/atomic rename |
| Result | projects, processingjobs, results, transcript/translation/narration fences, activitylogs | `uploads/projects/<newId>/results/result-<uuid>.mp4` and temporary output |

The set includes transactional fence writes to upstream records even when their content does not change. Session login/refresh/logout may separately touch authsessions under its approved narrow exception; PREP did not initiate these operations. No index/collection creation is part of the proposal.

Use a **new project explicitly approved for this run**, owner=current Customer, AUTO, confirmedvi, targeten, Kore, actual revisions recorded. Capture IDs/paths/checksums before/after, sanitized metadata and status transitions; do not reuse old en artifacts as proof. Preserve existing projects and the verified S32.5B catalog backup. That catalog backup is not a complete business-data/media backup.

Recovery proposal: stop at the first failed/uncertain paid step; record job/attempt/fence IDs without resetting them. Read-only diagnosis first. Prepare a manifest of exactly the new project's documents/files and any receipt/shared-state effects. Back up that scope and referenced records/files before approved cleanup. Do not decrement shared quota receipts, clear fences or delete referenced data automatically. A future scoped cleanup/rollback needs separate authorization; no blanket deleteMany, project replacement, artifact overwrite or automatic rollback.

## 7. Guards and timeout assessment

- Owner authorization, confirmed source and source!=target are required; only en for this run. Confirmation uses expectedRevision and refuses dependent artifact/attempt/job conflicts.
- Translation binds target/revision/digest/model and checks coverage; approval is transactional. Existing target translations are not overwritten. Project target-operation CAS and active-job checks must remain enabled.
- STT failure preserves failure/no-speech reporting; never fabricate sourcevi or completion. AUTO with no trustworthy metadata requires manual confirmation.
- STT network budget120s; extraction exec timeout120s. SIMPLE metadata+generation share120s; no automatic fallback/retry. Result media processor default300s with kill-on-timeout.
- TTS SDK request and its conversion spawn lack a finite configured deadline. Installed SDK can retry paid synthesis. TTS_TIMEOUT/translation uncertainty may retain the durable project fence with no automatic TTL takeover.
- **Verified TTS integrity defect:** `gemini-tts.provider.ts` catches conversion failure with `.catch(() => wavBuffer)` then reports `format:'mp3', mimeType:'audio/mpeg'`. Narration's contract checks can accept the mislabeled nonempty WAV. This can create an invalid declared MP3 and misleading completed audio job. Reported before any fix; no app code changed in PREP.
- A video project is not complete merely because STT/translation/TTS progress is100. It needs valid Result completion. An audio project has different terminal semantics; do not assert MP4 acceptance for audio-only input.
- Current preload file denies business Mongo writes/DDL, nonlocal fetch and media subprocesses with narrow authsessions exceptions. Its presence/past evidence does not establish current process activation; verify startup attestation without write probes before any later stage. Do not weaken it in PREP.

## 8. Risk register and GO gate

| Priority | Risk / observed condition | Required resolution before EXECUTE |
| --- | --- | --- |
| P1 | MEDIA_REQUIRED, no rights-confirmed short candidate | Supply authorized Vietnamese15–30s video, metadata/hash and consent |
| P1 | Explicit media executable paths absent despite working PATH | Separately approve correction; restart and verify exact effective paths without processing |
| P1 | Customer SIMPLE off / GROUPS_V1 | Separately approve scoped configuration restoration; verify runtime SIMPLE, en and DEFAULT thinking |
| P1 | TTS WAV-as-MP3 fallback; unbounded deadline/SDK retries | Separate code-change approval and targeted mocked tests before paid run |
| P1 | Provider quota/access/cost cap UNKNOWN | User verifies account model access, quotas, billing ceiling; agrees one-run budget and stop policy |
| P1 | Guard active state and controlled-write policy not proven | Establish process attestation and approve a separate tightly scoped execution policy; no global guard disable |
| P2 | No new-project lock/attempt snapshot possible yet | Recheck exact new project/target at execution; zero active jobs now is not sufficient |
| P2 | Storage free space, rollback scope, external workers UNKNOWN | Verify capacity, backup plan and writer coordination before any approved run |

**NO-GO. PREP BLOCKED; EXECUTE NOT_STARTED.** Existing Customer GET access and runtime health are verified; they do not establish readiness for paid/data-generating acceptance.

Before EXECUTE, obtain explicit approval for the exact media, one new Customer project, listed collection/file writes (including fences/quota/activity logs), one STT/translation/TTS invocation under a verified bounded retry/budget policy, local media processing, scoped runtime/guard configuration and a separate cleanup plan. Configuration/code fixes require their own scope; none was performed here. GO would still be a recommendation, never implicit execution permission.

## 9. Checks and changed files

Performed: focused source/installed-SDK inspection; safe env presence/public config checks; localhost health/Web GET; existing Customer CDP GET auth/me, simple-preflight and en voices with auth refresh disabled; native Atlas find/count reads; FFmpeg/FFprobe version and one read-only metadata probe; official pricing documentation search.

No browser mutation request, token/cookie extraction, provider API, business write, upload, processing job, encoding, worker startup, seed/migration, .env/source/Mobile/logs change, commit/push. No app build/test rerun for documentation-only PREP.

Created this document; updated local skill PROGRESS.md/CHANGELOG.md. Existing unrelated working-tree changes preserved. Local skill files remain ignored under existing .gitignore.

## 10. S32.6B.1 READY — final read-only check

### 10.1 Media: technical READY, content verification pending

User explicitly confirmed `test-media/museum-vi-20s.mp4` is the intended media and they have usage rights. It is not taken from an old project. Only ffprobe/read/hash were performed.

| Property | VERIFIED value |
| --- | --- |
| Actual duration | **53.591655 seconds**, not20 seconds implied by filename |
| Size | 4,239,951 bytes |
| Container / codecs | MP4-family / H.264 video + AAC audio |
| Sample rate / channels | 44,100Hz / stereo2 |
| SHA-256 | `8e37f21fce16be8bf735b7efe22296309582f6cc7529a4aa5aae0d46f86dd1d3` |
| Upload/STT compatibility | Below200MiB upload,500MiB STT and3,600sec STT limits; audio stream exists |

Media is present/authorized and technically compatible. It exceeds the preferred15–30sec range. No trimming/conversion/upload occurred. Vietnamese speech, noise, speaker count and sensitive-content absence are **not established by metadata**; user must preview/confirm before execution. Use actual53.59sec for budgeting, not filename. Approve use of this longer file or supply a shorter authorized file; do not silently substitute.

### 10.2 Runtime: BLOCKED; no configuration applied

Current health: Backend8080 HTTP200/database connected; Customer Web5173 HTTP200.

| Flag | Disk observation | Required proposal |
| --- | --- | --- |
| Backend CUSTOMER_TRANSLATION_ENABLED | UNSET | true |
| Backend CUSTOMER_TRANSLATION_METHOD | UNSET | GEMINI_SIMPLE_V1 |
| Web VITE_CUSTOMER_TRANSLATION_ENABLED | true | true; no additional change if effective runtime agrees |
| TRANSLATION_PROVIDER | gemini | retain |
| CUSTOMER_TRANSLATION_THINKING | UNSET (code DEFAULT) | retain DEFAULT |

The previous verified live preflight was GROUPS_V1/OFF. Current authenticated GET `/auth/me` returned **401 TOKEN_EXPIRED**, so no new authenticated preflight was attempted and no refresh/login was invoked. Do not label current live flags verified solely from disk. User must manually restore the Customer session safely; never send credentials/tokens to the agent.

Source reads exact string `true` for Backend flag; method is selected from process.env. Web reads Vite build/dev environment. Backend needs restart after approved env change; Vite needs restart/rebuild only if its loaded flag differs or env changes. Restart must retain the guard; no restart/config change was performed here.

Flags are **process-wide**, not project-scoped. They can affect existing Customer generate/review/approve dispatch paths, although setting flags itself does not rewrite artifacts. No built-in test-project allowlist was established. Frontend flag changes workspace selection. Safe proposal: separately approved isolated Backend/Web process plus an exact-owner/new-project operation guard and coordinated other writers. Global enablement alone cannot promise isolation. Existing data/model binding/locks must not be bypassed to switch methods on old attempts.

### 10.3 Quota, conflicts and limits

- Native majority reads of the known owner's and global2026-11-05 UTC quota receipt IDs found no documents. Per existing code absent receipt means consumed0. Disk limits are defaults20/customer/day and200/global/day: **read-only receipt snapshot VERIFIED, inferred20/20 and200/200 under disk policy**. No reservation/claim/refund occurred. Running process effective policy and eligible-project preflight remain UNKNOWN because session expired/no test project exists.
- Gemini account/model rate limits, billing tier, actual remaining provider quota and spending enforcement: **UNKNOWN**. No provider API/dashboard access was used. User must verify model-specific RPM/TPM/RPD and spend caps in their provider account without sharing keys.
- Snapshot: active QUEUED/PROCESSING jobs0; failed TTS_TIMEOUT/TTS_UNCERTAIN jobs0; retained project targetOperation locks0. Translation attempts: **8 UNCERTAIN at GENERATION_DISPATCHING and1 CLAIMED without phase**, all older than3min. These are not9 running jobs; the legacy CLAIMED outcome is not proven. Keep all unchanged. Durable conflict checks are project/owner/target scoped; a genuinely new project should have no matching attempts, but execution must prove that exact scope. Old attempts are not evidence for permitting retry or clearing locks.
- Customer generation limits: at most2 active requests per process and1 per Customer (`customerActive`), plus durable project target CAS and active-job checks. This is not a deployment-wide numeric limit.
- Retain existing upload/STT/SIMPLE limits: one file,200MiB upload; STT500MiB/3,600sec; source2MiB/20,000segments; SIMPLE32groups/2,000UTF-8 bytes per group/12,000input bytes; output8,192tokens/128KiB; TTS4,096UTF-16 code units/32MiB output/deadline120sec. STT/translation dispatch120sec; Result processor300sec default. No limit increased.
- Exact transcript segments/groups/source language/coverage and TTS text length **cannot be preflighted from media metadata**. The real SIMPLE preflight is only meaningful after approved project upload/STT/source confirmation. No fake transcript or reservation is proposed to obtain READY early.

### 10.4 Cost and request envelope (ESTIMATED / UNKNOWN)

Use the official Standard paid rates already verified in section5: [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing). They are a dated pricing snapshot, not an account quote. No repeat pricing audit/provider call was needed. FIX supersedes the earlier TTS SDK retry scenario: retries are now explicitly disabled.

| Stage | Actual input / unknown output | Normal cost USD | Worst single-run cost |
| --- | --- | --- | --- |
| STT gemini-3.5-transcribe | Actual audio53.591655sec; words/tokens unknown | Published blended $0.005/min approximation: **$0.004466** | One dispatch; token/output-dependent actual bill UNKNOWN |
| Translation primary gemini-3.5-flash on disk | I input/O output including thinking tokens UNKNOWN; group/segment counts unknown until STT | `(1.50*I + 9*O)/1e6` | 8,192 configured output tokens correspond to $0.073728 at that rate, plus unknown input; not a full pipeline cap |
| Gemini TTS gemini-3.8-flash-tts | T input tokens and English audio duration Dsec UNKNOWN | `0.50*T/1e6 + 0.000225*D`; if D exactly53.591655sec, audio-only illustration **$0.012058** | One dispatch; input/output duration and account billing UNKNOWN; example duration is not prediction |
| Local compose/Atlas/storage/transfer | Deployment/storage costs unknown | UNKNOWN; no extra Gemini inference | UNKNOWN |

**Normal total UNKNOWN; worst-case total UNKNOWN.** Source duration does not guarantee English duration. No token/group/segment count was invented. Three inference dispatches normally and at most three for the planned one-run/no-retry path: STT1, SIMPLE1, TTS1. File upload protocol, status polls, metadata and cleanup mean total HTTP requests are not3. Normal logical operations7+P (STT model/upload/delete, translation model,3inference plusP polls). Raw transport request ceiling is not proven because resumable upload and variable polls remain. No regeneration on model failure or a late response.

Proposal requiring separate approval: **one new project, one upload, max3 inference dispatches total, US$1 overall budget**, serial execution only. A local USD estimate is not enforceable billing protection; establish provider-side/account enforcement or another verified finite cap first. If no hard ceiling can be verified, retain NO-GO. Never spend money merely to measure expected cost.

### 10.5 Proposed exact guard permissions — NOT IMPLEMENTED

Keep the existing read-only guard unchanged now. Current preload only permits narrow authsessions lifecycle and denies business writes, external fetch and FFmpeg/FFprobe spawning. Its active-process attestation remains missing. This is an operation inventory for a separately reviewed execution guard, **not permission to allow whole collections**.

| Collection | Necessary future native operations | Mandatory scope |
| --- | --- | --- |
| projects | insertOne; findOneAndUpdate/updateOne including targetOperation claim/release/status | Preallocated single new project ID, exact Customer owner; updates/fences limited to that ID |
| media | findOneAndUpdate upsert | Exact new project, first upload only; no replacement/delete |
| processingjobs | insertOne/updateOne | Only newly captured STT/TTS/VIDEO_PROCESSING job IDs for that project; exact target/source identity where present |
| transcripts | insertOne/findOneAndUpdate/updateOne | New project's transcript only; expectedRevision/CAS and provenance fence retained |
| transcriptsegments | insertMany; deleteMany on exact transcriptId | Insert only new transcript rows. Service calls deleteMany during persistence; allow only with independently proven first-run/new transcript ID and zero pre-existing segments. Otherwise STOP; never blanket deletion |
| translations | insertOne/updateOne | New transcript/project, targeten, actual revision; insert approval record and later revision-fence writes only |
| narrations | insertOne/updateOne | Exact newly generated narration, en/Kore/current translation; fence write for Result |
| results | insertOne | Exact new project/narration, current revisions, en |
| translationattempts | insertOne/updateOne (including transactional quota upserts) | Single derived attempt ID for owner/new project/en/source binding. Quota exception ONLY exact owner-day/global-day IDs, one incremental receipt charge with limits/session/phase; these shared rows cannot be scoped by projectId alone |
| activitylogs | insertOne | Existing service-generated activity for the new project/media/narration only; preserve actor/entity semantics |

Mongoose create-array/insertMany may translate to native insertOne/insertMany; inspect captured operation shapes in isolated mocks before enabling a guard. No generic bulkWrite/updateMany/deleteOne/deleteMany, index/collection creation, command/DDL or arbitrary transaction writes should be enabled. Mongo transaction start/commit/abort remain necessary without granting arbitrary Db.command write access. Authsessions retain only the existing narrow exception; no session-wide or user-wide write permission.

Filesystem scope: exact new-project upload/narrations/results directory plus its temporary files, and exact STT temporary directory. Subprocess permission only verified FFmpeg/FFprobe executables/argument shapes, no shell/arbitrary spawn. External network scope must cover only the verified SDK Gemini inference/model/file upload-poll-delete endpoints; resumable upload hosts must be established safely rather than wildcard-allowing the Internet. No guard/network permission was changed here.

### 10.6 Execute policy proposal — none of these steps executed

1. User confirms Vietnamese speech/privacy and accepts53.59sec file (or supplies shorter media); recheck hash/ffprobe and permissions.
2. Verify approved config, guarded startup identity, account quota/budget, storage/free space and writer coordination. Before a project exists this is infrastructure preflight only; do not claim project-level SIMPLE READY.
3. Create exactly one new test project owned by current Customer, sourceModeAUTO with no invented sourceLanguage. Record new ID; never reuse an old project.
4. Upload the approved hash once. Verify media metadata/readback; no replacement.
5. Dispatch STT AUTO once. Validate transcript/timestamps/no-speech handling; record actual segment count/revision. On no speech/failure stop.
6. User reviews transcript and confirms vi with actual expectedRevision once. If speech is not vi, stop for scope decision; never force vi. Revision conflict stops, no automatic retry.
7. GET SIMPLE preflight for this exact project/en; require current transcript, coverage/limits/quota/deployment/conflicts READY. Only then generate en once and read saved draft; do not generate if unknown/blocked.
8. User reviews meaning/names/numbers and approves exact en draft once with actual binding. No second generation to repair poor quality under this approval.
9. Select active en Gemini Kore, validate text limit/current provenance and dispatch TTS once. Timeout/UNCERTAIN retains fence; only read status, never resubmit.
10. Create one MP4 Result from the exact new narration/current revision. No automatic encode retry.
11. Read artifact metadata/file and ffprobe; verify MIME/bytes, codecs/duration, targeten/revisions and audibility/content via user review. Do not create listen analytics or publish artifacts.
12. Stop/report IDs/statuses/sanitized usage. No automatic cleanup, rollback, lock reset or further language.

Mutation envelope: max8 intentional workflow requests (create/upload/STT/confirm/generate/approve/TTS/Result), each once; review/status/preflight are GET. Transport uncertainty does not authorize reissuing a mutation even if idempotency exists. SDK file protocol auxiliary calls are additional and not bounded by the8request count. GET observation should be serial and time-bounded, with no automatic auth refresh under this preparation authority.

Duplicate controls: single operator, serial steps, captured project/hash/attempt/draft/artifact IDs, existing target/owner/revision binding and CAS/unique guards retained. Stop on timeout/UNCERTAIN, 401,429, stale revision, quota/budget uncertainty, duplicate artifact, unexpected collection/path or another target request. Never retry/reset old attempts, decrement quota receipts or overwrite artifacts.

Manual actions required: safely restore Customer session, verify provider quota/budget, content/rights/duration acceptance, source confirmation, translation review/approval and listening/artifact quality. Any later writes/paid calls and narrowly scoped guard/runtime changes require explicit authorization beyond READY.

### 10.7 Final decision

| Item | Result |
| --- | --- |
| Media | READY for authorized metadata; speech/privacy review pending; duration exception noted |
| Runtime | BLOCKED: Backend flags unset; current Customer session expired; guard process not attested |
| Quota | App receipt snapshot VERIFIED conditionally; effective preflight/provider quota UNKNOWN |
| Cost | Partial estimates above; normal/worst total UNKNOWN; proposed US$1 not approved/enforced |
| Execute policy | Drafted only; collection/network/subprocess allowlist not implemented or enabled |
| Decision | **NO-GO; READY check BLOCKED; EXECUTE NOT_STARTED** |

Approvals still needed: exact longer-media/content acceptance; backend flag/restart scope; verified provider quota/cost enforcement and one-run budget; exact new-project/collection/shared-quota/filesystem/network/media-process policy; paid3dispatch scope; separate recovery/cleanup if later needed. No approval is inferred from this plan or from earlier mock PASS.

Changed only this preparation document and local skill PROGRESS/CHANGELOG. No test/build repeat for documentation-only READY, no env/guard/application/Mobile/logs edits, no provider call/Atlas write/upload/encoding/commit/push.
