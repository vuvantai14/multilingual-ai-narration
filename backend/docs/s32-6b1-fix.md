# S32.6B.1 FIX — technical blocker remediation

2026-11-05. **Code/mock verification PASS; real execution readiness NO-GO. EXECUTE NOT_STARTED.**

## Root causes and changes

| Blocker | Root cause | Resolution / remaining scope |
| --- | --- | --- |
| GROUPS_V1 / Customer OFF | Runtime flags do not select/enable Customer SIMPLE | No runtime/env change; existing SIMPLE mock regression passes |
| Missing configured FFmpeg/FFprobe | Explicit restored paths shadow working PATH binaries | Shared resolver prefers existing configured file, otherwise uses PATH; shell=false/windowsHide retained. Used by media probe/render, STT extraction and Gemini TTS conversion |
| WAV declared as MP3 | Conversion catch returned original WAV then unconditional audio/mpeg | Validate RIFF/WAVE chunks or complete MP3 frames; validate supplied MIME if present. Convert WAV only, then validate MP3 bytes. Reject malformed/mismatched output; never return WAV fallback |
| TTS retry/deadline | SDK defaults allowed 4 retries; provider/conversion had no bounded overall deadline | One 120-second deadline across synthesis/conversion, AbortSignal + hard Promise race, explicit maxRetries0/attempts1, store:false. Conversion abort kills subprocess; output buffer capped32MiB |
| Ambiguous provider outcome | Timeout/connection loss cannot prove synthesis was not processed | TTS_TIMEOUT / TTS_UNCERTAIN returned; project fence retained, no retry/reset. FAILED job records code, not a new schema status |
| Missing media/quota/cost proof | No approved short media; provider/account evidence absent | Still requires user input and separate execution approval |

No artifact/schema migration. Existing files/documents remain untouched. New provider responses must pass byte validation; legacy stored artifacts are not reclassified. Container/frame validation is not an audio-quality test or a full decoder.

## Files touched by this FIX

- `src/services/media-processing/media-executable.ts` (new): shared executable selection.
- `src/services/media-processing/ffmpeg-media-processor.ts`: use resolver for probe/render.
- `src/services/stt/gemini-stt.provider.ts`: use resolver for extraction.
- `src/services/tts/audio-format.ts` (new): conservative WAV/MP3 identification/validation.
- `src/services/tts/gemini-tts.provider.ts`: output validation, conversion failure, deadline, no retries, safe test-only injection.
- `src/services/narration.service.ts`: preserve conversion/uncertainty codes and actionable uncertain response. Existing changes preserved.
- `src/services/target-operation.service.ts`: retain fence on TTS_UNCERTAIN as already done for TTS_TIMEOUT. Existing changes preserved.
- `tests/gemini-tts-safety.test.ts` (new), `tests/target-workflow.test.ts`: mocked safety and uncertainty regressions.
- This report, PREP follow-up pointer, local progress/changelog.

## Verification

`node --import tsx --test --test-concurrency=1 tests/gemini-tts-safety.test.ts tests/target-workflow.test.ts tests/customer-multilang.test.ts tests/customer-translation.test.ts`: **58/58 PASS**.

Coverage: valid Windows configured path; missing-path fallback; missing PATH executable simulated ENOENT; WAV/MP3/truncation/MIME validation; conversion failure/no WAV fallback; English Kore regression; finite provider/conversion deadline; abort child kill; no late conversion after provider deadline; single mock dispatch on ambiguous error; explicit SDK no-retry settings; durable lock retained/no second-target dispatch; existing SIMPLE and multi-target mock coverage.

`npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run build`: **PASS** in backend. `git diff --check`: PASS (line-ending notices only). No whole-monorepo suite or database-backed integration suite was run. Tests used mocks/synthetic credentials and loopback fixtures, not Atlas/provider calls or FFmpeg encoding.

Real provider audio shape/quality and Windows subprocess conversion remain untested by design. Runtime flags were not changed to claim readiness. No read-only guard was removed or modified.

## Configuration proposal — NOT APPLIED

After separate approval and readiness checks, propose only:

```ini
# backend/.env
CUSTOMER_TRANSLATION_ENABLED=true
CUSTOMER_TRANSLATION_METHOD=GEMINI_SIMPLE_V1
TRANSLATION_PROVIDER=gemini
CUSTOMER_TRANSLATION_THINKING=DEFAULT
# CONTROLLED_PROVIDER_MODE must remain absent/unset (a literal false string is truthy).

# frontend-web/.env: source confirms this selects Customer SIMPLE workspace
VITE_CUSTOMER_TRANSLATION_ENABLED=true
```

Keep current Gemini model/provider selection, MongoDB/JWT and other secrets unchanged. Do not automatically select fallback translation model. Effective provider access/quota must be verified separately. After an approved config change, restart only the affected runtime with the read-only guard retained and verify method/enablement via safe preflight; do not generate.

No FFmpeg env edit is required for the new missing-path fallback. If PATH is also missing, execution fails explicitly; it never pretends conversion succeeded. A present but non-executable/corrupt configured file fails rather than silently switching after an execution error.

## Uncertainty and cost boundaries

- One provider dispatch is allowed by the Gemini adapter; SDK retry overrides are explicit. Network uncertainty still prevents a guarantee of exactly-once billing or provider-side cancellation.
- A provider timeout or transport error is uncertain even when the local HTTP request aborts. The durable project fence remains; a new request/target is blocked. There is no automatic TTL takeover or operator recovery here.
- Conversion errors/timeouts occur after receipt of provider output and return distinct codes. No artifact is returned or saved from invalid conversion; paid provider processing may already have occurred.
- ProcessingJob schema is unchanged: failed local operation is recorded FAILED with TTS_TIMEOUT/TTS_UNCERTAIN; UNCERTAIN is the error/outcome semantics and retained lock, not an invented persisted status.
- Conditional future SIMPLE normal and worst-case inference dispatch count is now3 (STT1 + translation1 + TTS1), plus metadata/upload/poll/delete. This is not proof of current runtime enablement, a total HTTP bound or a hard dollar budget.

## Remaining NO-GO conditions

Approved15–30s Vietnamese media/rights; runtime flag approval; effective read-only guard/startup attestation and a separately approved controlled-write execution policy; provider model access/quota; actual bounded budget; exact new-project scope, storage capacity and recovery manifest. No change to these policies is authorized by mock PASS.

No .env change, Atlas write, real Gemini/TTS call, project/job creation, upload, FFmpeg encoding, Mobile/logs edit, commit/push. **Stop after FIX; EXECUTE NOT_STARTED.**
