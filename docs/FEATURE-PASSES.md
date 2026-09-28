# Feature validation passes

Work proceeds one user workflow at a time. Each pass includes UI, server invariants, failure/recovery and a cost review where AI is involved.

1. **Supplier invoice receiving — implemented and locally checked.** Searchable product selection, complete extracted-field retention, explicit quantity/price units, paid plus bonus conversion, source document access, draft persistence, job resumption, bounded retries, duplicate-document reuse and monthly allowances. Per-line confirmation is invalidated by edits/catalogue changes. Backend rejects duplicate purchase IDs/source documents, expired/inactive/fractional discrete stock, tampered conversions and invalid totals. Explicit invoice adjustments have reasons and do not silently change stock costs. Live provider and physical-phone acceptance remain.
2. **Voice-assisted selling — implemented and locally checked.** Compact editable review, known Hindi/English quantities and units, conflict-marked catalogue candidates, explicit physical-batch confirmation, atomic basket/draft updates, native draft persistence, resumable jobs, exact typed-entry parsing without API calls, transcription checkpoints, bounded retries and conservative monthly audio reservations. Real microphone/device recovery and the labelled accuracy/latency evaluation remain.
3. **Manual/barcode checkout and handoff — done; checked on iOS simulator and Android emulator.** Draft-pinned payment identity (no double billing), no-response lock, per-bill receipt state, gap-free invoice series on rejections, decline/recall/take-over/cancel for orders, GS1/EAN scanning with batch preselection, one-tap batch confirmation and cash change. Device testing found and fixed two defects unit tests could not: native cash billing failing on encrypted storage, and a double tap parking a sale.

4. **Payments, credit, approvals and returns.** Permission boundaries, partial payments, refunds and quarantine.
5. **Stock catalogue/counts and price maintenance.** Catalogue import from Excel/CSV/paste is done and device-checked (28 September). Next: a fast opening-count flow for imported products, then batch corrections, price maintenance and expiry workflows.
6. **Drawer, EOD and owner dashboard.** Close/reopen rules, late sync, money separation and report clarity.
7. **Offline/device recovery and receipts.** Physical phones, real printer, gateway loss, app restart and backup recovery.
8. **Silent camera reviews.** Recorder/model setup, labelled replay, false exceptions, clips and outage handling.

No pass is declared field-validated on the basis of mocked provider tests or native compilation alone.
