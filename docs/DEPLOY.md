# Running Counterwell for a real shop

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
installing apps from that source. iPhones need an Apple Developer account and TestFlight; that is
not set up yet.

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

The gateway runs on the shop's Windows PC (set up with [SHOP-PC-SETUP.md](SHOP-PC-SETUP.md)). It
prints receipts and keeps a second copy of every sale a phone makes while offline. Give it a `.env`
in the repository folder on that PC:

```
BETTER_AUTH_URL=https://<DOMAIN>          # the server
BUSINESS_ID=<same as the server>
GATEWAY_TOKEN=<same as the server>
OFFLINE_VERIFY_KEY=<public key from make-offline-keys>
PRINTER_HOST=<printer IP on the shop Wi-Fi>
```

Start it with `npm run dev:gateway` and check `http://localhost:4101/health`. Give the PC a fixed
address on the shop Wi-Fi (a reservation in the router), then in the app set More →
Administration → Local gateway URL to `http://<that address>:4101`. The owner's Overview shows
whether the gateway is reporting.

## 8. Updating the server

```bash
git pull && docker compose -f deploy/compose.yaml --env-file deploy/.env up -d --build
```

The database is updated in place; phones keep working offline during the minute the API restarts.
