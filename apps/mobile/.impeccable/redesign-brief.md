# Counterwell redesign: brief for screen builders

You are restyling existing React Native screens into the **Register & Stamp** design world. This is a visual and interaction revamp. Behaviour, data flow, permissions, and copy meaning must not change.

## The world in one paragraph

The shop's register, made live. Screens are white register paper. Pale-blue ruling is the only divider. Dated entries carry a fixed left time column and a 1px red margin rule. Black ink carries text, and ballpoint blue is the single action colour. Decisions land as rubber stamps in their own inks: violet Approved, red Declined/Short, green Paid, amber Waiting. Hierarchy comes from size: huge totals, small labels, no boxes around numbers. Every record shows its number (bill no., drawer, batch code) as a real identifier. Every person's initials mark sits beside the entries they made. Destructive actions sit apart, behind empty space.

Must NOT feel like a generic SaaS dashboard (cards, gradients, purple), cluttered legacy billing (Marg/Tally), a toy, or a cold bank.

## What exists (do not edit these files)

- `src/theme.ts`: palette, staffInk(), initials(), fonts, type scale, space, radius, TIME_COLUMN, TOUCH, shadow.
- `src/ui.tsx`: import everything from here:
  - `Txt` props: size (sp, floor 12), `weight` 400|500|600|700 (`bold` = 600), `num` (tabular figures, use for every amount/count/time), `color`, `muted` (= ink3), `center`.
  - `Amount value={rupees(p)} size weight color`. Use it for all money; at size ≥22 the paise render smaller.
  - `Button` variants: `primary` (default), `secondary` (or the `secondary` prop), `quiet`, `danger`. Also `small` and `icon`. Normal height 52, small 44.
  - `Field` props: label, hint, error, number, secret, identifier, inputRef, returnKeyType, onSubmit.
  - `Chip active`: segmented choices and filters.
  - `Badge tone`: info | waiting | approved | declined | paid | neutral (`warning` = waiting). Small inked labels for state, counts and tags.
  - `Stamp tone date land tilt size="sm|md|lg"`: decisions only (bill paid, approved, declined, drawer matches/short). `land` plays the one signature motion. Use it on the moment a decision is shown, not on every list row.
  - `stampDate(at, language)` gives "17 Nov · 12:49". `clock(at)` gives "12:49".
  - `StaffMark id name size`: a person's initials in their ink.
  - `Entry time title detail who amount amountColor trailing onPress children`: the dated register row (time column, red margin, content, amount right edge). Use it for anything that happened at a time: bills, orders, approvals, drawer counts, day reports (pass a short date like "16 Nov" as `time`).
  - `ListRow leading title detail trailing onPress chevron children`: a plain ruled row for things that aren't dated (medicines, customers, settings, people).
  - `Line label value strong color note`: a statement line (label left, figure on the right edge). `TotalRule` is the ledger double rule above a total.
  - `Section title action`: a heading on a firmer rule.
  - `Banner tone onPress onClose`, `Empty icon title detail`, `Panel` (a bordered block; use sparingly), `Sheet` (bottom sheet; unchanged API), `Row`, `Icon` (Ionicons only).
  - `colors` still exists with legacy names (bg, muted, accent, tint, amber, red…) mapped to the new palette, so old code compiles. Prefer `palette.*` names in code you touch.
- `src/screens.tsx` `Page title subtitle action`: the screen scaffold (already restyled).
- `src/App.tsx`: header, tab bar, banners, sign-in (already restyled).

If you need a primitive that doesn't exist, build it locally in your own file and mention it in your report. Don't edit ui.tsx or theme.ts.

## Composition rules

1. **Rows over cards.** Lists are ruled rows edge to edge within the 20px gutter. No card stacks, no nested cards, no icon tiles (no coloured squares behind icons). Category icons on product rows are noise; drop them unless they carry information.
2. **Amounts on the right edge.** Every money figure in a list ends on the same right edge, uses `num`/`Amount`, and is never boxed.
3. **One primary per region.** The most common action on a screen is the biggest and most reachable, near the bottom where thumbs are. Secondary actions use `secondary`/`quiet`. Destructive actions (Cancel order, Decline, Remove, Sign out, Revoke) use `danger` or quiet red text, placed apart: their own row, right-aligned or at the end, with ≥16px of space from anything else.
4. **Identifiers are first-class.** Bill/order numbers, batch codes, and counter IDs are set in `num` at weight 600, not as grey small print.
5. **Who and when.** Where an entry has a person, show `StaffMark` (or the name) and a time.
6. **States are words in ink.** Use `Badge tone` for row state, `Stamp` for a decision moment, and never colour alone: always a word or an icon too.
7. **Type scale only:** 40 (big total), 28 (screen title), 22 (sheet title), 19 (section), 16 (body, row title), 14 (secondary, labels), 13 (meta), 12 (badge/micro). No 10/11px text. Use `size` values from that list.
8. **Spacing:** 20 gutter; rows ≥60 tall; 8/12/16/24/32 rhythm; more space above a section than below its heading.
9. **Touch:** every tappable target ≥48px tall (use hitSlop for small icons).
10. **Forbidden:** gradients, glass/blur, emoji as icons, coloured left borders thicker than 1px, eyebrow/kicker labels above headings, big-number tile grids (the "hero metric" template), drop shadows on rows, uppercase body text, letter-spaced grey labels.
11. **Hindi:** every visible string goes through `Txt` (which translates via copy.hi.ts). If you add a new visible English string, add its Hindi to `src/copy.hi.ts`: append entries just before the final `};` with a small Edit, re-reading the file if the Edit fails (other agents append too). Prefer reusing existing strings. Devanagari runs ~30% longer, so allow wrapping and never fix widths on text.
12. **Keep:** every handler, condition, test ID, accessibilityLabel, accessibility role, and keyboard behaviour (KeyboardAvoidingView, inputRef/onSubmit chains, Keyboard.dismiss). If you restructure JSX, move logic as-is.

## Verify

- Typecheck from the repo root with `npx tsc --noEmit`. Only your files must be clean; others are mid-edit.
- Web preview runs at `http://localhost:8095/?demo=employee` (staff) and `?demo=owner`. Open **your own tab** with `mcp__Claude_Browser__tabs_create` and pass its tabId to every browser call. Set `resize_window preset mobile` on that tab, navigate, and screenshot. Never navigate someone else's tab. The demo data is in memory and resets on reload.
- Run at most two screenshot rounds: build everything, inspect once, fix in one batch, confirm once. Save 2–4 final screenshots of your screens to `/Users/harshit/Code/Agency/voice_reciepts/.data/redesign/<your-area>/` (create it), via `computer screenshot`; the tool result gives the saved path; copy it there with `cp`.
- Don't commit, push, run builds, start or stop servers, or touch git state.

## Report

When done, list: files changed; what each screen now looks like (one line each); any behaviour you weren't sure you preserved; any new copy strings added; any primitive you wish ui.tsx had; screenshot paths.
