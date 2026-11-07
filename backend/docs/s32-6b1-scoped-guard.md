# S32.6B.1 SCOPED GUARD

> **First manual upload failure:** CONTROL section11 records actual STOPPED_BEFORE_PROJECT_CLAIM (haltedtrue/singletonfalse), no project/file/dispatch/nativegrant. Old error-stop code lost first cause before singleton initialization. Diagnostics-only first-stop native-journal sink/safe snapshot now implemented;24affected tests + typecheck/lint/build PASS. No stop policy/authority widening; current PID6784 not restarted or updated/reset/rearmed. Exact original triggering HTTP error unavailable, not guessed.

> **FINAL READY follow-up,2026-11-06:** [CONTROL section11](s32-6b1-control.md#11-final-ready--one-time-manual-web-preparation-2026-11-06). Fixed global request-error stop for only the bound owner's new-project GET404 transcript/en translation empty states; other errors still halt. Focused14tests + Backend typecheck/lint/build PASS; prior156 baseline retained, not wholly rerun. Current Customer401 TOKEN_EXPIRED and provider quota/activation approval remain blockers. EXECUTE NOT_STARTED/NO-GO.

> Latest: **FINAL INTEGRATION PASS (production paths with isolated dependencies)**, 2026-11-06. Section 11 supersedes the remaining integration blockers in sections 8-10. This is not real-media/Atlas/provider acceptance. **EXECUTE NOT_STARTED / NO-GO.** Runtime flags and the running read-only preload remain unchanged.

> Historical CLOSURE evidence: section 10 used a static grant fixture. Section 11 now exercises the actual services, model operations, HTTP multipart adapter and provider adapters without predeclared future payloads. No live runtime enabled.

Earlier scoped-core status, retained for history: code/mock PASS; full integration was PARTIAL/BLOCKED before section 11.

No production installation/activation, env change, Atlas connection/write, provider call, project/job, upload/encoding, old attempt change or read-only guard removal was performed. Existing unrelated edits preserved.

## 1. Implementation and authority

New `src/services/scoped-write-guard.ts` implements a default-deny native-driver interceptor and closed operation-plan validator. It is **not imported into startup**, has no env-driven activation, and constructor enablement defaultsfalse. `installScopedWriteGuard` is explicit; no production scope was granted. Existing read-only preload remains unchanged and continues denying business writes with its narrow authsessions exceptions.

An explicitly trusted future coordinator would have to supply:

- Valid runId, exact preallocated projectId/ownerId, exact database `multilingual_ai_narration`, independently established freshness, and optional independently verified active enKore voice ID.
- An immutable list of **exact native operations**, each with one-use idempotency key, record ID, collection/method, complete payload/options fingerprint, expected state/revision where applicable, and transaction requirement.
- An exclusive durable journal and explicit enabled state. `exclusiveWriteJournal` uses wx creation/fsync; existing journals refuse restart/reopen. Synthetic fixture journals only were created under backend/.tmp during this task.

The scope is a closed plan, **not a permission to write a collection**. Payload/filter/options changes or another owner/project/run are denied. The caller's mutable args are not retained as authority: sorted canonical BSON-aware fingerprints are captured at construction, and native document/filter/update/options receive a BSON snapshot before validation/delegation (session identity is retained separately). Mutation after interception cannot alter the delegated scope. No secret/payload is logged; journal events contain key/status/time only.

`freshProject:true` is an assertion from the trusted coordinator, **not a DB existence check**. No runtime bootstrap exists to establish freshness/registry/owner/revisions from live reads or to safely produce grants from new provider output. Do not accept HTTP/client-supplied manifests or use this assertion as live freshness proof. This missing bootstrap is a blocker, not permission to treat an old ID as new.

## 2. Exact allowlist and fail-closed exclusions

Only **insertOne/updateOne/findOneAndUpdate** can have business grants. All require a matching one-use exact plan entry, correct database and active scope. No upsert, arbitrary update pipeline, delete, bulk, unknown option, identity/reference mutation or unacknowledged write concern is allowed. When writeConcern is specified it must require majority+journal. Transactional grants require the exact active session object; nontransaction grants reject a session.

| Collection | Potential grant | Additional binding / current compatibility |
| --- | --- | --- |
| projects | insertOne/updateOne/findOneAndUpdate | Exact new_id and userId=owner on document/filter; insert DRAFT/AUTO/null source; updates require exact expectedstatus. Current writers omitting status/owner are denied |
| media | Exact single-record operation | Mandatory_id and projectId. Current metadata upsert on projectId without fixed_id is **BLOCKED** |
| processingjobs | insertOne or exact state update | New job_id/projectId, targeten if present, active session where required; updates require expectedstatus. Writers filtering only_id are **BLOCKED** |
| transcripts | insertOne/exact CAS update | Exact_id/projectId; new revision1, nullable language for AUTO allowed; updates require explicit expectedrevision. Current confirmation/fence filters without projectId are **BLOCKED** |
| transcriptsegments | Individual exact insertOne only in principle | Mandatory_id/projectId; current schema/writer uses transcriptId and insertMany/deleteMany, so actual STT persistence remains **BLOCKED** |
| translations | insertOne/exact revision update | New revision1, targeten, positive sourceTranscriptRevision; referenced transcript ID must belong to planned new inserts. Filters missing projectId are **BLOCKED** |
| narrations | insertOne/exact revision update | New revision1, positive sourceTranslationRevision, planned new translation, voiceId must equal trusted enKore ID. Existing filter mismatch is denied |
| results | insertOne | Positive sourceNarrationRevision, planned new narration, exact newproject and record ID |
| translationattempts | Exact individual attempt insert/update only | Exact record ID/projectId, owner if present. Existing Customer/global quota receipt IDs are shared string IDs with no project scope and use upserts: **BLOCKED** |
| activitylogs | Exact individual insert only in principle | Mandatory projectId/recordId, owner if userId present. Current entityId-based logs without projectId are **BLOCKED** |
| authsessions | No new business grant | Delegate only when the existing narrow predicate permits exact database/collection/method/shape. No blanket auth collection allowance |

Every update requires an exact approved filter and operator payload; identity/reference fields cannot be reassigned, including dotted paths. Transcript/translation/narration updates require revision CAS; project/job updates require expected status. References to transcript/translation/narration source IDs must match planned new insert IDs. Voice catalog state and new reference freshness are trusted-manifest inputs and are not fabricated/queried by this component.

Binding is deliberately stricter than existing E2E writers. It is not acceptable to remove checks or stamp projectId onto shared quota rows merely to make them pass. Shared Customer/global-day quota exceptions require a separate validated policy that preserves transactional single-charge semantics; none was granted.

## 3. Enforcement points and coverage

Installer patches the supplied **same MongoDB driver instance** used by Mongoose:

- Collection write methods: insertOne/insertMany/updateOne/updateMany/replaceOne/deleteOne/deleteMany/findOneAndUpdate/findOneAndReplace/findOneAndDelete/bulkWrite/bulk builders, index/drop/rename/mapReduce methods.
- Db/Admin command entry and DDL methods, MongoClient.bulkWrite: denied. No generic command permission.
- Collection.aggregate: only a fixed set of read stages allowed. `$out`, `$merge`, nested facet/lookup/unknown stages are denied. Guard does not treat aggregate as automatically read-only.
- Mongoose Model.create/save/update/delete/findOneAndUpdate reaching those driver methods: same enforcement applies, independent of HTTP middleware.
- Background worker/direct native call with no active approved scope: denied. An inherited asynchronous context expires when its lease ends, so late background work cannot reuse it.
- Transaction native calls: same rules and exact session required. Consumed grants remain consumed after abort/unknown outcome; no transaction retry/refund of grants.

Any authorized invocation is journal-claimed/fsynced **before** native delegate; used key is consumed synchronously. Native acknowledgment/inserted ID, exact matchedCount1 for updateOne or returned record ID for findOneAndUpdate is checked; ambiguous/zero-match failures halt the guard. A full request scope and native delegate cannot execute in parallel. No automatic resume/reset API exists.

The installer retains the existing wrapped original method. Installing it above today's read-only preload does **not** bypass that preload; a matching grant still reaches the older business-write denial. Separate reviewed composition code would be required to add a narrowly scoped exception without removing existing protections. No such change was made.

## 4. Uncovered or incompatible paths — explicitly BLOCKED

1. Actual STT `TranscriptSegment.deleteMany`/`insertMany`: prohibited, even with a transcript filter. No fresh-empty-row assumption used to allow deletion.
2. Current media upsert and shared quota upserts; several revision/job/project filters without all required scope fields; entity-based activity logging. Actual E2E would stop at these writes, not silently skip them.
3. Full transaction coordination/commit-result attestation, dynamic grant compilation, independent new-ID/revision/reference registry and fail-stop workflow after errors outside native writes. Consumed native grants alone do not prove the entire transaction committed or make replay safe.
4. Startup attestation: installer must run before any writer/model method is captured. A driver instance copied before patching, another installed driver copy/client process, internal low-level server/topology commands or arbitrary JS can bypass a prototype interceptor. A locked dedicated process/network boundary and verified load order are required; do not claim this code is an Atlas ACL or an arbitrary-code sandbox.
5. Filesystem/storage operations: not intercepted. Storage manifest, one-time upload, file path traversal/symlink protections, FFmpeg/network exceptions, and existing source-file replacement cleanup need a separate enforced policy.
6. Actual test-run journal binding: helper enforces exclusive-file restart for a supplied path but does not grant general filesystem authority or activate a journal. Live owner/project freshness and approved run paths are not established automatically.

Because these paths are not proven end-to-end, **EXECUTE remains BLOCKED**. This task authorizes implementation/mock tests only, not resolving gaps by granting wider write permissions, modifying schema/data or enabling runtime.

## 5. Race, restart and idempotency

- Different scopes cannot overlap; write claims are consumed before awaited driver I/O. Duplicate key/payload replay is rejected, including retry after abort or lost acknowledgment.
- Different owner/project/revision/state/filter/options/body cannot borrow a grant. Missing runId or malformed identity is rejected before constructing authority.
- An exclusive journal refuses a second coordinator/restart; old journals must never be deleted or replaced to rearm. Record write failure halts work before DB dispatch. Cross-machine/local-filesystem durability is not certified by local tests.
- Scope context expires on completion; no worker resume is installed. Existing8UNCERTAIN/1CLAIMED and all old projects are untouched. Their dated counts were not re-audited or reset.

## 6. Tests and files

New files:

- `src/services/scoped-write-guard.ts`
- `tests/scoped-write-guard.test.ts`
- This report; local skill PROGRESS/CHANGELOG updates.

Targeted command:

```text
node --import tsx --test --test-concurrency=1 tests/scoped-write-guard.test.ts tests/e2e-test-run.test.ts tests/gemini-tts-safety.test.ts tests/target-workflow.test.ts tests/customer-multilang.test.ts tests/customer-translation.test.ts
```

**86/86 PASS**, including18new scoped-guard tests. Backend TypeScript/lint/build PASS. No monorepo suite or database-backed test used.

New coverage: DENY/OFF/invalid or missing identity/freshness, wrong owner/run/project, old/cross-project payload, exact updates/state/revision, identity mutation, same-session transaction binding/no replay, direct native write, unscoped worker/late inherited timer, scope concurrency, all unscoped delete/bulk, raw/admin/client commands, write aggregation, journal failure/restart, unacknowledged outcome, cross-project references and write concern, actual Mongoose create/save/update/delete/findOneAndUpdate to fake native collection, and existing authsessions predicate via synthetic fixture. Mongoose fixture connection uses an in-memory fake database/collection; no MongoDB server is contacted.

No app/config/preload installation change. No .env, production permission, MongoDB business data, old jobs, Mobile/logs, provider/FFmpeg execution or commit/push change. Existing catalog backups/user media and other working-tree changes preserved.

## 7. Decision

**Supported write guard code/mock PASS. Full SCOPED GUARD integration PARTIAL / BLOCKED. NO-GO; EXECUTE NOT_STARTED.**

Next approval should address exact writer/manifest/bootstrap compatibility and storage/driver composition gaps with synthetic tests first, never activate a half-complete allowlist. Customer/CDP, SIMPLE flag/restart scope, provider quota and COST_HARD_CAP_UNAVAILABLE remain separate prerequisites; $1 stays PROPOSED and authorized53.59sec media remains unchanged. No paid call/business write can be inferred from this report.

## 8. S32.6B.1 INTEGRATION — 2026-11-06

**INTEGRATION PARTIAL / BLOCKED. Supported additions code/mock PASS. EXECUTE NOT_STARTED / NO-GO.**

### 8.1 Native write paths added

| Path | Enforcement added | Actual pipeline readiness |
| --- | --- | --- |
| STT insertMany | Only transcriptsegments; exact full batch fingerprint; every row_id/transcriptId/sequence/text/timestamps checked; IDs unique, sequences1..N, no unknown fields, <=20,000rows, ordered batch. Requires acknowledged fresh transcript insert from same plan and exact session+server transaction number | Mock PASS. Live activation, full stage transaction completion still blocked |
| STT deleteMany | **No native delete is dispatched.** Exact transcript-only filter can be declared only with a transaction-bound empty-reader; after fresh parent acknowledgment in same transaction, count must be exactly0. Return acknowledged/deletedCount0. Any existing row or missing evidence DENY | Fresh first-run no-op PASS; deletion/retranscription of existing data stays DENY |
| Media upsert | One exact findOneAndUpdate upsert at most; filter must have preallocated_id + exact projectId, `$setOnInsert._id` identical, new project creation already acknowledged, exact payload/options/returned_id | Safe form mock PASS. Current media.service filter is projectId-only with no fixed_id, so **current writer still DENY** |
| Missing projectId on revision fences | Can resolve only through same-plan acknowledged insert for that collection/id. Transactional parents require same active session and transaction number; no raw assertion can replace a parent | Same-transaction known-record form supported; current cross-transaction source confirmation/fences still blocked without commit attestation/registry |
| Shared quota receipt | No new permission; exact Customer/global-day upsert remains denied | **BLOCKED**, described below |

The existing one-use keys, BSON argument snapshot, owner/project/run checks, failure stop, exact acknowledgment checks and defaultDENY remain. No updateMany, arbitrary delete, generic bulk or broad upsert was permitted. Batch insertedIds/count must exactly match approved rows. Empty-delete read is a trusted native-reader callback, not client-provided emptiness or a fake acknowledgment for nonempty data. No segments are omitted or deleted to fit this policy.

### 8.2 Manifest/bootstrap preparation

New `src/services/e2e-integration-bootstrap.ts` provides an explicit, default-OFF verification function against a supplied trusted **read-only adapter**. It does not open a connection, create a manifest file, issue a grant, connect to Atlas or start work on import.

Checks: exact run/project/owner/voice IDs; AUTO -> confirmedvi, targeten/Kore; inference1/1/1; approved media53.591655sec/4,239,951bytes/SHA256 from READY; exactly one project-create grant; database identity; Customer role; active Kore; project and planned new record absence. Unknown/missing read evidence is denied. It snapshots before awaits, freezes the plan and checks its serialized identity before preparation, preventing caller mutation of proof inputs.

This replaces a bare `freshProject:true` assertion **for callers of this helper only**. The underlying generic guard constructor still needs trusted input. No production caller has been connected to this verifier, and no proof/manifest for real Customer data was created. Tests use synthetic IDs and read adapters only.

Remaining bootstrap blockers:

- New provider output, native BSON/session/options and actual generated IDs/timestamps need a staged trusted grant compiler/registry. The existing static exact-plan constructor is not an unrestricted dynamic issuer.
- The current bootstrap clone/structural validation is for explicit preparation plans; real BSON/session-bearing native plans must be normalized/compiled through a verified boundary, not assumed compatible from string-ID fixtures.
- It deliberately does not fabricate the transaction-bound empty-reader required by STT no-op deletion. Such a plan cannot be bootstrapped without that additional composition.
- Live freshness, role/voice state, approved journal path and startup identity need rechecking at future authorization. A dated local proof is not permission to write later.

Duplicate grant IDs remain rejected; exclusive journal restart refusal is reused from prior tests. There is no rearm/resume after process restart or authority to choose a new run ID to retry uncertainty.

### 8.3 Storage API enforcement

New `src/services/e2e-storage.ts` is defaultOFF and exposes only one-use `write` for exact predeclared input/audio/video grants. Namespace: `<approved root>/runs/<runId>/<projectId>/` within the supplied workspace. It validates run/project IDs, unique keys/names/kinds, generated flat filenames, extensions/MIME, exact byte count/SHA256, MP3 frames or MP4 ftyp signature and existing audio32MiB/video-input200MiB limits.

It copies caller bytes, rejects traversal/absolute names/Windows ADS/reserved filenames, checks parents/junctions, opens exclusively (`wx` equivalent, NOFOLLOW where available), fsyncs and verifies size/realpath. It refuses existing files and has no overwrite/rename/delete/cleanup/encode capability. Journal claim happens before file write; write/journal errors stop that instance. Only tiny synthetic fixture bytes were written under backend/.tmp; no real media was uploaded, converted or copied.

**Storage remains BLOCKED for actual pipeline:** Multer diskStorage, narration writeFile/rename, Result FFmpeg output/temp/rename and STT temporary extraction do not call this API. It is not a global fs/subprocess interceptor. Existing artifact metadata paths use a different layout, so a verified adapter must map them rather than silently changing URLs. Header/hash/size checks do not establish MP4 stream codecs/duration or speech quality; full probe/provenance checks remain necessary. Windows directory-swap races require protected namespace ACL/writer isolation, not just path-string checks. Journal exclusivity must be composed, not replaced with an arbitrary callback. No existing artifacts are cleaned up.

### 8.4 Preload and worker preparation

`prepareReadOnlyIntegration` explicitly installs a deny layer **before** a connect callback. Invalid/unverified/mutated bootstrap proof fails closed while leaving denial installed. Connect callback is one-shot; worker startup and write activation methods always reject. Existing authsessions predicate can be delegated unchanged. No existing preload code was modified, no new preload was installed in a real process, and no runtime was restarted.

This is a **preparation-only read-only composition**, not a complete E2E preload. It does not bypass the current preload's original deny method, arm the inference journal, grant business writes or resume any job. Production readiness still requires an attested dedicated entrypoint, controlled load order, verified native-driver identity and approved composition with narrow exceptions. Other driver copies/processes and raw low-level commands remain outside a JS prototype guard's guarantee.

### 8.5 Quota / transaction / worker blockers kept DENY

`translation/customer-attempt.ts` reserves quota using two shared Customer/global-day upserts and an attempt quotaReserved receipt in one transaction. These are not ordinary project-owned records. Permitting only a count increment or relying solely on a per-process used key would not prove that all three writes committed together. Commit ambiguity, driver withTransaction retry and receipt replay require one transaction-bound reservation policy plus commit attestation; this integration does not implement that policy. **No fake receipt, quota bypass, decrement/refund or global collection permission was added.**

Other incomplete paths: actual job/project updates missing expected state/owner filters; cross-transaction revision fences requiring an acknowledged committed record registry; activitylogs using entityId rather than projectId; post-provider transaction commit outcomes; background best-effort logging after lease closure. Workers with no valid lease remain denied, and late inherited leases expire. Denying a background write is not evidence its event was persisted. The old8UNCERTAIN/1CLAIMED are unchanged and were not re-audited/reset.

### 8.6 Tests and changes

Changed/new code:

- `src/services/scoped-write-guard.ts`: bounded batch/no-op empty deletion, preallocated media upsert, acknowledged-parent/transaction-number dependencies; existing restrictions retained.
- `src/services/e2e-integration-bootstrap.ts` (new).
- `src/services/e2e-storage.ts` (new).
- `tests/e2e-integration.test.ts` (new).

Targeted command:

```text
node --import tsx --test --test-concurrency=1 tests/e2e-integration.test.ts tests/scoped-write-guard.test.ts tests/e2e-test-run.test.ts tests/gemini-tts-safety.test.ts tests/target-workflow.test.ts tests/customer-multilang.test.ts tests/customer-translation.test.ts
```

**96/96 PASS (10new integration tests + previous86). Backend typecheck/lint/build PASS; diff check PASS.** New coverage: complete/mixed batch, no native deletion, nonempty transcript denial, same-session changed-transaction denial, one-project media upsert, unsafe current media shape denial, quota-upsert denial, immutable defaultOFF bootstrap/freshness/scope, before-connect denial/reconnect/worker/activation rejection, storage traversal/ADS/MIME/size/hash/no-overwrite/junction defense and input/audio/video metadata consistency. Prior duplicate/restart/concurrency/authsessions regressions included. No full monorepo suite, actual database or provider/FFmpeg operation.

### 8.7 Decision / next work

**INTEGRATION PARTIAL / BLOCKED. EXECUTE NOT_STARTED / NO-GO.** All required E2E write paths are not yet protected end-to-end; tests of guarded helpers are not a full pipeline acceptance claim.

Next work must handle scoped quota commit/receipt semantics, a staged native record/grant registry and exact current writer adapters, full filesystem/subprocess interception or adapter routing, and real preload composition. Do not enable flags/preload/guards or weaken DENY to make the current writers pass. Any change affecting real data must be reviewed before activation. Customer session REAL_CUSTOMER_PASS from the latest session-only CONTROL report is retained as dated evidence, not rechecked; provider quota/budget and runtime approvals remain separate blockers. Media53.59sec approval remains valid; $1 remains PROPOSED.

Only code, synthetic tests and documentation/progress were changed. No .env/secrets, live read-only guard, SIMPLE/test-run activation, Atlas data, real project/job/media, Mobile/logs, commit/push or EXECUTE change.

## 9. INTEGRATION FIX — 2026-11-06

**PARTIAL / BLOCKED. EXECUTE NOT_STARTED / NO-GO.** This follow-up connects fail-closed boundaries to actual application paths; it does not claim that all four blockers have become executable.

### 9.1 Quota receipt and commit attestation

Actual `translation/customer-attempt.ts` reservation now calls `runQuotaTransaction` from new `e2e-quota-transaction.ts`. OFF retains its existing `session.withTransaction` body/options and does not perform an extra attestation read. Counter guards, daily limits, two shared counter upserts and per-attempt receipt accounting are unchanged.

When test-run is explicitly enabled in a future prepared process, the helper requires the exact prepared owner/project, targeten, source digest and current UTC day. It consumes one reservation allowance per prepared boundary synchronously. It starts a transaction once, executes the **same actual reservation body**, calls commit once at application level, requires no active transaction after commit, then reads the exact attempt with majority concern **outside that transaction**. It checks owner/project/target/source/quotaReserved/day before journaling COMMITTED_ATTESTED. Commit errors, open transactions, unavailable/mismatched receipts and duplicate/concurrent reservation all fail closed; no automatic retry or new allowance. Existing reserved receipt is not resumed in test-run. Abort after an error is best-effort and is never proof of rollback after an unknown commit.

**Not resolved:** native permissions for shared quota counters and associated receipt are still DENY. Attestation code does not grant writes, forge a receipt or bypass limits. Native Mongo commit/driver internal protocol behavior is not a hard exactly-once proof; no live commit was tested. Until a separately reviewed exact transaction/receipt native policy is composed, this path cannot run through the scoped-write guard. The helper success path is synthetic transaction evidence, not Atlas acceptance.

### 9.2 Actual writer adapters

New `e2e-runtime-boundary.ts` is imported by actual service entrypoints. `guardedActualWriter` delegates to unchanged work when OFF; ON requires an explicitly registered matching owner/project boundary before invoking model code. Boundary registration does not grant native writes and is never called by application startup. Existing native guard/preload remain independent DENY layers.

| Real entrypoint | Connection added / remaining condition |
| --- | --- |
| project.service.create | Prepared owner/new-project identity checked before create; create work routed to boundary |
| media.service.upload | Metadata writer routed to boundary; existing projectId-only upsert still does not match fixed-ID native plan |
| transcription.service.transcribe | Boundary before model work; early storage deny before job/provider because extraction/probe lease missing |
| source-language.service.confirmSourceLanguage | Actual confirmation transaction routed to boundary; no fake revision |
| group-translation.service.preview / approve | Boundary before target-operation/native writes; normal source/quota/draft guards retained |
| narration.service.generate | Boundary before lock/job/provider and early deny for missing audio-storage lease |
| result.service.process | Boundary and early deny before job/render for missing output lease |
| best-effort activity logs/workers | No special permission added. Current late/unscoped native writes remain denied; no background worker started |

These are imports/wrappers in production writer modules, not replacements with fake services. Mock tests call actual exported entries to establish denial before DB/provider when missing scope, and existing source/translation tests exercise OFF regressions. **Still missing:** native grant compilation for actual filters/options, acknowledged cross-transaction record registry, exact activity entities and shared quota policy. A registered service boundary is not native authorization. No old-project/job permission was broadened.

### 9.3 Actual Multer and FFmpeg paths

`upload.middleware.ts` now uses new `E2eMulterStorage` around its existing diskStorage. OFF delegates directly. ON verifies actual request owner/project against the prepared boundary, requires explicit input storage grant, MP4 MIME and bounded stream bytes before writing through `E2eStorage`. The storage API then checks hash/size/header/namespace and exclusive creation. Duplicate/foreign-owner upload is denied; `_removeFile` refuses cleanup under test-run rather than deleting an artifact. Fixture tests exercise the actual Multer StorageEngine adapter with a tiny synthetic stream, not real media or HTTP upload.

FFmpeg/output path remains **BLOCKED**, now explicitly wired to fail closed: `runMediaCommand`, STT's actual extraction callback and Gemini TTS conversion reject before spawn in test-run when no supported lease exists. STT/TTS/Result service entries reject before paid work/jobs for these unleased paths. `ensureUploadDirectory` and `safeDeleteStoredFile` reject test-run filesystem side effects. Narration raw file write and Result output directory creation have additional guard checks. OFF preserves ordinary behavior.

No granted FFmpeg output handle/descriptor is implemented; therefore no actual encoding can occur under the test policy. Checks do not pretend a path string is enough to protect against overwrite/races. A remaining adapter must route narration/temp/Result data through a leased exclusive output mechanism and validate actual bytes/probe metadata before native persistence. Current direct rename/unlink and error-cleanup operations are not a complete filesystem firewall. Since entrypoints block first, they are not a reason to authorize execution. No previous artifact is replaced/cleaned.

### 9.4 Runtime startup

`config/database.ts::connectDatabase` now calls `assertE2eStartupReady` **before mongoose.connect**. OFF is a no-op. ON intentionally throws `S32_E2E_PRELOAD_COMPOSITION_BLOCKED`, even if a preparation callback has been registered. This prevents accidental enabling from starting a live test-run without completed native/storage/preload attestation. No automatic installation, guard weakening, env edit, restart or worker startup was performed.

Existing `prepareReadOnlyIntegration` still installs DENY before its test connect callback and refuses workers/write activation. The real read-only preload and authsessions exceptions were not edited. **Not resolved:** a live dedicated bootstrap that composes exact native permissions, auth predicate, immutable journal/run identity, storage/network leases and startup attestation before all imports/writers. A startup rejection is fail-closed protection, not a working E2E runtime.

### 9.5 Tests / files

New files: `services/e2e-runtime-boundary.ts`, `services/e2e-quota-transaction.ts`, `middleware/e2e-multer-storage.ts`, `tests/e2e-integration-fix.test.ts`.

Modified: `config/database.ts`, `middleware/upload.middleware.ts`, `utils/file.ts`; project/media/transcription/source-language/narration/result services; group translation/customer-attempt, FFmpeg media processor, Gemini STT/TTS providers. Changes are confined to default-OFF boundaries and unchanged-body quota wrapping; previous unrelated edits preserved.

Eight new focused tests PASS. Affected regression command:

```text
node --import tsx --test --test-concurrency=1 tests/e2e-integration-fix.test.ts tests/customer-translation.test.ts tests/customer-multilang.test.ts tests/source-language.test.ts tests/gemini-tts-safety.test.ts tests/e2e-integration.test.ts
```

**95/95 PASS** (this is the affected subset, not the historical96 suite repeated or a cumulative total). Backend typecheck/lint/build PASS. Tests cover exact commit order, wrong/missing receipt, unknown commit/open transaction, reservation duplicate/concurrency, OFF transaction behavior, actual DB connect denial before network, actual service missing-scope denial, actual Multer OFF/scoped synthetic stream/cross-owner/duplicate and actual FFmpeg/cleanup denial before side effects. Existing Customer SIMPLE/multilang/source and TTS regressions pass.

No database connection/provider request/real FFmpeg encode or real upload in tests. Only local tiny synthetic files were created. No .env/secrets, live guard, runtime flags, Atlas data, old attempts/jobs, Mobile/logs, commit/push change.

### 9.6 Decision

All four areas have concrete fail-closed hooks and targeted evidence, but **none of this authorizes a partially permitted run**. Shared quota native policy, full actual writer grant/record registry, granted FFmpeg/storage output and real preload composition remain unresolved. **INTEGRATION FIX PARTIAL / BLOCKED; EXECUTE NOT_STARTED / NO-GO.**

## 10. INTEGRATION CLOSURE — 2026-11-06

**Composed local/mock chain PASS. Whole application INTEGRATION PARTIAL/BLOCKED. EXECUTE NOT_STARTED/NO-GO.** This section supersedes section9's statement that no native quota policy or FFmpeg lease exists. It does not promote fixture coverage to a real-media/full-service acceptance.

### 10.1 One composition and closed writer registry

New `services/e2e-guard-composition.ts::composeE2eRun` composes the existing ScopedWriteGuard, bootstrap verifier, exclusive journal, E2eStorage and commit attestation rather than arming independent flags. Its default argument is OFF and it has no import-time side effects. When explicitly used with isolated dependencies it:

1. Installs a default-deny native router **before manifest parsing, verification, connect or worker callbacks**.
2. Parses/validates immutable bootstrap proof through existing trusted read adapters (database, Customer, new IDs, active enKore and approved media identity).
3. Opens an exclusive run-named journal within the workspace; existing file denies restart. Invalid parse/verification leaves denial installed and never connects.
4. Constructs the native exact-grant policy, native quota policy and namespaced storage/output leases, then the single writer registry.
5. Marks readiness only after those components exist; connect is one-shot. No service writer/worker can execute before connect/readiness.

Registered names are fixed: Project, Media, STT, Source, Translation, Approval, TTS, Result, Quota, Worker. The trusted manifest must explicitly map each enabled writer to existing one-use grant keys and prerequisite writers. There is no request-driven registration. Every grant must belong to exactly one writer; unknown names, missing/duplicate grants or collection outside that writer's fixed category are denied. The actual service entries now pass these names through `guardedActualWriter`, not an implicit catch-all writer.

Registry scope binds run/project/owner, expires after the callback, permits no concurrent writer or repeated stage, and halts on error. A writer cannot report completion without completing all of its native grants. Direct driver writes without registry context remain denied. Worker has only explicit manifest job grants and prerequisites, not permission to scan/resume old jobs. Result insert is denied until this composition's storage reports verified leased output completion; journal text alone cannot fabricate that state.

Quota is a nested writer within Translation, with its own transaction lease. It is not allowed as arbitrary standalone counter access or by another writer. Existing one-project/inference1/1/1 provider guard is retained; the native writer registry does not add paid attempts or bypass it.

### 10.2 Shared quota native policy — safe closed form implemented

`e2e-quota-transaction.ts::QuotaNativePolicy` now enforces the **same three updateOne shapes used in customer-attempt.ts**, routed by the registry at the native driver interception point:

- Exact `customer-day:<owner>:<UTCday>` receipt with `count < configured user limit`, `$inc:{count:1}`, `$setOnInsert:{kind:'QUOTA'}`, upserttrue and exact session.
- Exact `customer-global-day:<UTCday>` receipt with the corresponding global limit and identical increment semantics.
- Exact derived Customer attempt key, CLAIMED/executionVersion1/quotaReserved!=true filter; only set quotaReservedtrue/quotaDay, no upsert.

No whole-collection write permission or generic quota upsert exists. Constructor binds owner/project/run/source digest, targeten, day, limits and model/input binding. Before the first counter write it reads the exact attempt in the same transaction and requires matching identity/binding, CLAIMED/METADATA_DISPATCHING, executionVersion1, not already reserved. Existing counters must be valid nonnegative integer QUOTA records below their limits; absent counters retain normal insert semantics. Wrong cap/day/owner/key/increment/receipt/session or changed transaction number is denied before delegation. Counter uniqueness/transaction enforcement remains the real MongoDB responsibility, not a fake success result.

Each native operation is consumed before awaiting the driver. Acknowledged counters require modifiedCount+upsertedCount exactly1; the per-attempt receipt requires matchedCount/modifiedCount1. No refund, decrement, migration, reset or retry is exposed. Single reservation allowance is consumed even if commit is unknown; transaction/body failure stops the run.

The actual quota helper added in FIX now calls the composition's quota callback. It performs one logical application commit, reads the exact receipt with majority concern outside the transaction, validates owner/project/target/source/day and quotaReserved, then invokes `quotaAttested` on the same session/transaction identity. Native quota policy will not complete after three updates alone: it requires this commit-attested marker. Unknown commit, open transaction or mismatched/missing receipt blocks Approval/Result/Worker. Driver-internal commit protocol retries are not claimed absent. No native update or transaction was sent to Atlas.

**Boundary:** the policy is closed and tested for a prepared attempt; current automatic compilation of that attempt's future model/input binding and all other native payloads is still missing. Until that compiler exists, registration is not permission to guess a binding or rearm an old attempt. Run identity remains in the trusted scope/journal; existing counter schema is unchanged.

### 10.3 Output lease before actual renderer spawn

`e2e-storage.ts::output` reserves the approved run/project filename with exclusive read/write creation before invoking an encoder callback. One-use lease includes name, byte limit and deadline. There is no overwrite, reopen, rename, cleanup or reuse API. Output lease storage access also requires the active Result writer in the registry.

`media-processing/ffmpeg-media-processor.ts::runLeasedRender` is the actual renderer's controlled branch. It accepts only the exact approved source/narration/output/duration argument shape and configured resolver executable, validates input paths/regular files within the run namespace and rejects symlinks/out-of-scope paths. It removes the overwrite flag and passes an inherited reserved output descriptor as `pipe:3`, not an output path. It uses fragmented MP4 flags because the pipe protocol is non-seekable; this changes the controlled container layout and needs later real compatibility acceptance. Ordinary OFF renderer flags remain unchanged.

Storage monitors size and enforces a finite deadline; abort/error kills the controlled child. After close, output must be nonempty/bounded MP4, pass the supplied trusted output validator, and retain matching descriptor/path identity, size and hash through validation. Result metadata insert cannot precede this success. Failure/timeout revokes the lease, halts storage and leaves only the new failed output quarantined; it does not delete/modify old artifacts. A cancelled remote encoder cannot be proven stopped by local Promise rejection alone; the actual callback kills the child, and no failed file is promoted.

No FFmpeg process ran during this task: tests use a fake child writing tiny synthetic MP4 bytes to the reserved descriptor. Validator callbacks in fixtures are not a real codec/duration/speech-quality certification. Periodic size monitoring is not an OS hard disk quota; dedicated namespace ACL/writer isolation and real codec validation remain deployment requirements.

### 10.4 Explicit preload entry and actual runtime hooks

`preloadComposedServer` performs composition, registers the one binding/startup attestation, connects once, then invokes the supplied server loader. This entry must be explicitly invoked **before importing the ordinary server** with the same driver instance and existing narrow authsessions predicate. It is not imported/called by npm dev or armed from .env in this task.

The existing actual `connectDatabase` startup check now accepts readiness only when the composed binding has been attested; simple callback registration or setting an env flag still cannot satisfy it. Registry halt invalidates its readiness callback. In tests, the connect callback checks this exact startup gate before any server load, and invalid preload never loads the server or a worker. Worker completion requires Result completion and exact registered job operation, so readiness is not permission to resume a queue.

The live read-only preload is unchanged. Its original native denial remains in the wrapper chain: composition **cannot bypass it** to permit business writes. No authsessions predicate was widened. A later approved deployment still needs explicit safe composition with that original layer, protected run files, immutable module/driver identity and writer coordination. Other processes/driver copies/raw internal commands remain outside a JavaScript prototype interceptor's guarantee.

### 10.5 Executed mock chain and targeted verification

New `tests/e2e-closure.test.ts` executes one connected fixture path:

```text
parse + verified bootstrap -> native DENY preload -> registry/storage/journal readiness
-> connect -> Project -> Media -> STT -> Translation
-> exact native user/global counter + receipt updates
-> one commit + outside-tx receipt attestation -> Approval
-> TTS fixture audio -> leased fake renderer output -> Result native insert
-> registered Worker job COMPLETED
```

Both counter counts are checked as1; one commit and one fake spawn are observed. Tests also cover wrong owner/project, unregistered/direct native writers, incomplete grants, quota cap/forgery/wrong cap/increment/session/binding/transaction, commit uncertainty blocking later work, Result-before-output denial, no-lease/no-spawn, lease timeout/revocation/no-overwrite, invalid preload/no load, OFF inertness and journal restart rejection. Fixtures use known string IDs, fake native collection/session/read adapters and tiny synthetic buffers. They do not call the actual Customer HTTP pipeline, produce a real translation/audio/video, or act as proof that real model-derived payloads can be predeclared.

Affected targeted subset:

```text
node --import tsx --test --test-concurrency=1 tests/e2e-closure.test.ts tests/e2e-integration-fix.test.ts tests/scoped-write-guard.test.ts tests/e2e-integration.test.ts tests/customer-translation.test.ts tests/customer-multilang.test.ts tests/gemini-tts-safety.test.ts tests/e2e-test-run.test.ts
```

**105/105 PASS**, including11new closure tests. After the final immutable callback snapshot change, closure11/11 was rechecked PASS. Backend typecheck/lint/build PASS; diff check PASS. One intermediate cyclic type inference/lint issue was fixed before final checks. This is the selected affected subset, not all old milestone suites or a cumulative acceptance total.

Files: new `services/e2e-guard-composition.ts` and `tests/e2e-closure.test.ts`; connected existing `e2e-quota-transaction.ts`, `scoped-write-guard.ts`, `e2e-storage.ts`, `e2e-runtime-boundary.ts`, renderer and actual project/media/STT/source/translation/TTS/Result service writer-name calls. Existing unrelated edits preserved.

### 10.6 Closure status and precise remaining work

| Blocker | Closed with evidence | Still blocks actual application E2E |
| --- | --- | --- |
| Quota | Exact native three-update policy + attestation joined to registry/actual helper; counterfeit/unknown commit tests | Trusted staged attempt binding/grant compilation, real driver/session/receipt behavior unaccepted |
| Registry | One central static writer/grant router; actual entries identify writers; no direct/unregistered write | Fixed JSON plans do not compile runtime BSON IDs/dates/session/revisions/provider output or grant cross-transaction record completion |
| FFmpeg lease | Actual renderer branch receives exclusive descriptor only; revoke/post-validation/Result fence tested | STT extraction/temp, audio conversion/persistence and Result service's raw temp/rename lifecycle still have early DENY or unadapted shapes; source-file provenance/real codec validation not supplied by fake buffers |
| Preload | One explicit composition entry, before-connect actual startup gate and worker prerequisites tested | Ordinary npm dev is deliberately not armed; existing live read-only layer still denies writes; approved bootstrap/load order/auth/driver/storage composition not deployed |

Additional actual request issue: Multer executes before the Media metadata service wrapper. A full upload-request registry lease must span both stream and metadata persistence without consuming Media twice; the new closed registry correctly rejects storage access without that active writer rather than silently allowing it. Current E2E HTTP upload is therefore still BLOCKED even though the joined fixture writes native Media and leased output correctly.

Minimal remaining work is **one staged application adapter/coordinator**, not another standalone guard: bind the full request lease to actual Multer/service transactions, compile only independently verified native record/revision/payload grants after each stage, route STT/audio/Result file lifecycle into approved leases without raw replacement, and compose the original preload's narrow exception under explicit approval. Do not remove early DENY or widen a collection to get a green run. No old8UNCERTAIN/1CLAIMED is accessed/reset, and no new authority follows from mock PASS.

**CLOSURE composition code/mock PASS; whole INTEGRATION remains PARTIAL/BLOCKED. EXECUTE NOT_STARTED/NO-GO.** Customer REAL_CUSTOMER_PASS/media53.59sec approval are reused dated evidence; provider quota and COST_HARD_CAP_UNAVAILABLE/$1PROPOSED remain separate gates. No .env/SIMPLE/test-run/live guard activation, Atlas/provider operation, real project/job/upload/encode, Mobile/logs edit, commit/push or automatic EXECUTE occurred.

## 11. FINAL INTEGRATION — actual paths connected (2026-11-06)

**INTEGRATION PASS for code and isolated integration verification. EXECUTE NOT_STARTED / NO-GO.** The four application-adapter gaps from section 10 are closed for the approved single new-project, AUTO -> confirm vi -> SIMPLE en -> Gemini Kore -> video Result path. Unsupported operations remain DENY. There is no new runtime authority, paid inference or real database acceptance from this result.

### 11.1 Staged coordinator at the real native write boundary

`services/e2e-actual-runtime.ts::prepareActualRun` / `ActualE2eRuntime` composes the existing driver installer, quota policy, inference cap and storage controls. Actual service entries use the fixed registry order Project -> Media -> STT -> Source -> Translation -> Approval -> TTS -> Result. No caller may register another writer, skip a stage, run concurrently or repeat a completed writer. Root lease is acquired before asynchronous actor validation. The ACTIVE Customer is read independently for each stage; the active en/Kore/Gemini voice is rechecked before TTS.

The native router installs DENY before manifest validation/read/connect. A trusted immutable manifest binds runId, new projectId, ownerId, en Kore voice and approved media. Independent reads establish new-project absence and active Customer/language/voice. Exclusive fsynced run journals and a shared upload-root `.e2e-active.lock` reject automatic restart or a second run with a different runId. The lock is deliberately not auto-cleared, including after failure. Grant creation is internal to the coordinator, never an HTTP permission.

Dynamic grants are compiled from the actual BSON snapshot and independently read records rather than JSON plans guessing future IDs, dates and output. Each includes writer, exact document identity, operation and payload/options fingerprint, session and transaction number when applicable. The router strengthens updates with exact project/owner/current state/revision CAS. Only records created by this run can be parents or update targets. Full model validation, per-stage allowed fields, bounded record/write counts, exact source/target bindings and one-use native fingerprints are checked before delegation. Unsafe query operators, unknown fields, broad/bulk writes, old/cross-owner/cross-project writes, arbitrary upserts, index/DDL/raw write commands and write aggregations remain denied.

| Writer | Actual collections / permitted native shapes | Additional evidence |
| --- | --- | --- |
| Project | projects insertOne; activitylogs insertOne | Fresh preallocated ID, owner, AUTO unresolved, DRAFT; one project |
| Media | media findOneAndUpdate upsert; projects updateOne; activitylogs insertOne | Empty scoped media set; compiler adds new exact media ID; sealed input metadata; DRAFT -> UPLOADED |
| STT | projects updateOne; processingjobs insertOne/updateOne; transcripts insertOne; transcriptsegments insertMany; activitylogs insertOne | Exactly TRANSCRIPTION job; actual captured text and every segment/sequence/timestamp; transaction/revision1; no truncation. Existing first-transcript deleteMany executes no native deletion only after proving zero rows |
| Source | projects/transcripts updateOne | Initial unresolved AUTO only, vi confirmation, transcript revision1 -> 2; state/owner CAS and actual service artifact guards |
| Translation | projects updateOne; translationattempts insertOne/updateOne | New derived en attempt key and recomputed real source/input/model/DEFAULT binding; exact phase order; saved draft matches captured provider groups/coverage/digest |
| Quota (nested Translation) | translationattempts exact three updateOne operations only | Existing user/global counters and per-attempt receipt; exact caps/day/owner/project/source/session, acknowledged results and commit attestation |
| Approval | projects/transcripts updateOne; translations insertOne; activitylogs insertOne | Approved groups/text/digest/reviewer exactly match this run's durable draft and current source |
| TTS | projects/transcripts/translations updateOne; processingjobs insertOne/updateOne; narrations insertOne; activitylogs insertOne | Exactly TTS job; current source/translation revisions; fixed active Kore/en/Gemini; sealed MP3 metadata |
| Result / completion | projects/transcripts/translations/narrations updateOne; processingjobs insertOne/updateOne; results insertOne; activitylogs insertOne | Exactly VIDEO_PROCESSING job; leased validated MP4 and exact current narration revision; PROCESSING_VIDEO -> COMPLETED only on completion |

Jobs are completed by the actual STT/TTS/Result service paths, not by a synthetic unrestricted Worker grant. Detached workers have no active registry/session lease and are denied; no queue scan/resume or old-job permission is added. Best-effort activitylog work is queued within the current lease, then awaited and validated before stage completion. Direct model/driver operations outside a lease remain denied.

### 11.2 Actual request and complete storage lifecycle

`middleware/e2e-upload-request.ts` holds one Media lease from before actual Multer until metadata persistence, audit and independent stage readback. The nested Media service reuses that lease instead of consuming it twice. The route's final JSON response is held until attestation; a post-write verification failure cannot leak a successful 201. Default-OFF route behavior is unchanged.

`E2eMulterStorage` now delegates to `E2eActualStorage.upload`: bounded stream, exact MIME/size/hash, exclusive creation under `uploads/runs/<run>/<new-project>/`, regular/canonical path and no symlink/junction ancestor. Media service receives the real stored path and validates/probes through the controlled adapter. No raw temp-to-final rename is required in this mode.

`services/e2e-actual-storage.ts::E2eActualStorage` connects all remaining file paths:

- Gemini STT extraction uses its own one-use WAV output lease, replacing OS-temp extraction only while ON. Streaming RIFF/data sizes are finalized only in that new reserved output before WAV validation. Source input is hash-verified again before extraction.
- Gemini TTS uses the actual WAV/MP3 validator and converter entry. Controlled conversion uses bounded memory stdin/stdout and the existing shared abort/deadline; no uncontrolled conversion file. Captured provider output hash binds exactly the bytes accepted by `saveAudio`.
- Narration writes validated MP3 exclusively to its leased final path. Result renders exclusively to its leased final MP4. ON paths do not execute the ordinary raw mkdir/write/rename/unlink lifecycle. Default-OFF production branches retain it.
- Output lease is acquired before encode or write. FFmpeg receives only fixed arguments and an inherited reserved descriptor (`pipe:3`), never an arbitrary writable output path or overwrite option. Size/deadline/abort checks are bounded; failures revoke/quarantine new output and never promote metadata.
- Post-checks require valid byte signatures, trusted ffprobe facts, nonempty bounded file, audio, and valid duration. Video additionally requires h264/aac and source-duration tolerance. Descriptor/path device, inode and size must still agree after validation; current file hashes match sealed facts. Result/Narration inserts must exactly match those facts and revisions.
- `safeDeleteStoredFile`, Multer removal and failed-service cleanup route to namespace/lease-checked quarantine in test-run mode. They never unlink old or committed data. No arbitrary rename/delete API is granted.

`productionActualTools()` provides the real fixed ffprobe/FFmpeg adapter. Tests inject only its process/tool boundary; no executable, real media conversion or codec-quality claim was made. Windows descriptor/container compatibility and actual media quality remain EXECUTE acceptance, not a missing code adapter. Namespace ACLs and excluding other OS writers remain required: this application interceptor is not an OS/database security boundary for unrelated processes or another driver copy.

### 11.3 Real quota and transaction completion

The actual `customer-attempt.ts` reservation body still performs its original user/global quota checks and three native updates, through `QuotaNativePolicy`. The coordinator recomputes its binding from actual current source, candidate groups, provider input and model before the attempt insert. It binds the single receipt to this run's new project/owner/source/en/day and active transaction; no global collection grant, forged receipt or quota bypass is introduced.

`withGuardedTransaction` delegates OFF to existing withTransaction. ON uses one explicit transaction/body/commit with no application retry, binds all native writes to the exact session/transaction number, then independently reads and compares touched committed documents with majority read concern. The quota wrapper additionally requires its committed outside-transaction receipt and attestation on that same session before Translation can dispatch or complete. A thrown/lost commit acknowledgment, even if the fake database applied the writes, halts the run as UNCERTAIN and never automatically retries or proceeds to the next provider. Source/target fences remain retained after a test-run error; uncertain writes cannot be disguised as completion.

### 11.4 Explicit real preload, never activated here

`src/e2e-preload.ts` is an actual top-level-await Node preload entry; it is not imported by npm dev/server. OFF is inert. ON validates the workspace manifest, exact approved media identity, existing SIMPLE/Gemini/DEFAULT configuration and matching run/project/owner env before installing/connecting the prepared runtime. It disables automatic index/collection creation. Bootstrap uses only independent reads with the SAME mongoose.mongo driver; after readiness it connects Mongoose once, and subsequent trusted reads use that main connection. `config/database.ts` requires the composition's ready proof and avoids a duplicate connect. No service writer can run before connect, and no worker before preload completion.

`services/e2e-auth-policy.ts` preserves the exact existing opt-in authsessions predicate, including method/filter/field/type restrictions; tests compare it to the unchanged original local read-only preload. The live `.agents/runtime/s32-6a/read-only-preload.mjs` was not edited, removed or bypassed. For a future separately approved run, this composite entry must be chosen explicitly as the process guard; stacking it under the original unconditional business DENY will still deny writes. No live flag, manifest/scope approval or process was armed here.

### 11.5 Verification and files

New `tests/helpers/e2e-memory-native.ts` supplies an isolated native collection/session database under real Mongoose queries/models. `tests/helpers/e2e-actual-scenario.ts` uses the actual services and actual Gemini STT/translation/TTS adapters with only network transports, database and media tool processes faked. HTTP upload uses the actual project route, JWT/owner middleware, Multer storage and Media service with a synthetic account/token and tiny artificial MP4 bytes. These local credentials are never printed or used against the real application.

Verified complete chain:

```text
default DENY/bootstrap -> registry/storage/journal ready
-> actual Project create -> loopback multipart upload/Multer/Media
-> Gemini STT adapter + leased extraction -> source confirmation with real revision
-> Customer SIMPLE en + actual quota reservation/commit/receipt -> approve
-> Gemini Kore TTS adapter/WAV validation/conversion/leased MP3
-> actual Result renderer adapter/leased MP4 -> transactional Result + COMPLETED
```

Assertions include exactly one project, one STT/Translation/TTS dispatch each, one extraction/render each, both quota counts1, three completed processing jobs, correct stored output, no destructive deletion and unchanged other-owner/old completed project. Negative cases cover wrong owner/project, direct/unregistered writer, forbidden payload, cross-scope batch, concurrency, commit failure before/after apply, missing lease, outside output/cleanup, overwrite before TTS, upload hash/junction, failed render, post-upload attestation failure, invalid preload, duplicate/restart and OFF behavior. Separate tests cover native immutable snapshot/one-use/revision/transaction restrictions and existing session exception; no bypass replaces the guard being tested.

Final affected subset (not full monorepo or a cumulative milestone total):

```text
node --import tsx --test --test-concurrency=1 tests/e2e-preload-final.test.ts tests/e2e-actual-final.test.ts tests/e2e-integration-fix.test.ts tests/scoped-write-guard.test.ts tests/e2e-closure.test.ts tests/e2e-test-run.test.ts tests/customer-translation.test.ts tests/customer-multilang.test.ts tests/source-language.test.ts tests/gemini-tts-safety.test.ts tests/target-workflow.test.ts
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```

**156/156 tests PASS**, including19 actual-path scenarios and3 preload/auth/native tests. Backend TypeScript, ESLint and build PASS; tracked source/test diff whitespace check PASS. Intermediate synchronous Promise rejection and test lint issues were corrected before these final results.

New files: `src/e2e-preload.ts`; `src/middleware/e2e-upload-request.ts`; `src/services/e2e-actual-runtime.ts`, `e2e-actual-storage.ts`, `e2e-auth-policy.ts`; `tests/e2e-actual-final.test.ts`, `e2e-preload-final.test.ts`; `tests/helpers/e2e-actual-scenario.ts`, `e2e-memory-native.ts`.

Connected existing files: `config/database.ts`, `routes/project.routes.ts`, `middleware/e2e-multer-storage.ts`; `services/e2e-runtime-boundary.ts`, `e2e-test-run.ts`, `scoped-write-guard.ts`, `target-operation.service.ts`; actual project/media/transcription/source-language/group-translation/narration/result services; Gemini STT/TTS adapters and FFmpeg media processor; `utils/file.ts`; related integration regression test. Prior uncommitted catalog/Web/Admin changes were preserved, not claimed as new work. Local synthetic files/journals are test artifacts, not real projects or provider attempts.

### 11.6 Final gate

No unadapted business/file write path remains in the tested fixed E2E route. Unsupported branches, arbitrary workers, bulk/DDL and out-of-scope operations remain DENY. The application integration blockers are closed **in code/local isolated evidence only**; actual MongoDB commit behavior and FFmpeg/Windows media interoperability were not executed under this authorization.

**EXECUTE remains NOT_STARTED / NO-GO:** runtime/write/provider approval, selecting the explicit composite preload and protected run manifest, provider quota verification and stop/budget agreement remain separate prerequisites. Previously verified Customer session and approved53.59sec media are reused dated evidence, not freshly revalidated here. Provider quota UNKNOWN; COST_HARD_CAP_UNAVAILABLE; $1 remains PROPOSED, never an enforced billing cap.

No .env/secret, live read-only preload, SIMPLE/test-run flag or current runtime was modified/activated. No Atlas connection/write, real provider/FFmpeg call, real upload/project/job, old UNCERTAIN/CLAIMED reset, Customer Web/Mobile/Admin/logs change, commit/push or EXECUTE occurred.
