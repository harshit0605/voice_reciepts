# Counterwell demo for the shop owner (about 10 minutes)

The goal is to show that every rupee and every strip now carries a name. Each bill, credit, discount and drawer count is tied to the staff member who did it, and the owner sees it on their own phone.

Run it once by yourself the day before.

## Before the demo

- **Two phones:**
  - Owner phone: the iPhone with the TestFlight build, signed in with the owner login, notifications allowed.
  - Staff phone: an Android phone, or the emulator, with the latest APK, signed in with the staff login.
- **Start with the drawer closed.** On the staff phone, open More → Cash drawer. If it shows a drawer that's open, close it, so the demo starts with an opening count.
- **Stock:** the test shop has demo medicines (Dolo 650, Azithral 500, ORS and others) plus three short-dated batches for the expiry list:
  - one Dolo batch that expired on 10 Nov 2026;
  - one Azithral batch that expires within 30 days;
  - one ORS batch that expires within 90 days.
- **Hindi:** if the owner or staff prefer Hindi, switch it under More → Language on both phones.

## 1. The problem, in one line (30 s)

"Right now everyone takes change from one drawer and nothing is written down. If money is short, nobody knows when or who. This app gives every bill and every drawer count a name."

## 2. Staff opens the drawer (1 min) — staff phone

1. More → Cash drawer → **Count and open drawer**.
2. Enter the notes and coins in the drawer, then open it.

**Point to make:** the count is blind. Staff don't see what the app expects, so they can't make the count match. They have to count what's really there.

## 3. A normal cash bill (2 min) — staff phone

1. **Sell** → type "dolo".
2. Note that the expired Dolo batch never appears. The app only offers stock that's still in date.
3. Tap **Add**, choose the **strip** chip, set 2, then **Batch … checked · Add**.
4. Tap the **Current sale** bar → **Review & collect** → **Cash**, and enter the cash received. It shows the change to return.
5. Tap **Confirm payment & create bill**. The receipt opens. Printing comes later, with the shop's printer.

**Optional:** tap **Voice / text** on Sell and say "Dolo 650 ek patta, ORS do packet". The app turns it into lines for staff to check before adding. Try this once beforehand, since it needs the internet and a quiet-enough room.

## 4. Credit needs the owner's OK (2 min) — both phones

1. **Staff phone:** add an item → **Current sale** → **Review & collect** → **Credit**.
2. Pick a customer or tap **New customer**: type a name, then **Save customer**. The customer stays chosen.
3. Tap **Ask the owner to approve credit**. Staff see a confirmation, and the bill waits in Orders under the customer's name.
4. **Owner phone:** an "Approval needed" notification arrives within seconds. Tapping it opens **Reviews**; approve the request.
5. **Staff phone:** within about 8 seconds a banner says the owner approved the credit. **Orders** → the bill → **Collect payment**. It opens on Credit with the amount filled in; tap **Confirm payment & create bill**.

**Point to make:** staff can't give credit (udhaar) or discounts on their own, and every credit is on record against a named customer. Discounts work the same way: in **Collect payment**, enter **Request discount (₹)** and tap **Ask owner to approve discount**.

## 5. The owner's view (2 min) — owner phone

1. On a phone the owner's screens live under **More**. Open **Overview**: today's sales, cash expected in the drawer, and items that need attention. One of them reads "3 batches are expired or expiring within 90 days".
2. Tap it to open the **expiry list**:
   - the expired Dolo batch, with its value at cost;
   - the Azithral batch due within 30 days;
   - the ORS batch due within 90 days.
3. Tap the expired Dolo row, then **Take off the shelf**. The quantity is filled in. The stock leaves the sellable count but stays on record until it's disposed of.

**Point to make:** expired stock no longer hides in the count, and money stuck in short-dated stock shows up early enough to return it to the supplier.

## 6. Closing the drawer (1.5 min) — both phones

1. **Staff phone:** More → Cash drawer → **Close drawer**.
2. Count the notes again and enter what to **Leave in the drawer for the next opening**; the rest goes to the owner. Staff only see "Drawer closed. The owner gets the day report", with no figures.
3. **Owner phone:** a "Day report ready" notification arrives. Open More → **Money** → **End-of-day reports** → today's row and show:
   - the day's sales, split into cash, UPI and credit;
   - the cash counted against the cash expected;
   - any difference, with who opened and who closed.

**Point to make:** this is the screen that answers "where did the money go". A shortage shows the same day, against a named count.

## 7. What happens next (30 s)

To go live, four things are needed from the shop:

1. **Catalogue:** the name of the billing software they use now, and an export of its medicines and stock. The app imports it.
2. **Printer:** make, model and paper width, so bills print on their current printer.
3. **Shop PC:** a short setup at the shop, so printing and the daily backup copy run there.
4. **Shop details and stock:** GSTIN, drug licence and address for the bills, then one opening stock count of every batch and its expiry date.

Also agree who opens, counts and closes the drawer each day.

## Questions the owner may ask

- **"What if the internet goes down?"** Cash bills keep working on the phone and send automatically when it's back. UPI, credit, discounts and collecting a held bill need the internet.
- **"Is the data safe?"** The data sits on our own server. An encrypted backup is made every day, and a copy is kept off the server too. We've tested restoring from it.
- **"Can staff delete a bill?"** No. A return is its own record and needs the owner's approval, and the original bill stays.
- **"Does it work in Hindi?"** Yes, all the daily screens: billing, the drawer, orders and stock. A few owner settings are still in English. Each phone picks its own language under More → Language.
