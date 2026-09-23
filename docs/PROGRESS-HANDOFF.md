# Counterwell — development progress and agent handoff

Snapshot: 23 September 2026, after the voice-assisted selling refinement pass. Read alongside the user's original **Pharmacy-first retail operations app** plan. This document describes the current implementation and evidence; the plan describes the intended product. Local source and a fresh inspection take precedence if development has continued since this snapshot.

## Start here

- Workspace: `/Users/harshit/Code/Agency/voice_reciepts` (the directory spelling is intentional).
- An implemented pilot monorepo already exists. Continue it; do not scaffold a replacement app.
- **There is no Git repository in this directory or its parents.** No branch, commit, PR or remote represents these changes. Preserve the existing files and private local data. Version-control setup has not been performed.
- The latest work completed two focused passes: **supplier-invoice receiving**, then **voice-assisted selling**. Their implementation and local checks are complete, but their live-provider and physical-device acceptance is not.
- **Next agreed pass: manual/barcode checkout and cashier handoff.** Inspect existing UI and backend, improve the complete workflow, add meaningful regression coverage, and test it before moving to the next feature.
- No production deployment, store cutover, paid-provider evaluation, TestFlight upload or Play internal release has happened.

Suggested reading order: this document → [README](../README.md) → [architecture/API](ARCHITECTURE.md) → [verification evidence](VERIFICATION.md) → [feature sequence](FEATURE-PASSES.md) → [AI costs](AI-COSTS.md) → [pilot gates](PILOT.md).

## Product decisions to preserve

One React Native Android/iOS app, with employee Sell, Orders, Stock, Customers and More; owners also have Overview, Inventory, Money, Reviews and Administration. India, INR, Asia/Kolkata, Hindi/English, initially one store and shared drawer per business. Username/password on employees' personal phones, assisted onboarding, no public signup, strict business isolation.

The user's latest priority is to improve **one existing feature at a time**, including UI, backend correctness and recovery. Target customers may pay only a few hundred or thousand rupees monthly. Use replaceable APIs for v1, control usage, and consider self-hosted/open models later if measured costs justify it. Preserve manual entry when AI is unavailable. Keep the current restrained teal, phone-first UI consistent rather than redesigning the whole product.

Capture **actual supplied items**, not an automatically fulfilled prescription. Voice only produces a draft. The employee confirms medicine, strength, formulation, quantity, unit and physical batch. Never automatically substitute or finalise from AI output. Invoice extraction also requires human review before stock posting.

Keep sales, collections, dues and shared-drawer shortage separate. Attribute recorded actions to employees; drawer shortages do not establish individual theft. Existing merchant UPI QR is manually verified, not provider-confirmed. Credit exposure and financial exceptions need online owner approval. Camera observations are owner-reviewed evidence candidates in a silent pilot: no employee scoring, facial recognition or automatic theft verdicts.

## Current feature status

“Implemented” below means code exists, not that all original acceptance tests have been satisfied.

| Area                        | Implemented now                                                                                                                                                                        | Remaining or not established                                                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts and isolation      | Better Auth username login, assisted owner seed, owner-created employees, temporary-password replacement, memberships, collection permissions, devices, server-side tenant/role checks | Production onboarding, security review and real multi-shop operations                                                                             |
| Sell and orders             | Search, camera barcode path, batch selection/confirmation, loose units, quote, held orders, versioned acknowledged cashier handoff, checkout, invoice snapshots                        | Next focused refinement pass; physical scanner/camera operation, full UI concurrency and uncertain-response walkthroughs                          |
| Supplier receiving          | Document uploads, extraction jobs, editable reviewed draft, product mapping, paid/bonus pack conversion, source opening, native autosave, resumable jobs, posting safeguards           | Real provider documents, physical-device source opening/restart, diverse invoice layouts; no camera capture/crop UI                               |
| Voice selling               | Recording and typed-entry paths, local exact parser, editable compact review, product candidates/conflict warnings, saved draft/basket, resumable jobs, STT checkpoint, usage controls | Live speech accuracy/latency, microphone on target phones, durable failed-audio upload queue, independent media-duration verification             |
| Payments and credit         | Cash/manual UPI/mixed payments, duplicate-reference checks, approved credit/discounts, customer ledger and repayments                                                                  | Dedicated UI/backend refinement and real operating validation; no UPI provider integration                                                        |
| Returns and approvals       | Owner approvals, separate refund execution, linked returns, quarantine and reviewed disposal                                                                                           | Dedicated operational refinement and shop acceptance                                                                                              |
| Inventory                   | Catalogue/units/aliases/barcodes, batches/cost/MRP/prices, opening counts, supplier purchases/bonus quantities, movement rules and stock corrections                                   | Large real catalogue ingestion, physical counts and complete receiving/expiry operating validation                                                |
| Drawer and EOD              | Opening/closing counts, recorded cash movements, reconciliation, separate sales/collections/dues, provisional/revised reports                                                          | Dedicated refinement; actual shared-drawer process and multi-phone closing exercise                                                               |
| Offline and sync            | Native SQLCipher, durable sequence/outbox transaction, signed 24-hour authorisation, idempotent replay, gateway backup, revoked-device review, redacted incremental sync               | Four-hour physical-phone test, power-loss/restart/reinstall tests, gateway outage exercise; browser memory storage is not durable offline billing |
| Receipts and printing       | Invoice HTML/PDF path, authenticated gateway print queue, status, explicit audited reprints                                                                                            | Physical Epson/Hindi/PDF checks from Android and iPhone; no printer configured                                                                    |
| Owner monitoring            | Dashboards, approvals/review cases, device/backlog/gateway status, request/extraction telemetry                                                                                        | Hosted monitoring, operator alerts, actual cost reconciliation; background push not implemented                                                   |
| Camera pilot                | YOLOX/ByteTrack adapter, zones/sessionisation, replay/evaluation, observations, local clips, owner reviews, coverage gaps                                                              | Recorder inspection, model weights/licensing, hardware sizing, real streams, 500 labelled interactions and accuracy/review-time evidence          |
| Distribution and operations | Native build configuration, EAS profiles, local backup-restore verifier                                                                                                                | Production infrastructure/backups/signing, release distribution and primary-system cutover                                                        |

Deferred by the plan: grocery weighing, electronics serial numbers, multi-branch transfers, subscriptions, full accounting and automated tax filing. Current tax handling is intra-state tax-inclusive CGST/SGST; IGST, cess and specialised Schedule X dispensing are not supported. Schedule X is blocked. Verify applicable pharmacy/GST record requirements during onboarding before replacing existing records.

## Latest pass 1: supplier-invoice receiving

Main files: `apps/mobile/src/receiving.tsx`, `packages/core/src/receiving.ts`, `apps/api/src/extraction-jobs.ts`, with posting checks in the API/core engine.

- Supplier photo/PDF → one Gemini multimodal extraction → schema-validated draft → staff correction/mapping/confirmation → purchase posting. There is no separate paid OCR + LLM chain.
- Preserve extracted source fields; searchable product mapping; explicit received quantity and price units; convert purchased and free packs into base stock and exact unit costs.
- Changes to item details or relevant catalogue data invalidate line confirmation. Invoice-level adjustments need a reason and remain separate from stock cost.
- Save native receiving drafts in the existing encrypted KV store, scoped to owner/business. Resume server jobs; reuse identical documents within a business; access originals through authorised document routes.
- Backend checks completed source-job ownership, duplicate source/purchase IDs, conversions, totals, inactive/expired stock and fractional discrete units. A rejected purchase must not partially post stock.
- Automatic transient retry is bounded at two attempts; explicit owner invoice retry at three total attempts. Monthly new-job allowances apply under a business-scoped lock.

Browser evidence: synthetic Dolo invoice with 10 paid + one bonus strip became 110 tablets at ₹2.80; a ₹1 mismatch blocked posting; correcting it posted one stock lot. Draft close/reopen and narrow Hindi layout were checked. Real invoice OCR quality, source viewing and restart on phones remain unverified.

## Latest pass 2: voice-assisted selling

Main files:

| File                                 | Purpose                                                                                                                                                                       |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core/src/voice.ts`         | Shared output schemas, known Hindi/English unit and number handling, exact text parser, candidate ranking/conflict flags, idempotent result import and basket/item transition |
| `apps/mobile/src/voice-entry.tsx`    | Voice/text sheet, 28-second recording, editable item review, typed fallback, job polling/resume, labelled synthetic example                                                   |
| `apps/mobile/src/sale-entry.ts`      | Serialized private-storage snapshot of basket + remaining voice work + job identifier; save errors and recovery gate                                                          |
| `apps/mobile/src/selling.tsx`        | Voice integration, explicit physical batch/unit review, checkout gating, persisted basket updates                                                                             |
| `apps/api/src/process-extraction.ts` | Worker stages, STT checkpoint, local exact-parser path, structure calls, retry/error/audio cleanup                                                                            |
| `apps/api/src/providers.ts`          | Sarvam speech and Gemini invoice/structure adapters                                                                                                                           |
| `apps/api/src/extraction-jobs.ts`    | Deduplication, monthly job/audio reservations, model snapshot and abandoned-job recovery                                                                                      |

Processing paths:

1. **Exact typed/keyboard-dictated text:** local catalogue parser; no API call. Deliberately narrow format such as `Dolo 650 mg 6 goli; ORS 21 g 1 sachet`. Requires a unique exact active product identity, recognised quantity and supported unit. It is not a general on-device language model.
2. **Other typed text:** `POST /api/v1/extractions/text` with `{text, saleId}` → worker local parser or Gemini structure. No speech-to-text charge.
3. **Recorded speech:** `POST /api/v1/extractions` with audio, UUID `saleId` and `recordedSeconds` → Sarvam Saaras v3 codemix → persist transcript → remove operational audio → local exact parser or Gemini structure → staff review.

`GET /api/v1/voice-jobs` returns only the current actor's latest 20 jobs. Job status includes a checkpointed transcript for authorised recovery. Voice deduplication is scoped to business, employee, sale draft, version, MIME type and bytes; the same utterance for another customer's sale is a separate job.

Strength/form conflicts are flagged, unknown units remain unresolved, and no item reaches the basket without staff selection and physical-batch confirmation. Adding a reviewed voice item updates the basket and remaining-item list in the same saved snapshot. Applied job IDs prevent repeat imports into that local draft. This is not a global cross-device draft-ownership protocol.

Recovered nonempty baskets ask staff to check Orders before collecting again. Remaining voice items, unprocessed typed input, a running extraction or storage error block checkout. Browser storage is memory-only; native storage uses existing SQLCipher. Failed audio uploads can be retried while the Sell screen remains mounted; raw audio is not saved as a durable offline upload queue.

Browser evidence: synthetic ORS “packet” required choosing the actual unit; changing Dolo quantity to `४` populated four tablets; adding both consumed each item once and yielded two basket lines totaling ₹33.70. Exact typed text took the local path. Navigation away/back restored basket and pending review with the Orders-check gate. Hindi review was inspected at 390 × 844.

## AI providers, cost controls and configuration

- **Sarvam Saaras v3** is the existing recorded-speech provider. **Gemini** handles transcript structuring and supplier documents. Adapters are replaceable.
- New-install `INVOICE_MODEL` and `STRUCTURE_MODEL` examples select `gemini-2.5-flash-lite`; otherwise `GEMINI_MODEL` is the legacy fallback. **The current local `.env` still selects `gemini-2.5-flash` for both.** Do not describe the local instance as using Flash-Lite already.
- At handoff inspection, both Sarvam and Gemini keys were absent. No paid live API calls or measured AI quality/cost results exist. Provider tests use controlled responses.
- The user proposed `typesafe/jev-1.13`, quoted at $0.042/M input and $0 output. Prior research found it is a defined-option decision model, not a free-form invoice/item generator. **Jev is not integrated.** It may be evaluated for candidate selection later; keep arithmetic in code. Sources and dated pricing are in [AI-COSTS.md](AI-COSTS.md); recheck prices before business decisions.
- `INVOICE_MONTHLY_LIMIT=100`; `VOICE_MONTHLY_LIMIT=3000` new jobs per shop per India calendar month. Cached results are reused before allowance checks.
- `VOICE_MONTHLY_RESERVED_SECONDS=18000`: reserve 60 seconds per new recording for two possible 30-second attempts, allowing 300 new recordings by default. Reservations are not refunded. Typed entry remains possible after speech reservation exhaustion, subject to its own job allowance.
- Audio stops at 28 seconds in the client. The API validates a positive client-reported duration ≤30 seconds, **but does not independently decode duration**. These controls are not a verified provider-billing or rupee-spend cap.
- Successful speech is checkpointed before structuring so structure retries avoid another STT call. A crash between provider success and checkpoint can still cause one bounded repeat call. Terminal voice failures remove audio; recognised text can remain for correction.
- Model choice is frozen in the job. Output/token limits, timeout, bounded retries and usage/latency recording are present. Failed calls may cost money without returning usage. Complete provider-invoice reconciliation, page budgets and production spend alerts remain.

## Code map for continuing work

- `apps/mobile/src/App.tsx`, `app/index.tsx`, `app/_layout.tsx`: app shell/navigation.
- `apps/mobile/src/ui.tsx`, `i18n.ts`, `copy.hi.ts`: shared UI and bilingual copy. Some provider/diagnostic strings remain English.
- `apps/mobile/src/selling.tsx`: `SellScreen`, `Checkout`, `ReceiptSheet`.
- `apps/mobile/src/screens.tsx`: `OrdersScreen` and owner/customer/stock/money/review/admin screens.
- `apps/mobile/src/session.tsx`: authenticated state, commands, offline cash, sync and recovery.
- `apps/mobile/src/storage.native.ts`, `storage.web.ts`, `auth.native.ts`, `auth.web.ts`: platform persistence/auth boundaries.
- `packages/core/src/contracts.ts`, `types.ts`, `engine.ts`: operation schemas, records, permissions and domain posting rules.
- `packages/core/src/money.ts`, `receipt.ts`, `reconciliation.ts`: exact amounts/conversions, rendering and reconciliation.
- `packages/db/src/index.ts`, `schema.ts`, `migrate.ts`: business-scoped transactions, schema and migrations.
- `apps/api/src/app.ts`, `auth.ts`, `lease.ts`, `worker.ts`: routes, auth, signed offline authorisation, jobs.
- `apps/gateway/src/queue.ts`, `printer.ts`, `index.ts`: persistent backup/printing/camera gateway.
- `services/camera/`: detector adapter, sessioniser, replay/evaluation and clip extraction.

Posting currently serialises on a business-level PostgreSQL advisory lock and loads the entire tenant aggregate. It is useful pilot correctness infrastructure, but must be benchmarked with real catalogue/history sizes before claiming high-volume multi-shop scalability. Preserve atomic invoice/payment/credit/stock posting and command idempotency during refactoring.

## Verification record and evidence boundaries

These are the latest recorded results, not tests rerun solely to write this handoff:

| Check                                                                   | Latest evidence                                                                                                               |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Strict TypeScript                                                       | Passed after voice UI/backend changes                                                                                         |
| Core + authenticated PostgreSQL/API + gateway + provider-contract tests | **80 passed across seven suites**, `.data/voice-tests.log`                                                                    |
| Camera session tests                                                    | Four passed during initial implementation; not rerun for the voice-only pass                                                  |
| Expo web export                                                         | Passed after voice changes, `.data/voice-web-build.log`; output `apps/mobile/dist/`                                           |
| Android/iOS JS/Hermes export                                            | Passed after voice changes, `.data/voice-native-build.log`; output `.data/voice-native-bundles/`                              |
| Native Xcode/Gradle builds                                              | Initial implementation passed iOS simulator and Android ARM64 debug builds; **not rebuilt after receiving/voice refinements** |
| Browser                                                                 | Receiving, voice and earlier synthetic checkout walkthroughs; see detailed evidence above and VERIFICATION.md                 |
| Database restore                                                        | Initial local full restore compared 29 table counts against the same source snapshot; production backup infrastructure absent |
| Real AI, phone/printer/camera acceptance                                | Not completed                                                                                                                 |

Tests are in `packages/core/test/{engine,receiving,voice,api.integration}.test.ts`, `apps/api/src/providers.test.ts`, `apps/gateway/src/{queue,http}.test.ts`, and `services/camera/tests/test_sessions.py`.

API/domain tests include concurrent devices, duplicate checkout commands, tenant isolation/redaction, signed offline submissions, stale stock/price reconciliation, gateway recovery, revoked-device review, UPI reuse, version-bound approvals and EOD revisions. New voice tests cover contracts, units/quantities, candidates, idempotent imports, sale-scoped deduplication, quotas and speech-checkpoint reuse. Mocked provider success is not measured pharmacy accuracy. Four-hour outage evidence is a simulation, not four hours of real phones running offline.

## Running locally or on a fresh machine

Existing host at handoff inspection: API listening on **4100**, Expo preview on **8081**, PostgreSQL on **127.0.0.1:50489**. **No gateway listener on 4101.** Worker status was not verified; it has no HTTP port. Reinspect rather than assuming these processes survive. The API development command watches changes; the worker command does not, so restart a stale worker after modifying it.

Prerequisites: Node ≥22.13 (Node 26 used locally), PostgreSQL ≥16, optional Python ≥3.11 for camera. Use the existing lockfile. Fresh-machine setup is in README. Preserve an existing `.env`; do not overwrite it with the example. Secrets and local owner credentials are private and intentionally omitted here. Assisted seed credentials, when present, live in `.data/local-access.json`.

```sh
# From repository root; start only services that are not already running.
npm ci
npm run db:migrate
# Fresh database only: npm run seed, or explicitly npm run seed -- --demo
npm run dev:api
# Separate terminals:
npm run dev:worker
npm run dev:gateway
npm run web -w @counterwell/mobile
```

Synthetic isolated previews: `http://localhost:8081/?demo=owner` and `?demo=employee`. The prepared connected database uses synthetic `pilot-pharmacy`; it is not a real shop deployment. Native connected cash billing requires an Expo development build with SQLCipher; **Expo Go is unsupported**. On physical phones use a reachable LAN API URL, not localhost; see README for `apps/mobile/.env.local` and trusted origins.

```sh
# Normal verification, root directory:
npm run typecheck
npm test
# Integration tests require a separate counterwell_test database and root .env:
npm run test:integration
npm run test:camera
npm run build:web
# Native JS bundles, from apps/mobile:
npx expo export --platform ios --platform android --output-dir ../../.data/voice-native-bundles
```

`npm test`/`npm run check` alone skip opt-in database integration tests. The integration suite loads root `.env`, uses `TEST_DATABASE_URL` if supplied or replaces `/counterwell` with `/counterwell_test`, and refuses another database name. Do not point it at a real shop database.

Use absolute upload/gateway/clip directories when services run from different locations. API/worker share uploads; camera/gateway share clips. Native artifacts from earlier builds are documented in VERIFICATION.md. Check disk before native builds: an earlier four-architecture Android build filled the disk; ARM64 succeeded after removing only this project's generated intermediates.

## Concrete next pass: manual/barcode checkout and handoff

1. Inspect `SellScreen`/`Checkout`/`OrdersScreen`, session command retry handling, `order.save`/`order.offer`/`order.accept`/`checkout` contracts and domain rules. Identify actual gaps before changing working behavior.
2. Walk employee and owner flows on a narrow phone layout: search/scan → select physical batch → edit basket → hold/resume or collect. Cover repeated scanner events, unrecognised/ambiguous barcodes, camera-denied fallback, loose units, expired/out-of-stock batches and Hindi copy.
3. Exercise two authenticated employees: offer to eligible cashier, recipient acknowledgement, original dispenser attribution, stale order versions and prevention of two collectors. Offline isolation must not permit an unacknowledged handoff.
4. Verify double taps, network timeout after server commit, app navigation/restart with a pending command, receipt success, held-order resume and restored basket. Retries must reuse the original command/invoice identity; payment uncertainty must never encourage collecting twice.
5. Preserve the new voice/receiving flows. Do not replace saved draft safety with component-only state or conflate a restored draft with an unbilled sale.
6. Add focused regression tests for defects fixed, run TypeScript and the dedicated PostgreSQL integration suite, and inspect the UI. Re-export bundles when source changes. Document physical-device tests separately if unavailable.
7. Update this handoff, FEATURE-PASSES.md and VERIFICATION.md with changes and evidence. Then continue payments/credit/returns → stock → drawer/EOD → offline/receipts → camera, one pass at a time.

Longer-term blockers before selling as a primary system remain: real shop configuration and recordkeeping review; measured provider quality/cost; physical multi-phone recovery and hardware tests; secure hosting/monitoring/backups; signing/distribution; realistic data-volume performance; and production dependency/security review. The gateway currently uses HMAC verification on a trusted appliance; consider asymmetric verification before distributing appliances to unrelated operators.

## Suggested prompt for the next agent

> Continue development of Counterwell in this existing workspace. Read my original plan and docs/PROGRESS-HANDOFF.md first, then inspect the actual code. Supplier receiving and voice-assisted selling have been implemented and locally refined; do not rebuild them. Start the next pass on manual/barcode checkout and cashier handoff, improving the phone UI and validating backend permissions, concurrency, idempotency and recovery end to end. Preserve all existing files and local data, keep AI costs bounded and manual paths usable, and distinguish local/mock checks from real-provider and physical-device acceptance. Update the progress and verification documents when finished.
