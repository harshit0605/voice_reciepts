# Running Counterwell for a real shop

**Production today (30 September 2026):** Coolify on the Hostinger VPS, project `counterwell`,
application `counterwell` (Docker Compose, `deploy/coolify.compose.yaml`, built from `main` on
GitHub), at `https://counterwell.72.62.241.119.sslip.io`. Its settings are Coolify environment
variables, with a copy in the git-ignored `.data/production/secrets.json`; daily dumps go to
`/data/counterwell/backups` on the VPS. To deploy a new commit, press Redeploy in Coolify (or call
its `/api/v1/deploy?uuid=zws0coocgcs84k048ok0g4os`). Sections 1 to 4 below describe the same
setup on a plain Docker server without Coolify.

The phones need a server they can reach from the shop and from the owner's home. This guide puts
it on a small rented Linux server with HTTPS, daily database backups and the AI keys. The shop's
Windows PC stays in the shop as the gateway (receipt printer, backup of sales made offline); see
[SHOP-PC-SETUP.md](SHOP-PC-SETUP.md).

## 1. A server

Any small Linux server with Docker works. For a shop in India, one in Mumbai or Bangalore keeps
the app fast:

- 1 vCPU, 2 GB memory, 25 GB disk, Ubuntu 24.04. For example DigitalOcean (Bangalore), AWS
  Lightsail (Mumbai) or Oracle Cloud's free tier (Mumbai/Hyderabad). Roughly ₹0–800 a month.
- An address. A domain you own (point an `A` record at the server), or the free
  `<server-ip>.sslip.io` name, which needs no setup. Caddy obtains the HTTPS certificate itself;
  ports 80 and 443 must be open.

Install Docker (`curl -fsSL https://get.docker.com | sh`) and copy the code:

```bash
git clone https://github.com/harshit0605/voice_reciepts.git counterwell && cd counterwell
```

## 2. Settings and secrets

```bash
cp deploy/.env.example deploy/.env
```

Fill in `deploy/.env`. Make each secret with `openssl rand -base64 32`. Keep the file only on the
server (it is git-ignored). Make `OFFLINE_SIGNING_KEY` with `node scripts/make-offline-keys.mjs`; its public
half, `OFFLINE_VERIFY_KEY`, and `GATEWAY_TOKEN` go on the shop PC. The shop PC never gets the private key,
so nobody with access to it can create offline permissions and post sales in someone else's name.

Phone notifications (approvals, handovers, drawer shortfalls, the day report) are optional and need
two keys, each stored base64-encoded (`base64 -i <file>`):

- `APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`: an Apple push key (developer.apple.com → Keys, with
  Apple Push Notifications service enabled), its key ID and the team ID. One key serves both
  TestFlight and App Store builds.
- `FCM_SERVICE_ACCOUNT`: the Firebase project's service account key (Firebase console → Project
  settings → Service accounts → Generate new private key). The Android build also needs that
  project's `google-services.json` in `.data/firebase/`.

Without them the app works the same, just without notifications.

## 3. Start it

```bash
docker compose -f deploy/compose.yaml --env-file deploy/.env up -d --build
curl https://$DOMAIN/health     # {"ok":true,"service":"counterwell-api"}
```

This starts Postgres, prepares the database, then the API, the worker that reads bills and voice,
Caddy (HTTPS) and the daily backup. Everything restarts on its own after a reboot.

## 4. Create the shop

```bash
docker compose -f deploy/compose.yaml --env-file deploy/.env run --rm api \
  tsx scripts/create-shop.ts --id city-pharmacy --owner "Owner name" --username owner \
  --shop "City Pharmacy" --address "Hospital Road, Lucknow" --gstin 09ABCDE1234F1Z5 \
  --licence "Drug licence number" --state 09 --phone 9876543210
```

Use the same `--id` as `BUSINESS_ID` in `deploy/.env`. The command prints the owner's temporary
password once. Give it to the owner privately; they choose their own at first sign-in. Shop details
can be changed later in the app under More → Administration, where the owner also creates staff
accounts.

## 5. Build the app

On the development Mac (Android Studio's SDK installed):

```bash
node scripts/build-android-release.mjs --api https://$DOMAIN
```

The signed APK is written to `.data/releases/`. The first build creates the signing key in
`.data/android-signing/`. **Back that folder up.** Every update must be signed with the same key,
or phones refuse to install it over the existing app. To update, raise `version` and
`android.versionCode` in `apps/mobile/app.json` and build again.

Send the APK to each phone (WhatsApp, Google Drive or a cable). Android asks once to allow
installing apps from that source.

iPhones get the app through TestFlight. Once, on a Mac with Xcode, with the App Store Connect API
key (Admin role) saved as `.data/apple/AuthKey_<key id>.p8` and described in `.data/apple/asc.json`:

```bash
node scripts/make-ios-signing.mjs
```

It creates an Apple Distribution certificate, whose private key stays in the project's own keychain
`.data/apple/signing.keychain-db`, and an App Store provisioning profile. No iPhone needs to be
registered. The profile lasts a year; run the script again to renew it. **Back up `.data/apple`.**
Then, for each release:

```bash
node scripts/build-ios-release.mjs --api https://$DOMAIN
```

It builds, signs and uploads to App Store Connect. Apple takes 5 to 30 minutes to process a build,
then it goes to the internal TestFlight group "Shop", which receives every build. To give someone
the app:

```bash
node scripts/add-tester.mjs name@example.com First Last
```

The first run invites them to the App Store Connect team (Marketing role, this app only), because
TestFlight's internal testers must be team members. Once they accept Apple's email, run it again to
add them to the group. TestFlight then emails them; they install Apple's TestFlight app and install
Counterwell from there, and later builds arrive as updates. A TestFlight build stops opening after
90 days, so upload a new one before then.

## 6. Backups

A compressed database dump is written to `deploy/backups/` every day and kept for 30 days. Keep a
copy somewhere other than the server, for example by pulling it to the shop PC or the Mac each
night:

```bash
rsync -a server:counterwell/deploy/backups/ ~/counterwell-backups/
```

Check that a backup restores before relying on it (this uses a scratch database next to the real
one and removes it afterwards):

```bash
c="docker compose -f deploy/compose.yaml --env-file deploy/.env"
$c exec postgres createdb -U counterwell restore_check
gunzip -c deploy/backups/<newest file>.sql.gz | $c exec -T postgres psql -q -U counterwell -d restore_check
$c exec postgres psql -U counterwell -d restore_check -c "select count(*) from retail_invoices"
$c exec postgres dropdb -U counterwell restore_check
```

Uploaded bill photos and voice clips are in the `uploads` Docker volume. Bills stay readable in
the app only while their file is kept.

## 7. The shop PC gateway

The gateway runs on the shop's Windows PC. It prints receipts and keeps a second copy of every
sale a phone makes while offline. First an employee runs the shop PC setup
([SHOP-PC-SETUP.md](SHOP-PC-SETUP.md)), which puts the PC on Tailscale with SSH, Git and Node.js.
Then install the gateway from the Mac:

```bash
node scripts/windows/install-gateway.mjs --host cwsupport@counterwell-shop --usb-printer --test-print
```

The printer is `--usb-printer [name]` for one installed in Windows (USB), `--raw-printer <IP>` for
a network printer taking raw ESC/POS, or `--printer <IP>` for an Epson with ePOS-Print; `--paper 58`
for 2-inch rolls. [SHOP-PC-SETUP.md](SHOP-PC-SETUP.md) explains how to choose.

It copies the settings over SSH (never through anyone at the shop), installs only the gateway's
packages, registers a task that starts it with Windows and restarts it if it stops, opens port 4101
to the shop Wi-Fi only, and prints the address to enter in the app (More → Administration → Local
gateway URL). Run it again to update the gateway or change the printer. Give the PC a fixed address
on the shop Wi-Fi (a reservation in the router) so that address does not change.

The PC gets `OFFLINE_VERIFY_KEY`, which can check phones' offline permissions but not create them.

## 8. Updating the server

```bash
git pull && docker compose -f deploy/compose.yaml --env-file deploy/.env up -d --build
```

The database is updated in place; phones keep working offline during the minute the API restarts.
