# S32.6A — Customer runtime acceptance, no paid AI

Date: 2026-11-05, Asia/Bangkok. Overall: **PARTIAL**. Actual Backend/Web
runtime and Chrome fixture acceptance passed; no authenticated live Customer
API/media acceptance was performed. S32.6B was not started.

## Runtime and isolation

- Backend: `npm.cmd run dev`, http://localhost:8080/api/health HTTP200,
  `database=connected`. Actual configured Atlas `multilingual_ai_narration`.
- Web: `npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort`, HTTP200.
- Backend launched with a process-local preload under
  `.agents/runtime/s32-6a/read-only-preload.mjs`: Mongoose autoIndex/autoCreate
  disabled; collection writes/index creation denied; external fetch/media
  executable calls blocked. Direct insert/update/delete/createIndex denial
  checks passed. No .env or Backend application file changed for this harness.
- No worker, scheduler, seed or migration started. Backend/Web remain running
  with the Backend read-only protection. They are not a normal writable session.
- Chrome headless used a dedicated local CDP9223 profile, then closed. No
  personal browser, existing Customer token, password or cookies were accessed.
- Browser fixture installs an explicitly synthetic session and intercepts all
  API fetches in memory before app scripts run. It does not bypass authentication
  on the real Backend. Unexpected fixture endpoints fail closed. No fixture
  mutation reaches Atlas; no AI, TTS or FFmpeg runs.

## Screens actually opened in Chrome

Every screen below was opened at 375,768,1024,1440px with fixture data: 40
screenshots, zero whole-page horizontal overflow, zero JavaScript exceptions
and zero console errors in the final sweep. This does not attest every possible
dataset, a screen reader audit, real media playback or protected API data.

| Screen | Route | Browser fixture | Authenticated live API |
| --- | --- | --- | --- |
| Dashboard | /dashboard | PASS | NOT TESTED |
| My Projects | /projects | PASS | NOT TESTED |
| Create Project | /projects/new | PASS, mock upload/create only | No real write attempted |
| Project Detail | /projects/:id | PASS | NOT TESTED |
| Transcript | /projects/:id/transcript | PASS, confirmation mocked | No real confirmation |
| Translation | /projects/:id/translation?language=ja | PASS, generation/review mocked | No AI or approval |
| Voice | /projects/:id/voice?language=en and ja/ko/zh | PASS | Real catalog service read separately |
| Result | /projects/:id/result?language=en | PASS | No real media acceptance |
| Library | /history | PASS | NOT TESTED |
| Account/navigation | /settings and navigation links | PASS | No real profile change |

## Browser interactions

35 primary checks and8 additional checks passed:

- AUTO default; payload omits sourceLanguage. MANUAL defaults vi; all five
  choices and all five actual browser-generated mock create payloads checked.
- Three source status labels; unresolved source blocks translation. Confirmation
  sends actual revision7 once despite double click, refreshes fixture data;
  revision conflict requires explicit reload and does not retry.
- Four targets en/ja/ko/zh; vi source excluded, en source excludes en. Browser
  mocked ja generation/review/approval carries selected target/digest. Late ja
  responses after selecting ko are ignored; old draft/review not shown.
- Existing completed en, failed ja and unstarted ko/zh remain independent;
  library displays only current en artifact. No cross-language fallback.
- Every target voice selector displays Kore/Fenrir without a synthesis POST.
- Result add-language modal allows unstarted targets; Tab/ShiftTab wrap,
  Escape closes, focus returns to trigger. Tab focus, reduced-motion preference
  and mobile menu navigation tested in Chrome.
- Projects loading, empty and API-error states tested. Other error variants
  remain covered by focused mocks; not all were exercised in Chrome.

Fixture media consists of intentionally invalid synthetic bytes: it does not
prove codec, playback, download correctness or artifact existence on Atlas.
No paid quality/STT/translation/synthesis/rendering acceptance is claimed.

## Verified issues fixed

1. Result add-language button incorrectly treated NOT_STARTED variants as
   existing languages because it passed every variant to the modal. Now only
   variants with `hasResult` are excluded, including both result branches.
2. AddLanguageModal did not close on Escape and had no focus trap/restoration.
   Added initial focus, Tab/ShiftTab boundaries, Escape and opener restoration.
   UI appearance, routes and API contracts unchanged.
3. Translation workspace and SIMPLE preflight siblings reused the same React
   key. Actual Chrome/Vite reported duplicate-key warnings. Keys now include
   distinct role prefixes plus project/target; final console sweep is clean.

Files changed during S32.6A:

- `src/pages/ResultPage.tsx`
- `src/pages/TranslationPage.tsx`
- `src/features/projects/AddLanguageModal.tsx`
- `tests/target-workflow.test.mjs` — three behavioral regressions + fixture hooks.
- This document and local progress/changelog. Earlier S32 work preserved.

## Actual catalog and database verification

`listActiveVoices` was executed read-only against the configured Atlas using
the actual Backend service: gemini Kore/FEMALE and Fenrir/MALE for each
en/ja/ko/zh; languages en/ja/ko/vi/zh, no fr. This is service evidence, not an
authenticated HTTP Customer test. Anonymous real GET /api/voices returns401
as expected; no real login/refresh was attempted because it could persist sessions.

SHA256/counts of16 business collections matched the S32.5B backup evidence
after the browser/tests. Credential fields were excluded for users/authsessions;
main business collections were hashed in full. No business mutation detected.
Migration was not rerun; backup was not altered/deleted.

## Checks and evidence

- Web138/138 focused tests across14 files PASS; three new regression tests.
- Backend95/95 focused mocks across8 files PASS, no live DB test suite.
- Web TypeScript/build PASS; lint exit0 with the same three pre-existing warnings
  in AudioGuideModal (two) and GroupTranslationWorkspace (one).
- Existing bundle >500k/dynamic-import warnings remain; no unrelated redesign.
- Both design checks and Mobile4/4 design/token checks PASS. Mobile source is
  untouched; mobile multi-target capability parity remains S32.7.
- `git diff --check` PASS. No dependencies installed, commit or push.

Local, Git-ignored evidence: `.agents/runtime/s32-6a/` contains CDP harness,
browser-report.json, interaction-report.json, additional-browser-report.json,
40 screenshots, live-catalog.json and business-readonly-evidence.json.
Harness commands from workspace root:
`node .agents/runtime/s32-6a/browser-acceptance.mjs`,
`node .agents/runtime/s32-6a/browser-interactions.mjs`,
`node .agents/runtime/s32-6a/browser-additional.mjs`.
These local files do not survive an ordinary clone without separately restoring
the ignored .agents directory. They are not part of application production code.

## Before S32.6B

Provide a valid Customer browser session through an approved read-only browser
workflow; verify protected HTTP responses against UI and existing project/media
artifacts without login/session writes by automation. Complete real media and
broader keyboard/accessibility acceptance. Any new data generation or paid
provider test requires separate authorization. Do not automatically remove the
read-only guard or start S32.6B based on this report.

## Follow-up: Customer login diagnosis, 2026-11-05

Confirmed Backend log: `S32_6A_READ_ONLY_WRITE_DENIED` at Mongo Collection
insertOne, via AuthSession.create -> createTokenPair -> authService.login.
AuthSession persistence is required by normal login. The read-only guard is
enforcing its intended scope; login is not a database-read-only operation.
The generic error middleware maps this plain Error to INTERNAL_SERVER_ERROR500,
and the Customer message mapper displays the reported generic server message.
No raw response from a user's browser session or credentials was inspected.

Health8080 HTTP200/Mongo connected, login page5173 HTTP200, API base
http://localhost:8080/api, no Vite proxy configured/required. CORS OPTIONS login
from localhost5173 HTTP204 with matching allow-origin. An empty-body login probe
returns400 VALIDATION_ERROR before service/DB access; anonymous auth/me401 is
expected. No real account login was attempted and no session was created.

Error distinctions: network/timeout is transport failure without HTTP status;
401 invalid credentials,403 forbidden/blocked account,429 rate limiting,500
unexpected server error. Actual log proves the guard/session-insert failure,
not a connection,401,403 or429 explanation for this incident. Real403/429 were
not deliberately triggered; message mappings are mock-tested only.

Small verified UI gap fixed: getLoginErrorMessage previously lacked explicit403
and429 branches. Added safe messages in src/features/auth/loginError.mjs and
regression in tests/login-polish.test.mjs. Auth-focused tests16/16 PASS; Web
typecheck/lint/build PASS with the same existing warnings. No Backend or guard
change. This clarifies other errors; it does not make guarded login succeed.

Within the current no-Atlas-write constraint, use an already valid session if
safely accessible. A new login requires separately authorized AuthSession writes
and a reviewed runtime policy; do not skip persistence, fabricate tokens, bypass
authentication, disable the guard or convert login to fake success.
