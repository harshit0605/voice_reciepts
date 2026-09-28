# Counterwell — development progress and agent handoff

Snapshot: 28 September 2026, after the checkout pass, catalogue import and opening stock count (checked on two iOS simulators; the latest work is not yet re-checked on Android). Read alongside the user's original **Pharmacy-first retail operations app** plan. This document describes the current implementation and evidence; the plan describes the intended product. Local source and a fresh inspection take precedence if development has continued since this snapshot.

## Start here

- Workspace: `/Users/harshit/Code/Agency/voice_reciepts` (the directory spelling is intentional).
- An implemented pilot monorepo already exists. Continue it; do not scaffold a replacement app.
- **Git was initialised on 23 September 2026** (local `main`, no remote). The first commit is the pre-existing implementation; later commits are the checkout pass. `.data/`, `.env` and generated native projects stay ignored. Preserve the private local data.
- Completed passes: **supplier-invoice receiving**, then **voice-assisted selling**. Their implementation and local checks are complete, but their live-provider and physical-device acceptance is not.
- **Code is on GitHub:** `git@github.com:harshit0605/voice_reciepts.git` (`main`, **public repository**). Secrets and `.data/` are git-ignored and were scanned before the first push.
- **Checkout/handoff pass and catalogue import: done**, device-checked on iOS and Android (see "Catalogue import").
- **Opening stock count: done**, checked on iOS with printing, PDF sharing and a two-phone owner → cashier handoff (see "Opening stock count and two-phone checks"). Android re-check is pending. Next: payments/credit/returns.
- **Shared bill PDF** is now receipt-sized and states what was paid (checked on iOS). **Shop PC remote setup** exists for the shop's Windows PC (Tailscale, key-only SSH, gateway tools); see [SHOP-PC-SETUP.md](SHOP-PC-SETUP.md). It has not run on the real PC yet.
- **Invoice reading works live** through OpenRouter when there is no Google key, after two fixes (shape-only schema; clearer MRP and expiry rules). Checked on six sample-invoice images; a real distributor bill is still needed. Android checks need the host load well below 50.
- No production deployment, store cutover, paid-provider evaluation, TestFlight upload or Play internal release has happened.

Suggested reading order: this document → [README](../README.md) → [architecture/API](ARCHITECTURE.md) → [verification evidence](VERIFICATION.md) → [feature sequence](FEATURE-PASSES.md) → [AI costs](AI-COSTS.md) → [pilot gates](PILOT.md).

## Product decisions to preserve

One React Native Android/iOS app, with employee Sell, Orders, Stock, Customers and More; owners also have Overview, Inventory, Money, Reviews and Administration. India, INR, Asia/Kolkata, Hindi/English, initially one store and shared drawer per business. Username/password on employees' personal phones, assisted onboarding, no public signup, strict business isolation.

The user's latest priority is to improve **one existing feature at a time**, including UI, backend correctness and recovery. Target customers may pay only a few hundred or thousand rupees monthly. Use replaceable APIs for v1, control usage, and consider self-hosted/open models later if measured costs justify it. Preserve manual entry when AI is unavailable. Keep the current restrained teal, phone-first UI consistent rather than redesigning the whole product.

Capture **actual supplied items**, not an automatically fulfilled prescription. Voice only produces a draft. The employee confirms medicine, strength, formulation, quantity, unit and physical batch. Never automatically substitute or finalise from AI output. Invoice extraction also requires human review before stock posting.

Keep sales, collections, dues and shared-drawer shortage separate. Attribute recorded actions to employees; drawer shortages do not establish individual theft. Existing merchant UPI QR is manually verified, not provider-confirmed. Credit exposure and financial exceptions need online owner approval. Camera observations are owner-reviewed evidence candidates in a silent pilot: no employee scoring, facial recognition or automatic theft verdicts.

## Current feature status

“Implemented” below means code exists, not that all original acceptance tests have been satisfied.

| Area                        | Implemented now                                                                                                                                                                                                         | Remaining or not established                                                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accounts and isolation      | Better Auth username login, assisted owner seed, owner-created employees, temporary-password replacement, memberships, collection permissions, devices, server-side tenant/role checks                                  | Production onboarding, security review and real multi-shop operations                                                                             |
| Sell and orders             | Search, camera barcode path, batch selection/confirmation, loose units, quote, held orders, versioned acknowledged cashier handoff, checkout, invoice snapshots, draft-pinned checkout identity with automatic recovery | Rest of the checkout pass (below); physical scanner/camera operation and live uncertain-response walkthroughs                                     |
| Supplier receiving          | Document uploads, extraction jobs, editable reviewed draft, product mapping, paid/bonus pack conversion, source opening, native autosave, resumable jobs, posting safeguards                                            | Real provider documents, physical-device source opening/restart, diverse invoice layouts; no camera capture/crop UI                               |
| Voice selling               | Recording and typed-entry paths, local exact parser, editable compact review, product candidates/conflict warnings, saved draft/basket, resumable jobs, STT checkpoint, usage controls                                  | Live speech accuracy/latency, microphone on target phones, durable failed-audio upload queue, independent media-duration verification             |
| Payments and credit         | Cash/manual UPI/mixed payments, duplicate-reference checks, approved credit/discounts, customer ledger and repayments                                                                                                   | Dedicated UI/backend refinement and real operating validation; no UPI provider integration                                                        |
| Returns and approvals       | Owner approvals, separate refund execution, linked returns, quarantine and reviewed disposal                                                                                                                            | Dedicated operational refinement and shop acceptance                                                                                              |
| Inventory                   | Catalogue/units/aliases/barcodes, batches/cost/MRP/prices, opening counts, supplier purchases/bonus quantities, movement rules and stock corrections                                                                    | Large real catalogue ingestion, physical counts and complete receiving/expiry operating validation                                                |
| Drawer and EOD              | Opening/closing counts, recorded cash movements, reconciliation, separate sales/collections/dues, provisional/revised reports                                                                                           | Dedicated refinement; actual shared-drawer process and multi-phone closing exercise                                                               |
| Offline and sync            | Native SQLCipher, durable sequence/outbox transaction, signed 24-hour authorisation, idempotent replay, gateway backup, revoked-device review, redacted incremental sync                                                | Four-hour physical-phone test, power-loss/restart/reinstall tests, gateway outage exercise; browser memory storage is not durable offline billing |
| Receipts and printing       | Invoice HTML/PDF path, authenticated gateway print queue, status, explicit audited reprints                                                                                                                             | Physical Epson/Hindi/PDF checks from Android and iPhone; no printer configured                                                                    |
| Owner monitoring            | Dashboards, approvals/review cases, device/backlog/gateway status, request/extraction telemetry                                                                                                                         | Hosted monitoring, operator alerts, actual cost reconciliation; background push not implemented                                                   |
| Camera pilot                | YOLOX/ByteTrack adapter, zones/sessionisation, replay/evaluation, observations, local clips, owner reviews, coverage gaps                                                                                               | Recorder inspection, model weights/licensing, hardware sizing, real streams, 500 labelled interactions and accuracy/review-time evidence          |
| Distribution and operations | Native build configuration, EAS profiles, local backup-restore verifier                                                                                                                                                 | Production infrastructure/backups/signing, release distribution and primary-system cutover                                                        |

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
| Core + authenticated PostgreSQL/API + gateway + provider-contract tests | **94 passed across nine suites** after the checkout fixes, `.data/checkout-fix-tests.log`                                     |
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
# Printing without a printer: a local ePOS stand-in saves each receipt as a PNG in .data/printer
node scripts/fake-printer.mjs
PRINTER_HOST=127.0.0.1:8090 npm run dev:gateway
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

## Checkout pass, part 1: double-billing fixes (done)

Main files: `packages/core/src/checkout-recovery.ts` (pure, tested), `apps/mobile/src/selling.tsx` (`SellScreen`, `Checkout`), `apps/mobile/src/session.tsx`, `storage.native.ts`/`storage.web.ts` (`commitCash`).

Three defects were fixed. Each could bill one basket twice:

1. **A timed-out online checkout followed by Cash.** `cashSale` ignored the pending uncertain command and minted a new order and invoice. The error message even said cash billing could continue.
2. **Reopening Checkout after an uncertain result.** The held order lived only in component state, so a new order and invoice were created.
3. **A crash between the local cash commit and the draft clear.** Only a dismissible "check Orders" banner stood in the way.

How the fix works:

- `SaleEntry.checkout` (`CheckoutAttempt`: `orderId`, `cashCommandId`, `online`) is saved in the encrypted draft **before** anything is sent. Every retry, method change and restart reuses it.
- Once `online` is set, the basket is billed only through its server order, where the engine allows one checkout per order. `billsLocally()` enforces this.
- `commitCash` refuses a command ID already in the outbox, inside its exclusive transaction.
- `recoverCheckout()` decides from state, outbox and the uncertain command what happened to the attempt: `billed`, `saved_locally`, `elsewhere`, `uncertain`, `held` or `unsent`.
  - The Sell screen shows the receipt for a billed attempt, clears finished ones, and locks the basket while its own payment has no answer, offering **Check now** and **Set aside**.
  - Set aside keeps the uncertain command for exact-ID replay, which records a payment that was physically taken, and tells staff not to bill the items again.
- A network failure on a command now says the action may already be saved and not to collect again. Sync reports whether an unanswered action was confirmed or not saved.
- The manual "I checked Orders" gate remains only for drafts saved before this change (`checkoutInterrupted` without `checkout`).

Evidence: see VERIFICATION.md. Not yet exercised: the lock banner against the live API, and native crash recovery on a phone.

## Checkout pass, part 2 (done, 28 September 2026)

Each item is its own commit on `main`:

| Item                                | Change                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Receipt state (`beb4e31`)           | `ReceiptSheet` resets print ID/status/reprint fields when the invoice changes and ignores late responses for a previous bill. The gateway compares only printed bill content for a reused print ID, so a synced offline bill (new `postedAt`, redacted costs) can still be reprinted.                                                                                                                                         |
| Invoice series gaps (`04c578f`)     | A definitely rejected online checkout hands its reserved number back while it is still the latest (`releaseSequence`). An issued-number collision now has its own `INVOICE_NUMBER_USED` code (still 409) so that number is never handed back. The app syncs right after sign-in/restart instead of waiting up to 30 s.                                                                                                        |
| Stranded handoffs (`2ea798f`)       | New `order.decline` (recipient), `order.recall` (offerer, or an owner taking over any open order, audited) and `order.cancel` (collector or owner, reason required; cancelled orders cannot be billed online or offline). Orders shows Accept/Decline, Take back, Take over, Cancel order and a Cancelled list with who/when/why.                                                                                             |
| Barcode scanning (`c21ba60`)        | `packages/core/src/scan.ts` parses EAN/UPC and GS1 DataMatrix/QR (GTIN, batch, expiry). Products hold several comma-separated barcodes. An exact match opens the batch sheet with the scanned pack's batch preselected; expired/unrecorded/stockless batches, shared codes, unknown codes and denied camera permission each get a clear message (Open Settings when the OS will not ask again). One scan per scanner opening. |
| Speed (`4964ea8`)                   | One "Batch X checked · Add" button replaces the tick + Add (7 taps instead of about 9 for a 2-item cash sale on a phone). Cash checkout has optional cash received, quick amounts, change to return, and refuses a short payment.                                                                                                                                                                                             |
| iOS font clipping (`f259400`)       | Render after DM Sans loads; text was clipped on iOS.                                                                                                                                                                                                                                                                                                                                                                          |
| **Native cash billing (`bf5bdd6`)** | **Every local cash sale failed on a device** ("file is not a database"): expo-sqlite's `withExclusiveTransactionAsync` opens a second connection that never gets the SQLCipher key. Storage now runs every call on the one keyed connection through a serial queue with explicit `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK`. Unit tests and the in-memory web store could not catch this.                                          |
| Sheet tap-through (`8e87dbd`)       | A quick second tap on "Review & collect" landed on "Hold order" in the newly opened checkout and silently parked the sale. Sheets ignore touches for 400 ms after opening.                                                                                                                                                                                                                                                    |

Still open in this pass:

- Android: done on 28 September (see VERIFICATION.md). The native cash sale synced once; the no-response lock was checked on iOS only.
- A basket is locked while its own payment has no answer; "Set aside" is covered by tests but was not exercised on a device.
- Tap count could drop further with a one-tap "exact cash" path and search-as-you-type add; measure with staff first.
- iOS `Share PDF` and gateway printing (to a local ePOS stand-in, not a physical Epson) were exercised on 28 September; Android was not.

Original checklist for the pass:

1. Inspect `SellScreen`/`Checkout`/`OrdersScreen`, session command retry handling, `order.save`/`order.offer`/`order.accept`/`checkout` contracts and domain rules. Identify actual gaps before changing working behavior.
2. Walk employee and owner flows on a narrow phone layout: search/scan → select physical batch → edit basket → hold/resume or collect. Cover repeated scanner events, unrecognised/ambiguous barcodes, camera-denied fallback, loose units, expired/out-of-stock batches and Hindi copy.
3. Exercise two authenticated employees: offer to eligible cashier, recipient acknowledgement, original dispenser attribution, stale order versions and prevention of two collectors. Offline isolation must not permit an unacknowledged handoff.
4. Verify double taps, network timeout after server commit, app navigation/restart with a pending command, receipt success, held-order resume and restored basket. Retries must reuse the original command/invoice identity; payment uncertainty must never encourage collecting twice.
5. Preserve the new voice/receiving flows. Do not replace saved draft safety with component-only state or conflate a restored draft with an unbilled sale.
6. Add focused regression tests for defects fixed, run TypeScript and the dedicated PostgreSQL integration suite, and inspect the UI. Re-export bundles when source changes. Document physical-device tests separately if unavailable.
7. Update this handoff, FEATURE-PASSES.md and VERIFICATION.md with changes and evidence. Then continue payments/credit/returns → stock → drawer/EOD → offline/receipts → camera, one pass at a time.

Longer-term blockers before selling as a primary system remain: real shop configuration and recordkeeping review; measured provider quality/cost; physical multi-phone recovery and hardware tests; secure hosting/monitoring/backups; signing/distribution; realistic data-volume performance; and production dependency/security review. The gateway currently uses HMAC verification on a trusted appliance; consider asymmetric verification before distributing appliances to unrelated operators.

## Catalogue import (done, 28 September 2026)

Main files: `packages/core/src/catalogue.ts` (pure, tested), `apps/mobile/src/catalogue-import.tsx`, `apps/mobile/src/product-form.tsx`, and the `catalogue.import` operation in `contracts.ts` and `engine.ts`.

- **Where:** Inventory → Import catalogue (owner only).
- **Input:** choose an `.xlsx` or CSV/TSV file (≤15 MB, ≤20,000 rows), or paste spreadsheet rows. Old `.xls` files are refused with a "save as .xlsx or CSV" message. `.xlsx` is read with `fflate` (MIT, no dependencies).
- **Columns:** the header is found below report titles and columns are guessed from common Indian pharmacy export names. The owner can move the header row and re-map any column (Hindi labels included).
- **Units:** pack text (`10's`, `1x15`, `10x10`, `100ML`) becomes the base unit plus strip/box conversions. Unknown forms are sold per piece, with a warning.
- **Review:** New / Check / Already added / Repeated / Errors, with spreadsheet row numbers and reasons.
  - Matching uses brand, strength and form ("DOLO 650 TAB" = "Dolo" + "650 mg" tablet; a syrup and a suspension stay different) and barcodes.
  - The same medicine with a different pack is skipped with a warning, never merged.
  - GST comes only from the file, or from an explicit default that is flagged.
  - Barcodes in Excel scientific notation are dropped with a warning.
  - No schedule column means OTC, with a warning to mark H/H1 afterwards.
- **Saving:** chunks of 200 via `catalogue.import` (≤250 per command, owner-only, all-or-nothing, never changes existing products). An interrupted import can be re-run; it sends only what is left. Command records larger than 4 KB now store a hash instead of the full body; `sameFingerprint` accepts old full records.
- **Unmatched invoice lines:** receiving offers "Add as new medicine", prefilled from the invoice line; saving maps the line.
- **Large lists:** Sell and Inventory group batches once and render 50 products (in stock first). Search matches every typed word.
- **Not done:** stock quantities are not imported (opening counts stay per batch and physical). Selling/MRP prices come with stock, not the catalogue.

Next: the opening stock count (below), then payments/credit/returns.

## Opening stock count and two-phone checks (done, 28 September 2026)

Main files: `packages/core/src/opening.ts` (pure, tested) and `apps/mobile/src/stock-count.tsx`; `stock.opening` in `engine.ts` refuses a repeated batch code.

- **Where:** Inventory → Count stock (owner only). The per-product "Record opening batch count" uses the same form.
- **List:** "X of Y medicines have counted stock", Not counted yet / All, word search, and Scan. A GS1 DataMatrix scan opens the product with batch and expiry filled in.
- **Form:** batch number, expiry as printed (`04/27`, `EXP 02/2028`, `Apr-27`, `12.2026` or a full date; month-only means month end), counted quantity in strips or tablets, MRP per strip or tablet, optional selling price and purchase cost. A live preview shows the base-unit count and per-tablet price.
- **Rules:** refuses a batch already in stock (use a stock adjustment instead), an expired batch (keep it aside for return or disposal), fractional tablets, a price above MRP and a missing MRP. Flags stock expiring within 3 months. Per-tablet prices round **down** to whole paise, so a full strip never bills above the printed MRP; the preview says when that happens.
- **After saving:** "Saved: …" with "Count another batch of this medicine", and the list moves to the next uncounted medicine.
- **Search ranking** (Sell, Inventory, Count): exact word > word prefix > substring, and numbers only match from the start of a word, so "paracet 50" finds PARACET 50 and 500 but not 150. Scores are cached per product (about 44 ms → 8 ms per keystroke with 1,685 products).

Found and fixed during the iOS device checks:

- **Temporary passwords left the new employee stuck on "Loading shop…"** (every new employee hit this). Changing the password signs out every session, including the phone's own, but the API wrapper dropped the replacement session cookie. The phone now calls Better Auth's `change-password` directly, so the cookie is stored. A server hook always signs out other sessions and clears the temporary-password flag only after a successful change (`apps/api/src/auth.ts`). An integration test covers it and fails without the fix.
- **Handoffs were invisible to the cashier** for up to 30 s, and then only on the Orders screen. The app now refreshes every 8 s while open, never letting an older answer overwrite newer state. A handoff shows an "An order was handed to you · Open" banner on every screen and a count on the Orders tab. Checked: the banner appeared within 9 s.
- **Orders showed "1 items · Shop owner"**, with no way to tell orders apart. Rows now list the medicines and total. The collect sheet lists the medicines, batch and quantity, so the cashier can check them before taking money.
- The keyboard covered search results in sheets, and the first tap after typing was swallowed. Number pads now close by dragging, the saved banner scrolls into view, and PDFs are named `Bill <number>.pdf`. Hindi unit and form names now appear inside composed text.

Known and harmless: in development builds, better-auth's Expo client logs "Cannot find module 'expo-network'" (optional; it assumes online). `tsc -p apps/mobile` alone reports two older type errors (`receiving.tsx` product-from-invoice-line, `signOut()` arguments) that the root `npm run typecheck` does not; worth fixing separately.

## Suggested prompt for the next agent

> Continue development of Counterwell in this existing workspace (git remote `origin`, branch `main`). Read my original plan and docs/PROGRESS-HANDOFF.md first, then inspect the actual code. Receiving, voice selling, checkout/handoff, catalogue import and the opening stock count are implemented and checked on simulators; do not rebuild them. First re-check the count flow, handoff banner, printing and PDF sharing on Android when the machine is not overloaded. Then do the payments/credit/returns pass. Preserve local data, keep AI costs bounded and manual paths usable, and distinguish simulator checks from physical-device and real-shop acceptance. Update the progress and verification documents when finished.
