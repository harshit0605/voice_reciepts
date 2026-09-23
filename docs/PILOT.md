# Shop pilot and cutover

Do not make Counterwell the sole pharmacy record until this checklist is completed with the owner and the qualified local advisers responsible for the shop's records. The readiness flag starts off for newly provisioned real shops.

## Inputs still required from the shop

- Verified legal business details, GSTIN, drug licence, applicable dispensing records and invoice fields. Demo identifiers and tax rates are synthetic.
- A reviewed product/alias/barcode catalogue, actual pack conversions, approved selling prices, tax rates, suppliers and photographed example invoices.
- Physical opening stock by batch and expiry, including loose units, damage and quarantined stock; count current stock rather than inferring it from old invoices.
- Target Android and iPhone models, Wi-Fi and internet conditions, counter zones, a shared drawer process, and employees authorised to collect payment.
- Printer model/firmware/network settings and an actual Hindi test receipt. Reference hardware is Epson TM-m30III; no purchase was made.
- Recorder model, authorised RTSP/export access, camera positions/resolution/frame rate, timestamps and labelled footage. No assumption is made about the installed DVR/NVR.
- Sarvam/Gemini keys, hosting/storage/monitoring accounts, release signing credentials and distribution accounts.

## Daily operation

1. Owner opens the shared drawer with counted opening cash. Staff sign in on registered phones and confirm their counter assignment.
2. Staff capture actual supplied items; confirm medicine, strength, unit, physical batch and quantity. Dictation always remains a draft.
3. Collect cash, manually verify UPI in the merchant app, or obtain online credit approval. A screenshot/reference is not bank confirmation. Handoff requires a server acknowledgement.
4. Check unsynced counts before changing devices, signing out or closing. The app blocks sign-out when unresolved actions remain.
5. Owner decides approvals separately from refund execution. Returned stock remains quarantined until reviewed.
6. Count the shared drawer; record withdrawals/deposits with reasons. Reconcile at drawer level. Review pending or stale phones and provisional EOD reports. Late postings create a new report revision.
7. Inspect uncertain printer jobs before requesting another copy. Reprints require a reason and a physical-paper check.

## Acceptance evidence

| Test                                                                                     | Current evidence / remaining work                                                                                     |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Posting, duplicate prevention, rounding, conversions, approvals, returns, credit and EOD | Automated domain tests                                                                                                |
| Five concurrent devices, tenant isolation, employee redaction and signed sync            | Authenticated PostgreSQL/API integration tests                                                                        |
| Four-hour outage, late sync and changed stock/price                                      | Time-shifted domain simulation; **not** a four-hour physical-phone endurance run                                      |
| Gateway restart and uncertain print recovery                                             | Durable queue tests; physical printer testing remains                                                                 |
| Android and iOS encrypted local persistence/restart/reinstall behaviour                  | Native configuration implemented; physical-device acceptance remains                                                  |
| PDF sharing and Hindi thermal printing on Android/iPhone                                 | Implemented paths; hardware and physical PDF inspection remain                                                        |
| Sarvam/Gemini accuracy and p95 latency                                                   | Provider adapters and evaluator implemented; keys and labelled evaluation data not supplied                           |
| Camera accuracy and review time                                                          | Replay/evaluation code and synthetic session tests; real recorder audit, weights and 500 labelled interactions remain |
| Database restore                                                                         | Local full restore verified against 29 tables; production backup/restore infrastructure remains                       |
| TestFlight / Android internal testing                                                    | Build profiles provided; no releases uploaded                                                                         |

## Speech evaluation

Collect at least 300 separately consented evaluation recordings, labelled independently across employees, noise conditions, names, strengths, forms, units, quantities and spoken corrections. Do not use operational audio as an undeclared training set. Score complete item/quantity/unit sets as well as individual ambiguities.

Run `npm run evaluate:voice -- path/to/reviewed-results.jsonl` with one row per sample:

```json
{
  "id": "sample-001",
  "employee": "E1",
  "noise": "busy",
  "expected": [
    { "productId": "product-id", "quantity": "6", "unit": "tablet" }
  ],
  "actual": [{ "productId": "product-id", "quantity": "6", "unit": "tablet" }],
  "latencyMs": 4200
}
```

Targets: ≥95% exact matching and ≤5,000 ms p95 after recording ends. Neither is currently a measured result. Evaluate supplier extraction against reviewed originals; correct mappings, packs, prices, bonus quantities, dates and invoice totals before posting.

## Silent camera pilot

Create a Python virtual environment and install `services/camera/requirements.txt`. Supply compatible YOLOX ONNX weights, verified licensing and a zone JSON based on `zones.example.json`. Track replay works without a GPU/model:

```sh
python services/camera/replay.py --tracks tracks.jsonl --zones services/camera/zones.example.json --output observations.jsonl
python services/camera/replay.py --video recording.mp4 --start RECORDING_START_UNIX_SECONDS --model yolox.onnx --zones zones.json --output observations.jsonl --clips /ABSOLUTE/GATEWAY/clips --gateway http://SHOP_GATEWAY:4101
python services/camera/evaluate.py --truth labels.jsonl --predictions observations.jsonl
```

Export `GATEWAY_TOKEN` into the local camera process environment. Avoid credentials in shell history or RTSP logs. Camera and gateway share the same clips directory. Stream-start/read failures emit coverage gaps; supervise/restart the process on the appliance. Extracted local clips default to seven days; owners can preserve a case with a reason. Restrict the network and storage to authorised shop staff.

Label at least 500 interactions including enquiries, groups, multiple bills, unrecorded purchases, late sync and staff handovers. Interval matching measures detector coverage; separately label false exceptions, missing purchases, attribution errors and reviewer time. No theft verdict or employee identity is inferred from a counter visit. Camera performance does not block core billing or automatically enable employee alerts.

## Release gates

Run a controlled five-phone outage/restart/gateway-loss/recovery exercise, including power loss during cash commit, an uncertain checkout response, a revoked device, duplicate UPI references, invoice-year rollover and a deliberately conflicting stock balance. Compare every paper/test receipt, invoice ID, payment and stock movement before/after. Require zero lost or duplicated transactions.

Benchmark command latency with the actual catalogue and realistic retained history. Connect the implemented request logs, extraction latency/token usage, queue status and gateway heartbeat checks to hosted monitoring and cost budgets; provision secure backup storage before replacing existing records. Capture release evidence and rollback procedures; retain the existing system until the owner reconciles the pilot.

Dependency audit at implementation time reported moderate findings in the Expo dependency tree (`uuid` and `decode-uri-component`); no high/critical findings. A forced downgrade of Expo is not a safe fix. Review upstream compatible patches before a production release.
