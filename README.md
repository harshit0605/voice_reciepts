# Counterwell

Pharmacy-first retail operations for Android and iOS. React Native / Expo, Hono, Better Auth, PostgreSQL and Drizzle. Includes a local gateway and a separate silent camera pilot.

**Continuing development with another agent?** Start with [current progress and handoff](docs/PROGRESS-HANDOFF.md), alongside the original product plan.

**This is an implemented pilot build, not a certified pharmacy system or a completed shop cutover.** Use synthetic data until the onboarding checks in [docs/PILOT.md](docs/PILOT.md) are signed off. Schedule X dispensing is blocked pending an explicitly validated workflow.

## Run the preview

```sh
npm ci
npm run dev:mobile
# Or: npm run web -w @counterwell/mobile
```

Open `http://localhost:8081/?demo=owner` or `?demo=employee`. The demo contains synthetic stock, prices, tax rates and business details. It is isolated from the live backend. The browser preview keeps demo data in memory. Real cash billing requires the encrypted native app.

## Run the connected system

Requires Node 22.13+ (Node 26 tested), PostgreSQL 16+ and Python 3.11+ for the optional camera service.

1. Copy `.env.example` to `.env`, generate three separate random secrets, and set `DATABASE_URL`. Do not commit `.env`.
2. Start PostgreSQL (`docker compose up -d postgres`, or your own local instance). The compose mapping is `127.0.0.1:50489`.
3. Run `npm run db:migrate` then `npm run seed`. This creates an **empty**, readiness-blocked shop and a first owner. Credentials are written to `.data/local-access.json` with private permissions. Set `SEED_OWNER_USERNAME` / `SEED_OWNER_PASSWORD` for assisted provisioning. `npm run seed -- --demo` explicitly creates a synthetic shop instead. Existing shops are never overwritten.
4. Run `npm run dev:api`, `npm run dev:worker`, and `npm run dev:gateway` in separate terminals. All workspace scripts resolve `.env` at repository root. See the path note below.
5. Start the mobile app. Configure the shop, employees, counted stock, drawer and gateway before readiness is enabled.

The local instance prepared during development uses PostgreSQL on port 50489, API on 4100, Expo on 8081, and an explicit synthetic `pilot-pharmacy`. No production database or cloud account has been provisioned.

### Native development builds

Expo Go is unsupported: SQLite must be built with SQLCipher. The app checks the cipher at runtime and fails rather than silently opening plaintext storage.

```sh
cd apps/mobile
# Physical phones: use the computer's LAN address, reachable from shop Wi-Fi.
# Create apps/mobile/.env.local with EXPO_PUBLIC_API_URL=http://YOUR_LAN_IP:4100
npx expo run:ios
# Android emulator: API address is typically http://10.0.2.2:4100
npx expo run:android
```

The `.env.local` filename is ignored. Add the actual development origins to `TRUSTED_ORIGINS`. Use HTTPS for production API and gateway, a controlled shop network, unique secrets per deployment, and never embed server secrets in the mobile bundle. Native release builds must use a verified HTTPS API. `eas.json` includes development/preview/production profiles, but no EAS project, signing credentials, Play release or TestFlight release was created.

### Paths and services

Use absolute `UPLOAD_DIR`, `GATEWAY_DATA_DIR`, and `CAMERA_CLIP_DIR` paths when running services from different working directories. API and worker must share the same uploads directory. Camera and gateway must share the same local clip directory. The gateway does not send clips to the cloud.

The reference printer uses Epson ePOS XML over the LAN. Set `PRINTER_HOST`, enable ePOS on the actual printer, install a Devanagari-capable font on the gateway, and verify paper width, Hindi shaping, paper-out handling and interrupted jobs on physical hardware. An uncertain print is held for explicit, audited reprint.

Dictation stops at 28 seconds to stay within the [Sarvam REST request duration](https://docs.sarvam.ai/api-reference/speech-to-text/transcribe). Choose `INVOICE_MODEL` / `STRUCTURE_MODEL` (Flash-Lite is the new-install candidate; existing `GEMINI_MODEL` remains a fallback). Set `SARVAM_API_KEY` and `GEMINI_API_KEY` to enable deliberate dictation and reviewed supplier invoice extraction; with no Google key, `OPENROUTER_API_KEY` runs the same Gemini models through OpenRouter. `npm run evaluate:invoices -- bill.jpg` shows what a bill reads as without storing anything. Missing keys produce an explicit failed job. No provider accuracy or latency target has been established. Audio is deleted following success or terminal failure; supplier documents remain private to the business.

## Implemented surfaces

- Employee: Sell, Orders, Stock, Customers and More; owner: Overview, Inventory, Money, Reviews and Administration. English/Hindi presentation copy, barcode scanning, batch confirmation and voice-draft review.
- Atomic sale posting, GST-inclusive invoice snapshots, loose-unit conversions, held orders, acknowledged cashier handoffs, mixed cash/UPI, owner-approved credit/discounts, linked repayments, approved refunds and quarantined returns.
- Owner-managed catalogue, supplier invoices, physical opening stock, purchase bonuses, batches, expiry and approved stock movements.
- Shared-drawer opening/closing reconciliation and immutable EOD revisions. Sales, collections and dues are separate. Missing costs never become invented margin.
- Device-specific invoice series, encrypted local cash outbox, durable sequence allocation, idempotent replay, 24-hour signed authorisation, gateway backup, revoked-device recovery and redacted incremental sync.
- Authenticated local print queue, PDF generation, print-status checks and audited reprints.
- YOLOX/ByteTrack adapter, anonymous counter zones, replay evaluation, durable observations, owner review, local clips and coverage-gap events. No face recognition, employee scoring or employee camera alerts.

[Architecture and API](docs/ARCHITECTURE.md) · [Pilot and remaining verification](docs/PILOT.md) · [Verification evidence](docs/VERIFICATION.md)

## Feature-by-feature refinement

[Receiving workflow pass](docs/FEATURE-PASSES.md) · [API pricing and margin controls](docs/AI-COSTS.md). Supplier receiving now retains extraction source fields, converts paid/bonus packs, saves local drafts, resumes uploads and checks item-level review before posting. New-job allowances and tenant-scoped content reuse prevent repeat uploads from silently multiplying provider calls.

## Verification

```sh
npm run check
# Create a separate database named counterwell_test first:
npm run test:integration
npm run test:camera
npm run build:web
npm run verify:backup
```

Integration tests refuse a database not named `counterwell_test`. Backup verification restores to a freshly generated `counterwell_restore_*` database, compares table counts against the same exported database snapshot, and drops only that temporary database. Use matching PostgreSQL client/server major versions; set `PG_BIN` if necessary. Successful dumps remain in private `.data/backups/`; production backup storage, encryption, rotation and restore drills must be provisioned separately.

### Voice entry preview

In Sell, open **Voice / text**. **Load sample voice review** uses labelled synthetic data without calling AI. Choose the supplied product, resolve ambiguous units, and confirm the physical batch. To try the local parser, enter `Dolo 650 mg 6 goli; ORS 21 g 1 sachet`. Other text uses the configured structure API; recorded audio uses Sarvam first. Provider keys are required for live requests. See [feature passes](docs/FEATURE-PASSES.md), [cost controls](docs/AI-COSTS.md), and [verification limits](docs/VERIFICATION.md).
