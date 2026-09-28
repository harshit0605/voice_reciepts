# Local verification — 23 September 2026

| Check                                                          | Result                                                                                                                                                    |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript strict checking                                     | Passed                                                                                                                                                    |
| Domain, authenticated API, gateway and provider-contract tests | 80 passed                                                                                                                                                 |
| Anonymous camera session tests                                 | 4 passed                                                                                                                                                  |
| Expo web export                                                | Passed                                                                                                                                                    |
| Expo iOS and Android JavaScript/Hermes exports                 | Passed                                                                                                                                                    |
| iOS Debug simulator native build                               | Passed with Xcode; simulator installation and process launch succeeded                                                                                    |
| Android ARM64 Debug native build                               | Passed; development APK generated                                                                                                                         |
| Browser interaction                                            | Phone layout inspected at 390 × 844; English/Hindi navigation and owner screens checked; synthetic cash checkout generated a bill and reduced batch stock |
| Live local API                                                 | Health and authenticated operations endpoints passed                                                                                                      |
| Local gateway                                                  | Healthy, authenticated heartbeat visible in owner operations; physical printer is not configured                                                          |
| PostgreSQL backup restore                                      | Full dump restored into a fresh isolated database; 29 table counts verified against the same exported source snapshot                                     |

The API tests include five concurrent devices, competing checkouts, exact-ID retries, owner permissions, cross-business isolation, employee cost redaction, signed offline submissions, retained invalid submissions, owner rejection acknowledgement, gateway backup recovery after device revocation, duplicate UPI rejection with an owner-review case, and redacted incremental sync.

Domain checks cover exact unit/money handling, expiry and physical-batch checks, prescription register gating, duplicate UPI references, cashier acknowledgement, version-bound approvals, customer repayments, refund execution/quarantine, quarantined-stock disposal, supplier bonus quantities, price updates preserving invoices, a simulated four-hour outage, stale prices/stock, EOD revisions, all-device EOD acknowledgement, camera candidate matching, fiscal-year rollover and escaped receipts. Gateway checks include persistence across restart, uncertain prints, duplicate/collision handling, signed print access and restricted backup/clip/camera routes.

## Local artifacts

- Android development APK: `apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk` (ARM64; requires the Expo development server, not a standalone production release).
- iOS simulator app: `.data/ios-build/Build/Products/Debug-iphonesimulator/Counterwell.app` (not an iPhone-signed IPA).
- Native JS exports: `.data/native-bundles/`.
- Web export: `apps/mobile/dist/`.
- Test/build logs and private backup verification manifest: `.data/`.

The initial four-architecture Android build exhausted host disk space. Only this project's generated intermediates were removed; source, databases, the completed iOS app and unrelated projects were preserved. The subsequent ARM64 build succeeded. Disk headroom still needs attention before large further builds.

## Evidence boundaries

Compilation and automated tests do not establish physical-phone outage endurance, cryptographic storage behaviour on each target phone, real printer/PDF correctness, live recorder compatibility, provider accuracy, throughput with long shop histories, production hosting, or legal recordkeeping suitability. Native UI operation through the simulator could not be inspected through the available computer-control surface. No 300-utterance or 500-interaction dataset was supplied; no accuracy claim is made. Follow [PILOT.md](PILOT.md) before primary-system cutover.

## Supplier receiving refinement pass

Strict TypeScript, 68 tests across six suites, and web/iOS/Android JavaScript exports passed after the receiving changes. The native Xcode/Gradle builds above belong to the initial implementation; this pass did not rebuild native binaries or claim a physical-phone run.

New tests cover purchased/free pack conversion, exact price conversion, source-field preservation, stale catalogue confirmation, tampered conversions, explicit invoice adjustments, atomic failure, reused purchase IDs, duplicate upload concurrency, per-business quotas, restricted retry, abandoned-worker attempt limits and provider response contracts. Provider-contract tests replace external services with controlled responses; no paid live API requests were used.

Browser walkthrough: loaded an explicitly synthetic invoice, selected Dolo 650 mg, converted 10 purchased plus one bonus strip into 110 tablets at ₹2.80 each, confirmed the item, closed/reopened the draft, blocked posting with a ₹1 mismatch, corrected the total, and posted exactly one 110-tablet stock lot. Inspected the Hindi receiving surface at 390 × 844. Web draft persistence here means closing/reopening within the same browser session, not surviving reload or browser exit; native storage uses the existing encrypted SQLite implementation.

Remaining receiving acceptance: real invoice extraction and image/PDF source opening on target phones; native draft restart recovery; broad supplier layouts, month-only expiry handling confirmed by staff, and long multi-page invoices. There is no camera document-capture/crop UI. Receiving page/spend budgets and complete cost reconciliation remain future work; invoice limits are new-job allowances. The voice pass below adds conservative audio reservations.

## Voice-assisted selling refinement pass

Strict TypeScript and 80 tests across seven suites passed. Fresh web and iOS/Android JavaScript/Hermes exports passed, with logs `.data/voice-web-build.log` and `.data/voice-native-build.log`; native bundles are in `.data/voice-native-bundles/`. Native Xcode/Gradle binaries were not rebuilt in this pass.

Added coverage: known Hindi/English quantities and units, ambiguous units, inactive/duplicate catalogue identities, strength/form conflicts, malformed model output, result-import idempotency, basket/draft atomic transitions, sale/actor-scoped deduplication, recent-job access isolation, concurrent allowance enforcement, typed requests after speech quota exhaustion, exact-text worker processing with no external call, durable STT checkpoint reuse after a structure 503, and terminal-failure transcript retention. Worker/provider tests use controlled dependencies, not live AI.

Browser walkthrough used an explicitly synthetic sample. ORS “packet” could not be added until an actual unit was chosen; physical-batch confirmation was required. Editing Dolo quantity to “४” populated four tablets; adding both items yielded exactly two basket lines (₹33.70) and consumed both pending items. Entering “Dolo 650 mg 2 goli” produced a local draft with no API call. Leaving Sell for More and returning restored the two basket lines and pending voice item, with an Orders-check recovery gate. Hindi review was visually inspected at 390 × 844. This verifies in-session browser recovery, not native restart durability.

Remaining: real microphone capture/upload on Android and iPhone; interrupted native draft recovery; provider keys and 300 consented labelled utterances for quality/latency; independently decoded audio duration and provider billing reconciliation. Raw failed audio uploads are retained only while the screen is mounted, not persisted for offline retry after app exit. No live Sarvam/Gemini calls or accuracy claims were made.

## Checkout double-billing fixes

Strict TypeScript and 94 tests across nine suites passed, including the PostgreSQL/API suite (`.data/checkout-fix-tests.log`). Fresh web and iOS/Android JavaScript/Hermes exports passed (`.data/checkout-fix-web-build.log`, `.data/checkout-fix-native-build.log`, bundles in `.data/checkout-fix-native-bundles/`). Native binaries were not rebuilt.

Added coverage (`packages/core/test/checkout-recovery.test.ts`, `apps/mobile/src/storage.web.test.ts`): recovery of a local cash sale committed before a crash; an online checkout whose response was lost, found before the retry resolves; a basket locked only by its own unanswered command; a queued but unprojected cash sale; a handed-off order releasing the draft; routing cash through the server order once a basket has been sent; the engine refusing a second invoice for that order; key-order-independent held-order matching; and a local cash commit that is never queued twice or given a second invoice number.

Browser walkthrough (demo employee, 390 × 844): a double-clicked cash Confirm produced one bill. A UPI attempt rejected for a reused reference, then switched to Cash, produced one bill for the same order and left no stray held order (Open · 0; previously a separate cash bill plus an orphaned held order). Hold, then Collect from Orders, produced one bill. There were no console errors.

Not exercised in the UI: the no-response lock banner, **Check now** and **Set aside** against the live API, which need a signed-in connected session and a dropped response. Native crash-between-commit-and-clear recovery also needs a development build on a phone. Both paths are covered by the domain tests above, not by device evidence. The rejected UPI attempt still consumed an invoice number (bill 000003 was skipped); see the remaining checkout gaps in the handoff.

## Checkout pass, part 2 (28 September 2026)

Strict TypeScript and 110 tests across ten suites passed with the PostgreSQL/API suite. New coverage: stranded-handoff rules (decline, recall, owner takeover, cancel, cancelled orders unbillable online and offline), GS1/EAN scan parsing and batch matching, invoice-number release rules, the `INVOICE_NUMBER_USED` API code, and reprinting a synced offline bill at the gateway.

**iPhone 17 Pro simulator (iOS 26.5), connected to the local API, ad-hoc signed debug build (`.data/ios-signed-build.log`):**

- Signed in as the local seed owner; the header showed "Up to date".
- Local cash sale: **first attempt failed** with the SQLCipher/second-connection defect (fixed in `bf5bdd6`). After the fix and an app restart, the same pinned attempt billed exactly once: bill `2627-002-000001`, one server invoice, one cash payment, stock 32 → 31.
- No-response path: API stopped, UPI checkout attempted → "No response from the server…", Confirm/Hold disabled, and switching to Cash kept Confirm disabled. The Sell screen showed the lock banner with Check now / Set aside. API restarted → Check now → "An action that had no response is now confirmed as saved" and the basket unlocked. The server had one held order and no invoice (the checkout never reached it), so nothing was double-billed.
- Found the sheet tap-through defect (a double tap parked the sale as a held order); fixed in `8e87dbd` and re-verified: a tap during the opening animation and a quick double tap both left checkout open, then cash billing produced `2627-002-000002`.
- Basket → checkout → receipt modal chaining worked on iOS; no dropped sheets.

**Android emulator (Medium Phone, API 36):** the existing debug APK installed and loaded the current JS through `adb reverse` (login screen rendered correctly). Interactive testing was blocked: the host load average reached 73 from unrelated jobs, and the app hit input-dispatch ANRs ("Application does not have a focused window"). Another installed app also opened a system "display over other apps" page mid-test; it was left untouched. **No Android billing evidence yet.**

Not exercised: camera scanning on a device (the simulator has no camera and the browser pane blocks it; scan logic is unit-tested), PDF sharing, gateway printing, and "Set aside".
