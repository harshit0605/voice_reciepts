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

## Catalogue import and Android checks (28 September 2026)

Strict TypeScript and 129 tests across eleven suites passed with PostgreSQL. New coverage:

- file decoding (UTF-8/BOM, UTF-16, Windows-1252), CSV/TSV/pasted rows and `.xlsx` sheets;
- header detection, column guessing and pack-to-unit conversion;
- new/existing/repeat/error planning, including barcode matching, default GST, scientific-notation barcodes and form-aware matching;
- word search;
- `catalogue.import` owner-only and all-or-nothing, with a hashed receipt recognised on retry and a 250-product API chunk.

Test data: a synthetic 2,102-row export (`SYNTHETIC MEDICAL STORE` title rows; header on row 4) produced 1,679 new, 1 existing, 420 repeated and 2 error rows. It was generated for this check and is not a real distributor list.

**Web demo:** all 1,679 imported in 0.5 s. Sell showed "Showing 50 of 1,685" and word search worked. "Add as new medicine" prefilled from the sample invoice line and, once saved, mapped the line.

**iPhone 17 Pro simulator (local API):**

- Picked the `.xlsx` through the iOS Files picker; header and columns were detected.
- Imported 1,679 products in 9 commands in about 7 s. PostgreSQL then held 1,685 distinct products and 9 hashed receipts (the command table is 7.9 KB).
- After a cold start, Sell listed in-stock items first with "Showing 50 of 1,685" and found `NIMU 350 CAP` by typed words. Its Add is disabled until stock is counted.

**Android emulator (Medium Phone API 36, existing debug APK, JS from Metro, host load about 17):**

- Signed in and loaded all 1,685 products; Hindi and English Sell screens rendered.
- The basket → checkout → receipt chain worked, with quick cash amounts and change ("Return to customer ₹6.50").
- **Native encrypted cash sale:** bill `2627-003-000001`, synced once. The server has one invoice, one ₹3.50 cash payment, and Cetirizine stock went 140 → 139.
- Picking the same `.xlsx` through the Android document picker read it correctly (New 0 / Already added 2,100) in about 5 s on the emulator.

**Evidence boundaries:**

- The Android no-response lock, "Set aside", PDF sharing, printing and camera scanning were not exercised on devices.
- `uiautomator` crashed several times when inspections overlapped, and taps were briefly ignored during that time. This is test-tool noise, not an app crash, but it should be re-checked on a physical phone.

## Opening stock count, printing and two-phone handoff (28 September 2026)

Strict TypeScript, 113 unit tests and the 26-test PostgreSQL/API suite passed. New coverage:

- printed expiry formats and impossible dates;
- strip ↔ tablet conversion with a per-strip MRP;
- round-down pricing, so a full strip never exceeds MRP;
- refusal of repeated, expired, fractional and over-MRP counts, including the engine refusing a repeated batch code;
- search ranking;
- replacing a temporary password: the old session is signed out, the replacement cookie works, and the flag clears only after a successful change. The test fails against the previous auth configuration.

**iPhone 17 Pro simulator (owner, local API):**

- **Count stock:** PARACET 50 TAB, batch `PC2609`, expiry `09/27`, 12 strips at ₹25 per strip. The server holds 120 tablets at 250 paise each with an opening movement. Recounting the same batch was refused, and the message was checked in Hindi.
- **Sale:** 1 strip, cash ₹30 received, ₹5 change, bill `2627-002-000003`.
- **Printing:** through the gateway to `scripts/fake-printer.mjs` (a local ePOS stand-in, not an Epson). The receipt image was correct. An audited reprint with a reason printed "COPY · 2627-002-000003", and the gateway audit row links to the original.
- **Share PDF:** opened the iOS share sheet as `Bill 2627-002-000003.pdf`. Its content was correct: taxable ₹22.32 + CGST ₹1.34 + SGST ₹1.34 = ₹25.

**Two phones: owner on the iPhone 17 Pro, new cashier on an iPhone 17e simulator:**

- **New employee:** the owner created the account. On first sign-in, "Set your password" appeared.
  - **Defect:** after a successful change, the phone hung on "Loading shop…". The server showed the change succeed, then `/me` returned 401.
  - After the fix, a second new employee went from temporary password → new password → Sell screen. Server log: `change-password 200`, `/me 200`, `devices/register 200`, `state 200`.
- **Handoff and collection:**
  - The owner held Cetirizine (1 strip) and handed it to the cashier.
  - Before the fix, it reached the cashier's Orders screen only on the next 30 s poll, with no signal.
  - The cashier accepted and collected ₹35 cash (₹50 received, ₹15 change). Result: bill `2627-004-000001` (the cashier phone's own series), dispenser **Shop owner**, collector **cashier**, and one cash payment.
  - The receipt printed from the cashier's phone through the gateway with batch, expiry, HSN and CGST ₹1.87 + SGST ₹1.88.
  - Cetirizine stock went 139 → 129 tablets.
- **After the handoff fix:**
  - The banner and an Orders badge appeared on the cashier's Sell screen within 9 s of the owner's handoff.
  - Order rows list the medicines and total.
  - The collect sheet lists "Dolo 650 mg · 1 tablet · DOL2401".
- **Employee limits:** the cashier's Stock screen is read-only, with no Count stock, Import or Add. More shows only counter assignment, their own cash collections (₹35.00), sync and language.

**Evidence boundaries:**

- **Android:** not re-run for this pass. Unrelated jobs pushed the host load average to 80–238. At about 78, the emulator's system server stopped responding, restarted, and dropped typed sign-in characters.
- **Not exercised on any device:** the count flow's camera scan (DataMatrix parsing is unit-tested); printing to a physical Epson; Hindi receipts on paper.

## Receipt PDF, shop PC setup and invoice images (28 September 2026)

**Share PDF (iPhone 17e simulator, cashier):**

- **Defect:** the shared PDF was a US Letter page (612 × 792 pt) with the bill squeezed into its top-left corner.
- **Fix:** the page is now 300 pt wide and as tall as the bill (`receiptPage`). Heights were checked against browser layout for 1, 3, 6, 10 and 15 lines, with long medicine names and a long address; every case had spare room and none needed a second page.
- **Contents:** the PDF names the customer and states "Paid ₹35.00 by cash", or the balance due, from the recorded payments.
- **Checked:** bill `2627-004-000001` produced a 300 × 382 pt PDF. The share sheet thumbnail showed the whole receipt, and **Save to Files** stored `Bill 2627-004-000001.pdf` in the simulator's Files storage.
- **Test-tool note:** a Metro reload while the iOS share sheet is open leaves the development app ignoring taps until it is restarted. Development builds only.

**Shop PC setup:** `scripts/windows/test-shop-pc-setup.ps1` passes 26 checks under PowerShell 7.6 on macOS:

- the generated file parses as Windows PowerShell 5.1 would accept, is plain ASCII and uses CRLF;
- a fresh run, a second run and the fallbacks behave as expected, against stand-ins for Windows commands;
- deliberately turning SSH password sign-in back on makes the test fail.

It has **not** run on a real Windows PC yet. The one-line version downloads the script from GitHub at a pinned commit; its SHA-256 matched the local file.

**Invoice reading from real-looking images (OpenRouter, Gemini 2.5 Flash, through the real upload → job → worker path):**

- **Images:** Busy's three public sample pharmacy invoices and phone-photo versions of them (skewed, rotated, uneven light, JPEG quality 58). They are in `.data/real-invoices` (git-ignored; not ours to publish). Each has the same three lines, with batch, expiry, HSN, discount and GST.
- **First run failed on every file:** Google refused the invoice schema as too complex for constrained decoding. The cause was the 500-line limit and zod's safe-integer bounds. The direct Gemini path sends the same schema, so it had never worked live either. The model now gets the shape only; zod still enforces every limit, and malformed replies are still rejected without a second call.
- **Second run:** the instruction said to leave month-only expiry blank, and the model ignored it. It also filled MRP from "List Price" on one run but not another, which could turn a purchase rate into the MRP. The instruction now:
  - takes MRP only from a column labelled MRP;
  - reads `12/26` as `2026-12-31`, as the stock count does;
  - puts free quantity in bonus.
    The extraction version is now `receiving-v3`.
- **Final run, all six images:**
  - Supplier, GSTIN, invoice number and date, the ₹231 total, names with strength, quantities, GST and line amounts were right on every image.
  - MRP was left blank, which is correct because there is no MRP column.
  - Batch numbers were right except on the "Modern" template, which itself prints two batches on one row. Staff review would catch it.
  - Cost was $0.0014–0.0022 and time 3.6–5.6 s per invoice.
- **Flash-Lite** read the same fields at about $0.0005, but copied `1.` quantities and line breaks literally. Importing a draft now cleans those.
- **Not established:** a dense real distributor bill (20+ lines, free quantity, PTR), multi-page PDFs and handwritten corrections. `npm run evaluate:invoices -- <files>` reruns this on any bill.

**Android:** the emulator booted, but the host load average stayed between 55 and 95. The guest reported a load of 53 and did not bring the app to the foreground within 2 minutes. No Android evidence for this pass.

**Phone upload, sign-out and ended sessions (iPhone 17e simulator, 28 September 2026, evening):**

- **Invoice and voice uploads never left a phone.** Expo's native `fetch` refuses React Native's `{ uri, name, type }` file parts ("Unsupported FormDataPart implementation"). The app showed only "Connection unavailable". This was found by uploading a bill photo from Files as the owner.
  - After the fix (`apps/mobile/src/upload.ts`), the same photo uploaded and was read in 4.5 s. The review draft showed the supplier and GSTIN, invoice 0001/25-26, 2025-08-05, ₹231 and 3 lines, with a ₹0.00 difference.
  - Posting stayed disabled until each line was matched to the catalogue. The draft was discarded, not posted.
  - Voice uses the same helper. It is unverified end to end because there is no Sarvam key.
- **Sign-out** failed with "Cannot find module 'expo-network'" (an optional better-auth import that Expo's native loader throws on). Metro now maps it to a stand-in. Sign-out worked on the first tap afterwards.
- **A phone whose session ended looked connected.** After a password change elsewhere, the phone kept "Up to date" while every sync returned 401. It now shows "Sign in again" (English and Hindi) and stops syncing; unsent sales stay queued.
  - Checked: the password was changed from another client at 20:14:28. The cashier's phone showed "Sign in again" by 20:14:44 after one refused sync, and signing in with the new password returned it to Sell.
- **Android:** not run. The host load average was 108–180.

**Voice selling with OpenAI transcription (28 September 2026, late evening):**

- No Sarvam key exists, so recorded sales now go to OpenAI when only `OPENAI_API_KEY` is set. The model was chosen on six synthetic clips; see AI-COSTS.md.
- **API path:** a clip uploaded through `/extractions` was transcribed ("Dolo 650 एक पत्ती, नहीं नहीं, दो पत्ती."), structured with the spoken correction applied (Dolo 650, 2 strips), and the audio file was deleted afterwards. The job records the speech provider and model.
- **iPhone 17e simulator, end to end:**
  - The app asked for the microphone, and a clip played through the Mac speaker was recorded (14 s including silence).
  - The phone uploaded it using the fixed upload path; it was transcribed in 3.4 s as "Dolo 650 की दो पत्ती और एक Cetirizine की पत्ती दे दो."
  - The review listed Dolo 650 and Cetirizine. Staff confirmed each batch (DOL2401, CET2401); the basket held 2 strips + 1 strip = ₹91.00. It was not billed.
- **Defect found:** "Dolo 650" was flagged "Strength or form differs" against Dolo 650 mg, because the spoken strength had no unit. A bare spoken number now matches a catalogue strength starting with that number; a different number or unit is still flagged.
- **Not established:** real voices, accents and crowd noise; brands the synthetic voice mispronounced ("Crocin" was heard as "Klaricid"/"Pracin"); Android recording.

## Payments, credit and returns; Android pass (28 September 2026, night)

Strict TypeScript, 128 unit tests and the 28-test PostgreSQL/API suite passed. New coverage:

- refund pricing from what was paid, including three uneven partial returns on a bill with an odd ₹1.01 discount that pay back exactly the bill;
- credit cancelled before cash is handed back;
- over-sized and duplicate return requests refused when asked;
- only the requester or owner can hand back an approved refund;
- strip-to-tablet return quantities;
- an employee-run credit → return → refund flow through the real API;
- a cut-off model reply retried once while a wrong-shaped draft is not.

**Two phones: owner on the Android emulator (API 36), cashier on the iPhone 17e simulator:**

- **Credit:**
  - The cashier added a new customer, Ramesh Kumar, at checkout and asked for ₹35 credit. The phone said "₹35.00 credit is waiting for the owner" and Orders showed a count.
  - The owner's Android showed "A request is waiting for your approval · Review" and a More-tab count. The request read "Credit ₹35.00 · Ramesh Kumar", "Owes nothing today", with the medicine and batch.
  - The owner approved. Within seconds the iPhone showed "Owner approved ₹35.00 credit · Collect", and collecting opened on Credit with ₹35 filled.
  - Bill `2627-004-000002`; the server has a ₹35 credit sale for Ramesh Kumar.
- **Return and refund:**
  - The cashier found bill `2627-004-000001`, entered 4 tablets and the reason "Not needed any more". The phone showed "Refund to the customer ₹14.00" before asking.
  - The owner's Android showed "Return on bill 2627-004-000001 · ₹14.00", who billed it, and "4 tablets returned of 10 sold". The owner approved.
  - The cashier's bill changed to "Return approved · Give refund", with the amount fixed at ₹14 and Cash chosen.
  - On the server: refund ₹14 cash from the drawer, handed back by the cashier, 4 tablets set aside rather than returned to sale.
- **Repayment (Android):** Ramesh Kumar's account showed "Owes ₹35.00", "Full amount" and a dated history. A ₹20 cash repayment left ₹15, with "Paid back −₹20.00" against the bill; ₹20 went into the drawer. The customer list shows those who owe first.

**Android, other features (owner):**

- **Cash sale:** ₹50 received, ₹15 change; bill `2627-006-000001`.
- **Share PDF:** the Android share sheet showed `Bill 2627-006-000001.pdf`. The PDF pulled from the device is one 300 × 360 pt page reading "Paid ₹35.00 by cash".
- **Printing:** through the gateway to the local ePOS stand-in, with the correct receipt.
- **Stock count:** NIMU 50 CAP, batch NM2611, 11/27, 6 strips at ₹45 per strip. The server has 60 capsules at 450 paise, expiry 2027-11-30; the count went from 7 to 8 of 1,685.
- **Voice:** recorded through the Mac microphone. The English list came back complete, with quantities 2, 1, 6 and units strip, bottle, tablet. One Hindi clip was cut short by the emulator's audio pass-through under load; the same clip was fully heard on iOS.
- **Invoice photo:** picked in the Android file picker and uploaded (name decoded). The first reading failed with a reply cut off mid-JSON; nine reruns of the same request succeeded. After the retry fix, the owner's "Retry failed extraction" filled the review: 0001/25-26, ₹231, 3 lines.

**Found and fixed on devices:**

- Buttons at the bottom of a sheet were behind the Android keyboard. Sheets now move above it.
- The Add customer form kept old text after closing, so reopening doubled everything. It now starts empty and needs a name.
- The approval note still showed after credit was approved.
- "10 tablet" is now plural.
- Employees could not see returns on their own bills, so the phone could offer them again.
- Spoken quantities showed as words ("दस गोलियां · गोलियां").

**Not exercised on a device:**

- UPI refunds (unit-tested);
- Hindi on the new payment screens;
- camera scanning;
- a physical printer.

A phone number typed on the iOS simulator was saved as "9"; the same form on Android saved all ten digits, so this looks like the simulator's typing tool.

## Drawer, end of day and owner dashboard (28 September 2026, late night)

Strict TypeScript, 134 unit tests and the 29-test PostgreSQL/API suite passed. New coverage:

- staff count and close blind, with the expected figure and difference stored for the owner only;
- a note count that does not add up to the total is refused;
- the next opening is compared with the cash left at the last close;
- the day report names who recorded each cash movement and cancellation, and escapes names and reasons in the PDF page;
- trading after a report does not revise it, while a sale made before it and synced after it does;
- a drawer closed after midnight still gets a report for the day before, and the next night's close revises only the day that changed;
- through the real API, staff get a blind count and the owner the difference.

**Two phones: cashier on the iPhone 17e simulator, owner on the Android emulator (API 36):**

- **Mid-day check (cashier):** counted ₹2,100 by notes. The phone showed only the count; the server stored an expected ₹2,110.10 and a difference of −₹10.10.
- **Cash out (cashier):** ₹200 paid out, reason "Delivery charge".
- **Close (cashier):** counted ₹1,900 and left ₹1,000 for the next opening. The server stored an expected ₹1,910.10 and a difference of −₹10.10.
- **Day report:** closing the last drawer created `2026-09-28:1`: 7 bills, net ₹125.10 (cash ₹104.10, credit ₹35, returns ₹14), two staff. It stays provisional because the owner's other phone (iPhone 17 Pro, shut down) has not confirmed an empty outbox.
- **Owner (Android):**
  - Overview showed "The last close was ₹10.10 short", each person's day (Test Cashier 2: 2 bills, cash ₹35, credit ₹35, refunded ₹14, paid out ₹200; Shop owner: 5 bills, cash ₹89.10) and recent closes.
  - The report opened from Money; "Share report PDF" produced `Day report 2026-09-28 rev 1.pdf`, two A4 pages.
- **Next opening (cashier):** counted ₹920 (₹500 × 1, ₹200 × 1, ₹100 × 2, ₹20 × 1). The phone said only "Drawer opened with ₹920.00". The server stored −₹80 against the ₹1,000 left. The owner's Overview listed "Today's opening was ₹80.00 short against last night's cash" above the last close.

**Found and fixed:**

- The report's drawer header showed only a time for a drawer opened days earlier (the demo drawer opened on 23 September). It now shows the date too.
- A drawer closed after midnight would have left the previous day with no report. Closing now reports every day the drawer was open that has no report or has changed since.

**Not exercised on a device:**

- Hindi on the drawer, report and Overview screens;
- closing while another phone holds unsent sales;
- a real drawer routine at the shop.

## Offline recovery, staff access and release preparation (29 September 2026)

Strict TypeScript, 135 unit tests and the 29-test PostgreSQL/API suite passed. New coverage:

- only a request that never left the phone (refused, unreachable, unknown host) counts as not sent; timeouts and dropped connections stay uncertain;
- the owner's password reset signs the employee out everywhere and forces a new password; disabling signs them out at once; staff cannot reset passwords;
- a provisional report names the phones it is waiting for;
- a drawer closed after midnight still reports the day before.

**Offline billing (owner on the Android emulator; the phone could not reach the server but could reach the shop gateway):**

- The header read "Offline". A Cetirizine strip was billed in cash as `2627-006-000002` and the header showed "1 Pending". The shop gateway held a backup of it within seconds.
- The app was force-stopped and reopened with no server: still signed in, still "1 Pending".
- After reconnecting, the bill posted once with its phone-issued number and original time.
- Four bills from this phone are numbered 000001 to 000004 with no gap.

**Defects found and fixed:**

- Pressing "Hold order" with no connection said "No response from the server … do not collect payment again" and then locked "Confirm payment". The offline cash sale was blocked by one tap. Now the phone says "No connection, so this was not saved. Cash bills still work offline", gives the bill number back and lets the sale be billed in cash. Re-checked on the device: the hold failed cleanly and the sale billed offline as `2627-006-000004`, with no stray held order on the server.
- "Connection unavailable" stayed on screen after the connection came back. It now clears on the next successful request.

**Lost phone (cashier on the iPhone 17e simulator, owner on Android):**

1. With the server stopped, the cashier billed Betadine for ₹145 in cash as `2627-004-000003`. The gateway held the backup.
2. The app was deleted from the iPhone, losing the unsent sale, and the server was restarted.
3. The owner pressed "Recover from shop backups". Reviews showed "Gateway backup requires recovery: Test Cashier 2 · ₹145.00", the time, the counter and the batch.
4. The owner entered a reason and chose "Recover sale". The server now has `2627-004-000003` for ₹145 at the original time under Test Cashier 2.
5. After reinstalling and signing in again, the cashier sees the bill among completed bills. A reinstalled phone registers with a new bill series, so its numbers cannot collide with the old ones.

Found: the recovery review did not show the bill number the owner would match against the paper bill. It now does, with India time.

**Staff access (Android owner):** Administration → Test Cashier → "Set temporary password". The server marked the account for a password change, and signing in with the temporary password returned "password change required".

**Waiting phones:** the 28 September report listed four phones it was waiting for, each with its owner, iPhone or Android, and when it was last seen. The Overview flagged "Shop owner · Preview device not seen since Wed, 23 Sept; reports wait for it."

**Bill photos (Android emulator camera):**

- "Photograph the bill" asked for camera access, then showed the camera inside the receiving sheet.
- Two photos went up as one PDF and a single photo as a JPEG. The worker processed both.
- The emulator camera returns blank frames, so nothing could be read. That exposed a silent return to the start, which now explains why and suggests retaking the photo.
- Real bill reading was checked earlier on sample invoice images, not with a phone camera.

**Hindi:** the drawer panel, the close sheet and the returns form read correctly. Two labels were fixed (the cash in/out button's verb form, and "Open" on the Orders filter).

**Release preparation:**

- The production JavaScript bundle compiles (5 MB Hermes).
- `create-shop` was tested against the local database with a throwaway shop. It stored the details (state code taken from the GSTIN), refused to create the same shop twice and forced the owner's first password change; the owner then saw an empty shop.
- The Docker deployment kit has not been run yet: the Mac's connection was down to about 25 KB/s, too slow to pull the images.

**The release APK on the Android emulator** (built with `scripts/build-android-release.mjs --api http://localhost:4100`):

- It is signed with the new upload key, version 0.1.0 (code 1), built for ARM only, and 86 MB. It needed React Native's release libraries fetched ahead of time into `.data/maven-local`.
- It started without the development server or developer menu. The sign-in screen had no demo buttons, and the launcher showed the new icon.
- The owner signed in and billed `2627-008-000001`; the reinstalled phone got a fresh series. The receipt printed through the shop gateway over plain HTTP to the printer stand-in.
- With the server cut off, it billed `2627-008-000002`, which posted about a minute after reconnecting.
- **Defect found:** Android's keyboard autocorrected the username "shopowner" to "shop owner". Usernames, GSTIN, licence, UPI ID and gateway address fields no longer autocorrect; this needs the next release build.

**Test-tool quirk, not an app defect:** closing a sheet with the emulator's Escape key left the Sell screen ignoring taps until another tab was opened. Android's Back key, which phones use, does not.

## Production on Coolify (30 September 2026)

Strict TypeScript, 136 unit tests, the 30-test PostgreSQL/API suite, the gateway HTTP suite and the shop PC setup checks (portable PowerShell 7.6) passed.

**Server:** Coolify on the Hostinger VPS, project `counterwell`, Docker Compose application from `main` (`deploy/coolify.compose.yaml`), `https://counterwell.72.62.241.119.sslip.io` with a valid Let's Encrypt certificate.

- **Running:** Postgres, the API, the worker and the daily backup; the one-off migration exits cleanly.
- **Found and fixed during the deploy:**
  - Coolify runs compose from the repository root, so build contexts are `.` there.
  - Coolify had passed every variable into the image build as build arguments, secrets included. All are now runtime-only; the image history was checked clean and the earlier images are gone.
  - The API was unreachable for about 30 seconds on each deploy until its first health check passed. It is now checked every 2 seconds while starting.
- **Backups:** a dump is written at start and daily to `/data/counterwell/backups`. Restoring the newest into a scratch database gave the expected shops, members and bills.

**Real shop:** `shop-1`, owner username `owner`. The temporary password is in `.data/production/owner.json`. Signing in over HTTPS returned "password change required".

**Offline permissions are now asymmetric:** the server signs with an Ed25519 private key and the shop gateway verifies with the public key only. A test runs the gateway with just the public key and confirms that a permission signed with a guessed shared secret, or with another key, is refused. Production uses a new key pair; the old shared secret was removed.

**Release APK against production** (throwaway `check-shop` with the demo catalogue, deleted afterwards with `scripts/check-shop.ts delete`):

- **Online sale:** signed in over HTTPS and billed `2627-002-000001`.
- **Airplane mode:** "Hold order" said "No connection, so this was not saved". The cash bill `2627-002-000002` then saved offline, the app restarted still showing "1 Pending", and it posted on reconnecting.
- **AI worker in production:** "teen goli cetirizine, ek shishi betadine" came back as 3 goli and 1 shishi.
  - The first try exposed a defect: "ek betadine ki bottle" gave the unit "ek" (one). The instruction and the unit words (patte, shishi …) were fixed and re-checked.

**iPhone release build:** `scripts/build-ios-release.mjs --check` archives the Release configuration for iPhones ("ARCHIVE SUCCEEDED"). The bundle holds the production address and no `localhost`. Signing and the TestFlight upload were done later the same day (see "Notifications and TestFlight").

**Shop PC gateway installer:**

- Checked on this Mac: `install-gateway.ps1` parses with no errors and no PowerShell 7-only syntax. A gateway-only `npm install` in a fresh clone brings 15 packages, and the gateway starts from it with only the public key.
- Not yet run on the real PC.

## Notifications and TestFlight (30 September 2026)

Strict TypeScript and all 172 tests (141 unit, 31 PostgreSQL/API) passed.

**Keys:** Apple's push key and the Firebase service account are Coolify variables. A made-up token got `BadDeviceToken` from Apple and `INVALID_ARGUMENT` from Google, so both accepted the keys.

**Android, release APK against production** (the throwaway `check-shop`, with a check cashier added through the API):

- After sign-in the app asked for notification permission. The phone's Firebase token reached the server within seconds.
- The cashier closed the drawer ₹500 short. The owner's phone showed "Drawer closed ₹500.00 short" and "Day report ready · 2026-09-30", with the app's icon. Tapping the first opened Money.
- It also works with the app closed (Home, then the process killed): Android started the app to receive the notification. A force-stopped app gets nothing until it is opened again; that is Android's rule for force-stop, not the app's.
- **Found and fixed:** tapping a notification when the app was closed opened Sell. The page was read before the session was restored, and the switch to the start page then replaced it. The requested page now waits for the session; checked on the emulator, where it opens Money.
- **Found and fixed:** after uninstalling and at once reinstalling, the new install's Firebase token was dead from the start. Firebase answered `UNREGISTERED` even with the app open, while a new Firebase installation's token was accepted. This matches a Play services race: the uninstall's unregistration lands after the reinstall's registration. The server already forgot rejected tokens, but the phone kept its dead token and never sent another. Now, when the server has dropped the token a phone sent, the phone asks Firebase for a new one at its next refresh. Production logs `push_tokens_dropped` when that happens.
  - The race did not happen again on a second reinstall, so the recovery was checked by moving the phone's token to another device record through the API. Within 25 seconds the phone had deleted the old token (Firebase then answered `UNREGISTERED` for it) and registered a new one. A drawer closed short reached the phone through the new token, and the server dropped the dead one.

**iPhone:**

- **Signing:** `scripts/make-ios-signing.mjs` created an Apple Distribution certificate, whose key is kept in a project-only keychain, and an App Store profile through the API, with no device registered. Automatic signing had failed with "Your team has no devices".
- **Build and upload:** `build-ios-release.mjs` archived, signed ("Apple Distribution: Harshit Karnatak (8X78GGWB32)", profile "Counterwell App Store 2026-09-30") and uploaded build `202609300924`. Apple processed it as `VALID` with no export-compliance hold, because the app declares no non-exempt encryption and SQLCipher uses Apple's CommonCrypto. The build expires on 29 December 2026. Build `202609301011`, with both fixes above, followed and was also processed as `VALID`.
- The archived app is entitled for production pushes (`aps-environment` production), and the server sends to Apple's production host.
- Afterwards the keychain search list was back to the login keychain alone.
- **Testers:** the internal TestFlight group "Shop" receives every build. `scripts/add-tester.mjs` invites a person and then adds them to it. No tester has been added yet.
- **Not checked:** delivery to a real iPhone. This needs the TestFlight build on a phone, because simulators cannot receive remote notifications.
