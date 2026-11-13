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
or phones refuse to install it over the existing app. Each build numbers itself (minutes since
2024, shown in the file name and in the app under More → Device and synchronisation), so a newer
APK always installs over an older one; raise `version` in `apps/mobile/app.json` for a release
worth naming.

Send the APK to each phone (WhatsApp, Google Drive or a cable). Android asks once to allow
installing apps from that source. To update, send the new APK the same way: opening it offers
to update the installed app, and the phone keeps its sign-in and any sales not yet synced.

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

To try a build on an iPhone connected to the Mac by cable, without waiting for TestFlight: turn
on Developer Mode on the phone (Settings → Privacy & Security → Developer Mode), keep it unlocked,
then once run `node scripts/make-ios-dev-signing.mjs`. It registers the phone with the team and
makes a development certificate and profile. After that, each try is:

```bash
node scripts/build-ios-release.mjs --api https://$DOMAIN --device
```

It builds the release app, installs it on the phone and opens it. Crash reports come off the
phone with `xcrun devicectl device copy from --device <UDID> --domain-type systemCrashLogs
--source / --destination <folder>`. Such installs use Apple's development notification service,
so notifications from the production server reach only TestFlight builds.

Builds made with Xcode 27 (the iOS 27 SDK) must use the scene-based app life cycle or iOS stops
them as they open. `apps/mobile/plugins/scene-lifecycle.js` adds it to the generated project,
using Expo's own `ExpoAppSceneDelegate`. Remove the plugin after upgrading to Expo 58, whose
template does the same.

## 6. Backups

The server writes a compressed database dump every day and keeps 30 days of them
(`/data/counterwell/backups` on the Coolify VPS, `deploy/backups/` with plain Docker). A backup on
the server's own disk is lost with the server, so each dump is also written **encrypted**, and the
shop PC copies those off the server by itself.

**How it works.** The backup service encrypts each dump with [age](https://age-encryption.org) to
the owner's public key (`BACKUP_AGE_RECIPIENT`), giving `counterwell-<date>.sql.gz.age` next to the
plain `.sql.gz`. The plain file stays on the server because anyone who can read that disk can already read
the live database, and it restores without a key. Only the owner's private key opens the encrypted
copy, so nobody at the shop can read the files on the PC. The API lists and serves only the `.age`
files (`/api/v1/gateway/backups`, checked with `GATEWAY_TOKEN` like every gateway call; the API
mounts the folder read-only). The gateway checks on start and every 3 hours, downloads what it does
not have into `data\backups` beside its other data (on the PC:
`C:\ProgramData\Counterwell\gateway\data\backups`), checks size and SHA-256, keeps the newest 30, and
reports when the newest copy arrived (`lastBackupCopiedAt` in its health report). A failed copy is
logged and retried; it never delays printing or sale backup.

**Once: make the key.** On the Mac, save the private key where only you keep it, with a second
copy somewhere else (a password manager, a printed copy). **Losing it makes every encrypted backup
unreadable; the server never has it.**

```bash
node scripts/make-backup-key.mjs .data/production/backup-age.key    # prints BACKUP_AGE_RECIPIENT=age1...
```

Set that public key as `BACKUP_AGE_RECIPIENT` in Coolify (or `deploy/.env`) and redeploy. The
redeploy restarts the backup service, which writes an encrypted dump straight away; the shop PC
fetches it at its next check (every 3 hours). The PC needs the gateway version that copies backups:
install or update it as in section 7. Until the variable is set, backups behave as before.

**A manual off-server copy** (for example before a risky change, or to hold one on the Mac):

```bash
node scripts/pull-backup.mjs --api https://$DOMAIN --token-file .data/production/gateway-token.txt
```

The token file holds only the `GATEWAY_TOKEN` value, and is never printed. The newest encrypted
backup goes to `~/counterwell-backups/` (`--out` for another folder) after its size and checksum are
verified. It is still encrypted, so the copy is safe on any disk.

**Check that a backup restores** before relying on it. This decrypts it, loads it into a scratch
database on a PostgreSQL server you can create databases on (your local one is fine; never the
live one), counts the sales bills and removes the scratch database:

```bash
RESTORE_ADMIN_URL=postgres://user:password@localhost:5432 \
  node scripts/restore-check.mjs --backup ~/counterwell-backups/<file>.sql.gz.age \
  --key .data/production/backup-age.key
```

It needs `psql` on the PATH and a PostgreSQL server of version 17 or newer, like the one that made
the dump. To restore for real
after losing the server, decrypt the same way (`age --decrypt -i <key> <file>.age | gunzip | psql
...` works with the age command line tool too) into the new server's empty `counterwell`
database, then deploy and run the migration as usual.

The plain dumps can be checked on the server itself:

```bash
c="docker compose -f deploy/compose.yaml --env-file deploy/.env"
$c exec postgres createdb -U counterwell restore_check
gunzip -c deploy/backups/<newest file>.sql.gz | $c exec -T postgres psql -q -U counterwell -d restore_check
$c exec postgres psql -U counterwell -d restore_check -c "select count(*) from retail_invoices"
$c exec postgres dropdb -U counterwell restore_check
```

**Down alerts.** `/health` also reports `backupAgeHours`, the age of the newest backup (once
encrypted copies exist, of the newest encrypted one, so a broken encryption step shows up too).
`.github/workflows/uptime.yml` checks it from GitHub every 30 minutes and fails when the server does
not answer, or the newest backup is older than 26 hours; GitHub emails the repository owner when a
scheduled run fails. It reads the full health address from the repository variable `HEALTH_URL`
(Settings → Secrets and variables → Actions → Variables; the value looks like
`https://<server>/health`), falling back to the production address above. Separately, the worker sends the owner's phone **one** notification when a shop's gateway
(the shop PC) has been silent for more than 30 minutes, and one when it is back; shops whose
gateway never reported are never alerted, and a restart of the server does not repeat the alert.

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
The gateway also copies the server's encrypted database backups (section 6); it needs nothing extra for
that, only the `GATEWAY_TOKEN` it already has.

## 8. Updating the server

```bash
git pull && docker compose -f deploy/compose.yaml --env-file deploy/.env up -d --build
```

The database is updated in place; phones keep working offline during the minute the API restarts.
