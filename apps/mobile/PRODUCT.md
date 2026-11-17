# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

One Expo / React Native codebase ships to Android (APK) and iPhone (TestFlight) with a single brand language. Each OS keeps its own guarantees: safe areas, system Back on Android, edge-swipe back on iOS, keyboard insets, Reduce Motion. A browser preview (`?demo=owner` / `?demo=employee`) exists for demos only.

## Users

- **Counter staff** in a small Indian shop. They bill customers all day on a shared or personal phone, often with a queue waiting, under bright tube lights. Many are not tech-savvy and read Hindi more comfortably than English.
- **Shop owner.** Often not at the counter. Uses their own phone to approve credit, discounts and refunds, see the day's sales and drawer differences, manage stock and staff.
- Phones are a mix of mid-range Android and iPhone; there is no strong lean either way.

## Product Purpose

Counterwell is billing plus accountability for a small shop. Every bill, credit (udhaar), discount, refund, stock movement and drawer count carries the name of the person who did it, so the owner can see where money and stock went. It began as an anti-theft tool for one pharmacy, and the product will be sold to any small Indian retail shop, with pharmacy as one mode (batches, expiry, Rx).

Success: staff bill as fast as they do today, the owner trusts the numbers enough to stop checking the drawer by hand, and a shop owner who sees a demo wants it.

## Positioning

Not just billing software: a named record of every rupee and every item. Blind drawer counts, owner-approved credit and discounts, and a day report that names who opened and closed the drawer. Works offline for cash bills. Voice entry in Hindi/English mixed speech ("Dolo 650 do patta").

## Operating Context

- Staff phone flow: open the drawer with a blind count, sell (search, scan, or voice), collect cash / UPI / split / credit, hold orders, hand off to a cashier, request returns, close the drawer.
- Owner phone flow: Overview, approvals in Reviews (push notification), Money (day reports, history), Inventory (stock, expiry, receiving supplier bills by photo, stock counts), Administration (shop, employees, devices).
- Two languages, English and Hindi, chosen per phone. Every daily screen exists in both.
- The internet can drop; cash billing continues offline and syncs later.
- Receipts print later on the shop's thermal printer through a shop PC gateway.

## Capabilities and Constraints

- All existing functions, copy meaning, roles and flows must survive a redesign; it is a visual and interaction revamp, not a feature change.
- Hindi text (Devanagari) must render at the same quality as English; labels can be about 30% longer.
- Money is shown in rupees with paise (₹2,257.00); numbers must be tabular and unambiguous.
- Fonts must be bundled (expo-google-fonts or local files); no network font loading at runtime.
- Expo SDK 57, React Native 0.86, Reanimated 4 and @expo/vector-icons are available.

## Brand Commitments

- The name **Counterwell** stays. Logo mark, colour, and type are open.
- Must not feel like: a generic SaaS dashboard, cluttered legacy billing software (Marg / Tally), a toy, or a cold banking app.

## Evidence on Hand

- Current screens: `.data/artifacts/gallery/shots/` (98 captures, English and Hindi, staff and owner).
- Synthetic demo shop data on the test server ("Sharma Medical Store (test)").
- No real customers, testimonials, pricing or metrics exist yet; none may be invented.

## Product Principles

1. The counter is never kept waiting: the most common action on any screen is the most reachable.
2. Every number has a name next to it: who did it, when.
3. Calm, not alarming: problems are stated plainly with what to do next.
4. Equal in Hindi and English.
5. Serious about money, warm toward people.

## Accessibility & Inclusion

Readable at arm's length under bright light; touch targets at least 48 dp; text follows the system font size where practical; colour is never the only signal for status.
