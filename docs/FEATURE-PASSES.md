# Feature validation passes

Work proceeds one user workflow at a time. Each pass includes UI, server invariants, failure/recovery and a cost review where AI is involved.

1. **Supplier invoice receiving — implemented and locally checked.** Searchable product selection, complete extracted-field retention, explicit quantity/price units, paid plus bonus conversion, source document access, draft persistence, job resumption, bounded retries, duplicate-document reuse and monthly allowances. Per-line confirmation is invalidated by edits/catalogue changes. Backend rejects duplicate purchase IDs/source documents, expired/inactive/fractional discrete stock, tampered conversions and invalid totals. Explicit invoice adjustments have reasons and do not silently change stock costs. Live provider and physical-phone acceptance remain.
2. **Voice-assisted selling — implemented and locally checked.** Compact editable review, known Hindi/English quantities and units, conflict-marked catalogue candidates, explicit physical-batch confirmation, atomic basket/draft updates, native draft persistence, resumable jobs, exact typed-entry parsing without API calls, transcription checkpoints, bounded retries and conservative monthly audio reservations. Real microphone/device recovery and the labelled accuracy/latency evaluation remain.
3. **Manual/barcode checkout and handoff — in progress.** Done first: the three client double-billing paths.
   - Each basket's order and cash-command identity is saved in the sale draft before anything is sent.
   - A basket that reached the server is billed only through its order.
   - Local cash commits are idempotent by command ID.
   - Restored drafts are resolved from recorded state rather than a manual Orders check.
   - A basket whose payment got no response is locked, with Check now / Set aside.

   Still to do: receipt print-state reset, handoff recall/decline, barcode exact-match/unknown/permission handling, invoice-number gaps on rejected checkouts, speed (tap count, amount tendered/change), iOS modal chaining and device tests.

4. **Payments, credit, approvals and returns.** Permission boundaries, partial payments, refunds and quarantine.
5. **Stock catalogue/counts and price maintenance.** Real pack conversions, catalogue import, batch corrections and expiry workflows.
6. **Drawer, EOD and owner dashboard.** Close/reopen rules, late sync, money separation and report clarity.
7. **Offline/device recovery and receipts.** Physical phones, real printer, gateway loss, app restart and backup recovery.
8. **Silent camera reviews.** Recorder/model setup, labelled replay, false exceptions, clips and outage handling.

No pass is declared field-validated on the basis of mocked provider tests or native compilation alone.
