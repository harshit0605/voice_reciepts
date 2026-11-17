---
name: Counterwell
description: The shop's register, made live. Ruled entries with a name and a time, decisions landed as dated stamps.
colors:
  paper: "#FFFFFF"
  desk: "#F1F4F8"
  ink: "#14171C"
  ink-2: "#495160"
  ink-3: "#68707D"
  rule: "#DCE3EE"
  rule-strong: "#B4C2D8"
  margin-red: "#E0564A"
  ballpoint-blue: "#1F3FAA"
  ballpoint-blue-pressed: "#17318A"
  blue-tint: "#E9EEFB"
  approved-violet: "#5B3FB2"
  approved-tint: "#F0ECFA"
  declined-red: "#BF3428"
  declined-tint: "#FCEBE9"
  paid-green: "#16774A"
  paid-tint: "#E5F3EB"
  waiting-amber: "#935600"
  waiting-tint: "#FDF1DC"
  scrim: "rgba(16, 22, 34, 0.42)"
  staff-ink-magenta: "#9C2F6C"
  staff-ink-teal: "#0E6E7C"
typography:
  total:
    fontFamily: "Counterwell Anek (Anek Devanagari, patched metrics)"
    fontSize: "40sp"
    fontWeight: 700
    lineHeight: 1.2
    fontFeature: "tnum"
  title:
    fontFamily: "Counterwell Anek"
    fontSize: "28sp"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.4px"
  sheet-title:
    fontFamily: "Counterwell Anek"
    fontSize: "22sp"
    fontWeight: 700
    lineHeight: 1.45
  heading:
    fontFamily: "Counterwell Anek"
    fontSize: "19sp"
    fontWeight: 600
    lineHeight: 1.45
  body:
    fontFamily: "Counterwell Anek"
    fontSize: "16sp"
    fontWeight: 400
    lineHeight: 1.45
  row-title:
    fontFamily: "Counterwell Anek"
    fontSize: "16sp"
    fontWeight: 600
    lineHeight: 1.45
  label:
    fontFamily: "Counterwell Anek"
    fontSize: "14sp"
    fontWeight: 500
    lineHeight: 1.45
  small:
    fontFamily: "Counterwell Anek"
    fontSize: "13sp"
    fontWeight: 400
    lineHeight: 1.45
  micro:
    fontFamily: "Counterwell Anek"
    fontSize: "12sp"
    fontWeight: 600
    lineHeight: 1.45
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
  sheet: "22px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  xxl: "28px"
  xxxl: "40px"
  gutter: "20px"
  gutter-wide: "32px"
  time-column: "52px"
  touch: "48px"
components:
  button-primary:
    backgroundColor: "{colors.ballpoint-blue}"
    textColor: "{colors.paper}"
    typography: "{typography.row-title}"
    rounded: "{rounded.md}"
    padding: "0 20px"
    height: "52px"
  button-primary-pressed:
    backgroundColor: "{colors.ballpoint-blue-pressed}"
  button-secondary:
    backgroundColor: "{colors.blue-tint}"
    textColor: "{colors.ballpoint-blue}"
    rounded: "{rounded.md}"
    padding: "0 20px"
    height: "52px"
  button-quiet:
    textColor: "{colors.ballpoint-blue}"
    height: "52px"
  button-danger:
    textColor: "{colors.declined-red}"
    rounded: "{rounded.md}"
    padding: "0 20px"
    height: "52px"
  button-small:
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "44px"
  field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "10px 14px"
    height: "52px"
  chip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink-2}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "40px"
  chip-active:
    backgroundColor: "{colors.ballpoint-blue}"
    textColor: "{colors.paper}"
  badge:
    typography: "{typography.micro}"
    rounded: "{rounded.sm}"
    padding: "2px 7px"
  stamp:
    rounded: "{rounded.sm}"
    padding: "3px 10px"
  sheet:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.sheet}"
    width: "640px"
  panel:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.lg}"
    padding: "20px"
  sale-bar:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    padding: "0 20px"
    height: "64px"
  tab-active:
    backgroundColor: "{colors.blue-tint}"
    textColor: "{colors.ballpoint-blue}"
    rounded: "15px"
    height: "30px"
    width: "56px"
---

# Design System: Counterwell

## Overview

**Creative North Star: "Register & Stamp"**

Counterwell is the shop's paper register, made live. Every screen is a page of cool white register paper. Pale-blue ruling is the grid and the only divider. Where a page records dated events, a 1px red margin rule runs down it. Text is black ink. Ballpoint blue is the only action colour. Decisions don't sit in coloured boxes: they land as rubber stamps in their own inks, with a date line under the word. Each person has their own ink too, in the circled initials beside every entry they made.

The density is a ledger's, not a dashboard's. Lists are ruled rows that run edge to edge inside a 20dp gutter. Amounts are locked to one right edge in tabular figures. Size sets the hierarchy, not containers: the big total is just a 40sp figure with smaller paise, with no box around it. Bordered panels exist but are used sparingly. One family, Anek Devanagari (bundled with patched vertical metrics as "Counterwell Anek"), sets Hindi and English with matched forms, so both languages get the same quality.

The build turns down the card-stack SaaS dashboard and the floating + button. Nothing floats over the page except bottom sheets. The current sale is a heavy ink bar pinned above the tabs, not a FAB.

**Key Characteristics:**
- White paper, pale-blue rules, black ink, one blue for action.
- Stamps for decisions, Badges for states in lists, StaffMarks for people.
- Amounts end on the right edge in tabular figures. Paise are set smaller at display sizes.
- A fixed 52dp time column and a red margin rule on registers.
- One typeface for both scripts. Hindi always gets the full 1.45 line.
- Flat paper. Only sheets lift.

## Colors

Ink on paper with one action blue. Four stamp inks carry meaning and appear only where meaning applies.

### Primary
- **Ballpoint Blue** (`ballpoint-blue`): the only action colour. Primary buttons, the active chip, focused field borders, the cursor and selection, the active tab icon and label, the brand mark's ground. It darkens to **Pressed Blue** on press. **Blue Tint** is the ground for secondary buttons, the active tab pill and info badges.

### Secondary (stamp inks, by meaning)
- **Approved Violet** (`approved-violet` on `approved-tint`): owner approvals.
- **Declined Red** (`declined-red` on `declined-tint`): declined, short, errors, danger buttons, field error borders, offline.
- **Paid Green** (`paid-green` on `paid-tint`): paid, synced, confirmations.
- **Waiting Amber** (`waiting-amber` on `waiting-tint`): waiting for the owner, pending sync, low stock, the tab-bar count bubble.

Each tone is a pair: the ink sets text, icon and border, and the tint sets the ground. Badge, Banner, Notice, Stamp and the sync pill all read from the same `toneInk` map.

### Tertiary
- **Margin Red** (`margin-red`): the register's margin rule. It appears as the 1px left border of Entry rows, the RuledPaper backdrop, the empty-state page and the brand mark. It never marks a state.
- **Staff inks**: each person gets one of six inks, hashed from their id so it never changes. Four reuse the palette (blue, green, amber, violet), and two are their own (`staff-ink-magenta`, `staff-ink-teal`). They are used only for StaffMarks.

### Neutral
- **Paper** (`paper`): the ground of every screen, sheet and input.
- **Desk** (`desk`): the desk under the page. Quiet fills, pressed rows, the sheet close button, the empty sale bar, the demo strip, the neutral badge ground.
- **Ink / Ink 2 / Ink 3** (`ink`, `ink-2`, `ink-3`): primary text; secondary text and field labels (7.8:1); tertiary text, placeholders, time column and chevrons (4.9:1).
- **Rule** (`rule`): every divider, row bottom, header and tab-bar border.
- **Rule Strong** (`rule-strong`): ruling that has to read at a glance. Input and chip borders, the Section heading's underline, the sheet grabber.
- **Scrim** (`scrim`): behind sheets.

### Named Rules
**The One Blue Rule.** Ballpoint blue means "you can do this". It never decorates, and no second action colour exists.

**The Ink Means Something Rule.** Violet, red, green and amber appear only for their meanings. The margin red is a ruling line, never a status, and never thicker than 1px.

**The Not By Colour Alone Rule.** Every tone comes with an icon or words: Banners and Notices carry a tone icon, Stamps carry the word, and the sync pill always shows an icon.

## Typography

**Display, Body and Label Font:** Counterwell Anek (Anek Devanagari by Ek Type, bundled locally in four weights: 400, 500, 600 and 700).

**Character:** One humanist family carries both scripts, so a Hindi screen and an English screen have the same voice and weight. The face sets small, so the floor is 12sp and body is 16sp.

The bundled TTFs are Anek with only the vertical metrics rewritten (ascent 0.98em, descent 0.44em, win descent 0.56em; see `assets/fonts/patch-anek.py`). The stock 0.69em descent made Latin ride high in buttons and pills on iOS, and the stock ascent clipped Devanagari marks above display text. Don't swap in the stock Google Fonts files.

### Hierarchy
- **Total** (700, 40sp): the big money figure on approvals, receipts and day reports. Set through `Amount`, which shrinks the paise to 52% at weight 500 in ink 2 when the size is 22sp or more.
- **Title** (700, 28sp, -0.4 tracking): screen titles. Sign-in uses 34sp at -0.6.
- **Sheet title** (700, 22sp): the bottom-sheet header. Bill numbers use 22sp too.
- **Heading** (600, 19sp): Section headings, sitting on a rule-strong underline.
- **Body / Row title** (400 or 600, 16sp): reading text, and the titles of Entry and ListRow. Fields set input text at 17sp.
- **Statement line** (400/600 label, 500/700 figure, 15sp): the Line component in day reports and totals.
- **Label** (500, 14sp): field labels in ink 2, row detail, chips, Banner and Notice text (600).
- **Small** (13sp): the time column, hints, errors, sync text, sidebar group names.
- **Micro** (600, 12sp): Badges, stamp date lines, tab labels, the header date.

### Named Rules
**The Hindi Line Rule.** `Txt` sets the line height. Below 26sp, every line is 1.45 × size. At 26sp and up, English tightens to 1.2 and Hindi keeps 1.45, because Devanagari marks rise to 0.98em above the baseline. Always set text through `Txt` (or `Amount`). Don't hard-code `lineHeight` on Hindi-capable text.

**The Bullet Operator Rule.** Anek kerns "·" (U+00B7) into the space after it, so "a · b" draws as "a ·b". `Txt` swaps every middle dot for "∙" (U+2219), which has the same shape without the kerning. Write "·" in copy and let `Txt` do the swap. Text drawn outside `Txt` has to do the swap itself.

**The Tabular Figures Rule.** Every amount, count, bill number, time and stamp date is set with `num` (tabular-nums). Number fields set tabular figures too.

**The 12sp Floor Rule.** `Txt` clamps sizes to at least 12sp and caps system font scaling at 1.4×.

## Layout

**Grid.** The ruling is the grid. Content sits in a 20dp gutter on phones and 32dp on wide layouts. Spacing steps by 4 (4, 8, 12, 16, 20, 28, 40). Sections are 32 apart. Rows have a 60dp minimum height. Touch targets are 48dp on both platforms.

**Registers.** A dated list (Entry) uses a fixed 52dp time column (24-hour "12:49", 13sp ink 3), then the 1px margin-red rule, then the entry with a 12dp inset. The title line shares its width with the StaffMark and the amount. Detail and actions run the full width under it. Undated lists (medicines, people, settings) use ListRow: ruled, no time column, with a chevron when tappable.

**Right edge.** Amounts, prices and statement figures end on the row's right edge. Totals sit under a ledger double rule (two 1px ink lines, 2dp apart).

**Responsive.** The wide layout starts at a window width of 768dp. At 768 and up, a 248dp sidebar replaces the bottom tab bar. It holds the Wordmark, "Counter" and "Management" groups, and the signed-in person's StaffMark at the foot. The header gains the long date, and the sync pill always shows its words. Below 768, the header shows the BrandMark, the shop name and a short date. The bottom tab bar has five tabs, owner screens open from More, and the current sale is pinned above the tabs as a 64dp ink bar. Sheets cap at 640dp wide and 93% tall.

**Header.** Shop name (16/700) over the date and counter (12/500, ink 3). On the right are a language pill ("हिंदी" / "EN") and the sync pill, both 34dp high.

### Named Rules
**The Sync Glyph Rule.** On phones the sync state is an icon plus its tone colour: a tick on paid-green tint when synced, a clock on amber when bills are pending, a slashed cloud on red when offline. Words appear only when there's something to say ("3 pending", "Offline"). Synced shows the icon alone. On wide layouts the words always show.

**The Apart Rule.** Destructive actions (the `danger` button: red outline, red text, no fill) sit apart from other buttons, separated by space. They never share a row with a primary action.

## Elevation & Depth

The system is flat paper. Rows, panels, the header and the tab bar sit on the page with no shadow. Depth comes from ruling and from the desk tone behind or under things. The one lifted surface is the bottom sheet, which slides up over the scrim with a single soft shadow.

### Shadow Vocabulary
- **Sheet lift** (iOS/web `shadowColor #0F1A2E, opacity 0.12, radius 18, offset 0/6`; Android `elevation 6`): bottom sheets only.

### Named Rules
**The Only Sheets Lift Rule.** Nothing else gets a shadow. A block that needs grouping gets a Section rule or, sparingly, a 1px-ruled Panel.

## Shapes

Gentle, consistent corners. Buttons, fields and chips use 10dp. Badges, Notices and Stamps use 6dp, and the Stamp's inner border uses 3dp. Panels use 14dp. Sheets round their top corners at 22dp. Pills (language and sync, plus the 15dp tab highlight) are fully round. StaffMarks are circles. Borders are 1px in rule or rule-strong. Focus thickens a field's border to 2px blue. The Stamp is the one double-bordered shape.

## Components

### Buttons
- **Shape:** gently rounded (10dp). 52dp tall, or 44dp when `small`. Optional leading Ionicon.
- **Primary:** filled Ballpoint Blue with white 16/600 text. One per screen region. Presses to Pressed Blue at 0.985 scale.
- **Secondary:** blue text on Blue Tint. **Quiet:** blue text only. Non-primary buttons drop to 0.65 opacity on press.
- **Danger:** red 1px outline, red text, no fill. Always placed apart.
- **Disabled:** 0.4 opacity.

### Chips
- **Style:** a choice among a few (unit, payment method, filter). 40dp tall, 10dp radius, 1px rule-strong border, ink-2 14/500 text on paper.
- **Selected:** filled blue with white 14/600 text.

### Badges
- **Style:** a small inked label for a state, count or tag in a list row. Tone tint ground, 2-hairline border in the tone ink, 12/600 tabular text, 6dp radius. Tones: info, waiting, approved, declined, paid, neutral.

### Stamps (signature)
- **Style:** the rubber stamp. Outer border in the tone ink (2px, or 1.5px for `sm`), a gap, an inner 1px border, then the word in capitals (700, tracked 8%) with an optional date line ("17 NOV ∙ 12:49", 12/600 tabular). It tilts -4° by default. Sizes: sm 12sp, md 15sp, lg 22sp.
- **Motion:** `land` plays once. The stamp comes down from 1.7× scale and full transparency, settling in 340ms with exponential ease-out. Reduce Motion skips straight to the end state.
- **Use:** decision moments only. The receipt's Paid/Credit stamp (lg, lands), the approval sheet's Approved/Declined (md, lands), the approved bill in payments (sm), and the day report's drawer Difference (md, toned by short or over).

### StaffMarks
- **Style:** circled initials in the person's own ink (1.5px ring, 700 text). 24dp in Entry, 26dp by default, 36dp in the sidebar footer.

### Rows
- **Entry:** a register row. Time column, margin rule, title, StaffMark, right-edge Amount. Pressed state is a desk fill.
- **ListRow:** a ruled row with optional leading, title (16/600), detail (14 ink 2), trailing and chevron. 13dp vertical padding.
- **Line:** a statement line, label left and figure right-aligned at 15sp, baseline-aligned, ruled beneath. `strong` makes it ink 600/700.
- **TotalRule:** the ledger double rule under a total.

### Inputs / Fields
- **Style:** paper ground, 1px rule-strong border, 10dp radius, 52dp tall, 17sp text. Label above at 14/500 ink 2. Hint below at 13 ink 3.
- **Focus:** a 2px blue border, with padding compensated so nothing shifts.
- **Error:** declined-red border and the error text in red below. It states what's wrong and how to fix it.
- **Identifier fields** turn off autocorrect and spellcheck.

### Banners and Notices
- **Banner:** a full-width strip under the header. Tone tint, tone icon, 14/600 text in the tone ink, and a chevron (tappable) or close. 48dp minimum, ruled beneath. The header shows at most two attention banners.
- **Notice:** an in-page tinted band with 6dp radius, an icon and text in the tone ink, and optional actions under it. Not tappable. Declined Notices announce as alerts.

### Sheets
- **Style:** paper with 22dp top corners and the only shadow. A grabber (38×4 rule-strong), a 22/700 title, and a round 40dp desk close button, all on a ruled header. The body sits in the 20dp gutter. Touches are ignored for 400ms after opening so a double tap can't land on the new sheet.

### Navigation
- **Phone tab bar:** five tabs on paper with a top rule. 22dp Ionicons plus 12sp labels in ink 2. The active tab gets the filled icon, blue label (600) and a 56×30 Blue Tint pill. The pill is always drawn and only its opacity changes. The count bubble is amber with a paper ring.
- **Wide sidebar:** described under Layout.

### Current Sale Bar (signature)
- **Style:** 64dp, pinned above the tabs on phones. With items it is a heavy ink bar: white "Current sale", item count in pale grey, and a 24/700 white Amount with a chevron-up on the right. Empty, it sits on desk with ink-2 text.

### Brand Mark and Ruled Paper
- **BrandMark:** a blue rounded square (26% radius) holding three white ruled lines (the last 62% long) and a red margin line. The app icons are drawn from the same geometry (`assets/make-icons.sh`). The **Wordmark** is the mark plus "Counterwell" at 700, -0.3 tracking.
- **RuledPaper:** a faint backdrop of 36dp rule lines at 0.7 opacity with a margin line at 0.55. **Empty** states draw a small ruled page with a margin and a quiet icon, a 17/600 title, and detail text capped at 300dp.

## Do's and Don'ts

### Do:
- **Do** set every string through `Txt` or `Amount` so the Hindi line height, the "∙" swap, the 12sp floor and the font-scale cap apply.
- **Do** end every amount on the right edge in tabular figures, with paise set smaller at 22sp and up.
- **Do** use a Stamp only at a decision moment (receipt, approval, day-report difference), and a Badge for state in list rows.
- **Do** put a StaffMark beside every entry a person made, and a 24-hour time in the 52dp column on dated registers.
- **Do** keep one primary blue button per screen region, and set danger buttons apart.
- **Do** switch to the sidebar at 768dp and show sync as icon-plus-colour on phones, with words only for pending or offline.
- **Do** keep touch targets at 48dp or more.

### Don't:
- **Don't** add a second action colour, or use stamp inks or the margin red for decoration.
- **Don't** box numbers or stack cards. Hierarchy is by size and ruling. Use Panel sparingly.
- **Don't** add a floating action button. The current sale lives in the pinned ink bar.
- **Don't** give anything but sheets a shadow.
- **Don't** make the margin rule thicker than 1px.
- **Don't** let colour be the only signal for a status.
- **Don't** replace the bundled Counterwell Anek files with stock Anek, or load fonts over the network.
