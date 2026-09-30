# Shop PC remote setup

The shop's Windows PC will run the shop gateway (receipt printing, offline sale backup). The owner is not at the shop, so an employee runs one setup file that makes the PC reachable over the owner's Tailscale network. The gateway and printer can then be installed and tested remotely.

## What the setup does

`scripts/windows/shop-pc-setup.ps1` hides nothing. It lists what it changes, logs everything in `C:\ProgramData\CounterwellRemote`, and can be run again safely.

1. **Tailscale:** installs it and joins the owner's network as `counterwell-shop`. It runs unattended and starts with Windows.
2. **Support account:** creates a local administrator, `cwsupport`. Its random password is saved in `C:\ProgramData\CounterwellRemote\support-account-password.txt`, which only administrators can read. It is needed only for Remote Desktop.
3. **SSH server:** installs Windows OpenSSH.
   - Only the owner's SSH key can sign in; password sign-in is off.
   - SSH answers only on Tailscale addresses (`100.64.0.0/10`), not the shop Wi-Fi or the internet.
4. **Remote Desktop:** enabled on Tailscale addresses only, on Windows Pro. Windows Home cannot host it; SSH still works there. A Remote Desktop sign-in takes the screen away from whoever is at the PC.
5. **Power:** turns off sleep and hibernate on mains power.
6. **Gateway tools:** installs Git and the newest Node.js LTS.
7. **Report:** saves one to `C:\ProgramData\CounterwellRemote\shop-pc-report.txt`. It lists:
   - Windows version and free disk space;
   - network addresses;
   - printers and their ports, including whether any network printer answers Epson ePOS (what the gateway needs);
   - installed software, such as the current billing program, whose export could seed the catalogue.

Every download is checked for a valid publisher signature before it is installed. The downloads are:

- Tailscale from `pkgs.tailscale.com`;
- OpenSSH from Windows Update, or Microsoft's GitHub release if Windows Update fails;
- Git from `git-for-windows`;
- Node.js from `nodejs.org`.

## For the owner: build and send it

```bash
node scripts/windows/build-shop-pc-setup.mjs
```

This reads the Tailscale auth key from `.data/shop-pc/tailscale-authkey.txt` and your public key from `~/.ssh/id_ed25519.pub` (`--ssh-key` to choose another). It writes two files to `.data/shop-pc/`. That folder is git-ignored because both files contain the auth key.

- `counterwell-shop-setup.cmd`: one file to double-click. Send it privately (WhatsApp document, Google Drive or a USB stick). **Gmail blocks `.cmd` attachments.**
- `paste-into-admin-powershell.txt`: the same setup as one line to paste into an administrator PowerShell. It downloads the script from GitHub at a fixed, reviewed commit. Use it if the file is blocked. Regenerate after pushing any change to the script.

Before sending, in the Tailscale admin console (Settings → Keys):

- Make the key **single-use**, **pre-approved** and short-lived, and not ephemeral. It has already travelled by email and screenshot, so treat it as seen; a used single-use key is harmless.
- Better, give it a **tag** such as `tag:shop` and an ACL that lets the shop PC reach only what it needs. By default every device on a personal tailnet can reach every other one, including your laptop.
- After the PC appears, **disable key expiry** for it (Machines → counterwell-shop), or it will drop off the network after 180 days.

Test the script without Windows (uses PowerShell 7, e.g. `brew install powershell`):

```bash
pwsh scripts/windows/test-shop-pc-setup.ps1
```

This runs a fresh PC, a second run, and the fallback paths against stand-ins for Windows commands. One real run on the shop PC is still the final check.

## For the employee at the shop

1. Make sure the PC is plugged in and on the internet.
2. Save `counterwell-shop-setup.cmd` to the Desktop and double-click it.
   - If Windows says "Windows protected your PC", click **More info**, then **Run anyway**.
   - When Windows asks "Do you want to allow this app to make changes?", click **Yes**. An administrator password may be needed.
3. Wait 5–15 minutes with the window open. If it asks for the Tailscale key, copy it from the owner's email and paste it with a right-click.
4. When it says **All done**, send the owner a photo of the window. Then delete the setup file.

If it stops with a red message, send a photo of the window. The log is in `C:\ProgramData\CounterwellRemote`.

## After the PC is online

```bash
tailscale status | grep counterwell-shop
ssh cwsupport@counterwell-shop        # or its 100.x address
type C:\ProgramData\CounterwellRemote\shop-pc-report.txt
```

Then install the gateway from the Mac (it copies the settings over SSH; see [DEPLOY.md](DEPLOY.md#7-the-shop-pc-gateway)):

```bash
node scripts/windows/install-gateway.mjs --host cwsupport@counterwell-shop --printer <printer IP>
```

- **Network Epson ePOS printer** (the report shows an IP port that answered ePOS): pass its address as `--printer`, then set the Local gateway URL the installer prints in the app (More → Administration).
- **USB or other printers:** the gateway cannot print to them yet; it needs a Windows spooler path first. The report shows which kind the shop has.
- **Server:** the gateway talks to the production server (`https://counterwell.72.62.241.119.sslip.io`) and gets only the public key for offline permissions.
