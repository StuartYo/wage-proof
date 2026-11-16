---
name: Wage Proof (工資對帳存證)
description: A dark, hairline issue tracker where each wage record is a row someone owes an answer on, with a deadline.
colors:
  canvas: "#08090a"
  bg: "#0f1011"
  surface-1: "#141516"
  surface-2: "#18191a"
  surface-3: "#1f2023"
  line: "#23252a"
  line-strong: "#34343a"
  line-stronger: "#3e3e44"
  ink: "#f7f8f8"
  ink-2: "#d0d6e0"
  ink-3: "#8a8f98"
  ink-4: "#7d828a"
  primary: "#5e6ad2"
  primary-hover: "#4f5bc4"
  primary-soft: "rgba(94, 106, 210, 0.16)"
  status-pending: "#f2c94c"
  status-confirmed: "#4cb782"
  status-disputed: "#eb5757"
  status-expired: "#8a8f98"
typography:
  title:
    fontFamily: "Geist, PingFang TC, Microsoft JhengHei, Noto Sans TC, sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: "26px"
    letterSpacing: "-0.2px"
  body:
    fontFamily: "Geist, PingFang TC, Microsoft JhengHei, Noto Sans TC, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  ui:
    fontFamily: "Geist, PingFang TC, Microsoft JhengHei, Noto Sans TC, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.5
  caption:
    fontFamily: "Geist, PingFang TC, Microsoft JhengHei, Noto Sans TC, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.4
  data:
    fontFamily: "Geist Mono, ui-monospace, Consolas, monospace"
    fontSize: "12.5px"
    fontWeight: 500
    lineHeight: 1
  clock:
    fontFamily: "Geist Mono, ui-monospace, Consolas, monospace"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.5px"
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  full: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  gutter: "24px"
components:
  button:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    typography: "{typography.ui}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 12px"
  button-hover:
    backgroundColor: "{colors.surface-3}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    typography: "{typography.ui}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 12px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-primary-lg:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    height: "36px"
    padding: "0 16px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-3}"
    rounded: "{rounded.md}"
    height: "32px"
  field:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "0 10px"
  row:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    height: "44px"
    padding: "0 24px"
  row-selected:
    backgroundColor: "{colors.primary-soft}"
  group-header:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink-2}"
    height: "36px"
    padding: "0 24px"
  panel-header:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.ink}"
    height: "52px"
    padding: "0 20px"
  action-box:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.lg}"
    padding: "14px"
  option-card:
    backgroundColor: "{colors.surface-1}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "12px 14px"
  option-card-selected:
    backgroundColor: "{colors.primary-soft}"
  tag:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.full}"
    height: "22px"
    padding: "0 8px"
  toast:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.lg}"
    padding: "12px 14px"
---

# Design System: Wage Proof (工資對帳存證)

## Overview

**Creative North Star: "The Open Ticket"**

Wage records are drawn as an issue tracker. Each record is a row that someone owes an answer on, with a deadline running against it. The interface refuses the landing-page arrangement (no hero, story section, stats band, or card grid) because the only job is to let a reviewer register a report, answer as the employer, and read the contract's refusal in under a minute. It is an Operate-mode product surface, dense and calm, in Traditional Chinese.

Tokens come from the Linear app system (via the design-md-library reference): a near-black canvas, a four-step charcoal surface ladder, 1px hairlines, and one lavender accent. Geist and Geist Mono stand in for Linear's own faces. Two values were adjusted from the reference for contrast: primary hover is darker (`#4f5bc4`) so white text keeps contrast on hover, and the quietest text is lifted to `#7d828a`.

Status is the only place colour carries meaning, and it never carries it alone: every status is a drawn icon whose shape differs, paired with a text label. Everything else is greyscale plus a single lavender.

**Key Characteristics:**
- Three-pane tracker: sidebar, grouped list, detail or composer panel.
- Flat tonal depth: surfaces step up in lightness, hairlines separate, shadows are nearly absent.
- Geist for words, Geist Mono for every ID, amount, hash, block height and clock.
- Pending is a pie that fills as the deadline runs out, driven by chain time.
- Data is drawn, not decorated: bars, hatched shortfall, deadline track and gate ladder all encode values.

## Colors

A monochrome charcoal ladder with one lavender accent and four status hues that appear only inside status icons, status text and their tinted tags.

### Primary
- **Linear Lavender** (`#5e6ad2`): the primary action (登記報告, 登記這份報告), and nothing else solid. Hover is **Pressed Lavender** (`#4f5bc4`).
- **Lavender Wash** (`rgba(94,106,210,0.16)`): the selected row, the checked option card, text selection, and the 3px focus glow on fields. Focus outlines use the same lavender at 70% alpha (`2px`, offset `2px`).

### Neutral
- **Canvas** (`#08090a`): page body and sidebar, the deepest layer.
- **Work Surface** (`#0f1011`): list and detail panel background.
- **Surface 1 / 2 / 3** (`#141516`, `#18191a`, `#1f2023`): group headers and inputs; buttons, tags, toast and nav-current; button hover and active segment.
- **Hairline** (`#23252a`), **Hairline Strong** (`#34343a`), **Hairline Stronger** (`#3e3e44`): dividers; control borders; hover borders and link underlines.
- **Ink** (`#f7f8f8`), **Ink 2** (`#d0d6e0`), **Ink 3** (`#8a8f98`), **Ink 4** (`#7d828a`): primary text; body and labels; secondary text; placeholder, end-of-track labels and small footnotes. Ink 4 was raised from the reference for contrast.

### Status (always icon shape plus text)
- **Pending Yellow** (`#f2c94c`): a pie icon that fills as time elapses; the live countdown number; the "due soon" text in a row.
- **Confirmed Green** (`#4cb782`): a filled circle with a check; confirmed tag; gate steps that meet the contract's requirement.
- **Disputed Red** (`#eb5757`): a filled circle with a cross; disputed tag; field and note errors; the hatched shortfall; gate steps that fall below the requirement.
- **Expired Grey** (`#8a8f98`): an outlined circle with clock hands.

### Named Rules
**The Lavender Is Rare Rule.** Lavender appears only on the primary action, the selected row or option (as the wash), and focus. It never colours text, icons, status, links or decoration.

**The Never Colour Alone Rule.** A status is always its own icon shape plus a text label (等待回應, 雇主確認, 雇主異議, 逾期未回應). Colour reinforces and is never the sole signal; this is a product accessibility commitment.

**The Status Colours Are Reserved Rule.** The four status hues mean only their status (and, for red and green, the gate ladder and errors that restate it). They are not used as brand or accent colours.

## Typography

**Text Font:** Geist (with PingFang TC, Microsoft JhengHei, Noto Sans TC, sans-serif), self-hosted variable woff2, weights 100 to 900, `font-display: swap`
**Mono Font:** Geist Mono (with ui-monospace, Consolas, monospace), self-hosted variable woff2, tabular numerals

**Character:** Quiet and exact. Geist carries the Latin and numerals while CJK falls through to the system faces; mono marks anything that is a value on the chain.

### Hierarchy
Base is 14px / 1.5, weight 400, antialiased. Weights in use: 400, 500, 600.
- **Clock** (600, 28px, 1, -0.5px, mono): the live countdown in the detail panel, the only large number.
- **Title** (600, 18px, 26px or 1.4, -0.2px): list page title and detail panel title.
- **Owed amount** (600, 18px, 1, mono): the estimated shortfall in NT dollars.
- **Body** (400, 14px, 1.5): inherited default; button label on large buttons.
- **UI** (500, 13.5px to 13px): nav items, group headers, section headings, form labels, button labels, props rows (13px).
- **Caption** (400, 12px to 12.5px): meta lines, hints, footnotes, tags, trail details. Footnote line height is 1.7.
- **Data** (500, 12.5px, 1, mono, tabular-nums): record IDs, due times, amounts, block heights, hashes. Inline `code` is 12px to 12.5px mono.
- **Micro** (11px to 11.5px): avatar initials and the compact live status on mobile.

Line length: lead paragraphs are capped at 62ch.

### Named Rules
**The Mono For Values Rule.** Any ID, amount, timestamp, hash or block number is Geist Mono with tabular numerals. Words never are.

**The Sentence-Case Label Rule.** Section and nav headings are 12px to 13px, weight 500, sentence case, in Ink 3 or Ink 4. There are no uppercase tracked eyebrows or kickers in this system.

## Layout

A full-height three-pane grid. The app is `236px` sidebar plus a flexible work area. The work area is the list (flexible, hairline right border) plus the detail or composer panel (`440px` fixed). Both panes scroll independently; group headers and the panel header stick.

Spacing is a 4px-based rhythm. Observed values: 4, 6, 8, 10, 12, 14, 16, 18, 20, 24. The list gutter is 24px; panel padding is 20px (16px on mobile). Rows are 44px tall, group headers 36px, the panel header 52px, controls 32px (36px for large primary, 40px on touch widths).

The row is a six-column grid: icon `16px`, ID `52px`, title flexible, amount `96px`, due `104px`, submitted-at `76px`, gap `12px`.

### Breakpoints
- **max-width 1240px:** panel narrows to `400px`; row drops the submitted-at column (icon 16, ID 48, title, amount 88, due 92).
- **max-width 960px:** single column. Sidebar hides; a sticky 52px mobile bar with brand, live status and a 規則 button appears; view filters become a horizontally scrolling chip row (40px tall pills); the panel becomes a full-screen overlay opened from a row, with a "return to list" button; buttons grow to 40px; the sticky group header offsets 52px.
- **max-width 600px:** the title row wraps and the primary button goes full width; each row becomes two lines (title and amount, then ID and due), 56px minimum; toast spans the width.

The `.work` container deliberately has no padding of its own: each child inset itself (24px list gutter, 20px panel padding), so the detector's cramped-padding finding on `.work` is sanctioned.

## Elevation & Depth

Flat and tonal. Depth is conveyed by the surface ladder (canvas, work surface, surface 1, 2, 3) and 1px hairlines, never by blur. Shadows appear in exactly two places.

### Shadow Vocabulary
- **Toast lift** (`box-shadow: 0 8px 24px rgba(0,0,0,0.45)`): the toast, the only floating element.
- **Focus glow** (`box-shadow: 0 0 0 3px rgba(94,106,210,0.16)`): text fields on focus, together with a lavender border.

### Named Rules
**The Hairline Not Shadow Rule.** Separate regions with a 1px hairline or a one-step surface change. A card never gets a shadow.

## Shapes

Soft but small. Radii: `4px` (focus outline, small marks), `6px` (nav items, segmented items), `8px` (buttons, fields, segmented control, owed box), `12px` (action box, option cards, note, toast), `999px` (tags, mobile chips, avatars are circles). Bars and tracks use `3px`. Borders are always 1px. Status icons are 16px circles in Linear's grammar and are the main recurring silhouette.

Icons are inline SVG at 16px (14px inside buttons, 9px inside the trail dot); strokes are 1.3 to 1.7px with round caps.

## Components

### Buttons
- **Shape:** 8px radius, 32px high, 12px horizontal padding, 13px weight 500, 1px border.
- **Default:** Surface 2 fill, Hairline Strong border; hover to Surface 3 with the stronger hairline; active moves down 1px.
- **Primary:** Lavender fill and border, white text; hover to Pressed Lavender. Large is 36px / 16px padding / 14px text. Only one primary is visible per pane.
- **Ghost:** transparent, Ink 3 text, Surface 2 on hover (close, toast dismiss, 規則).
- **Disabled:** 55% opacity, progress cursor.

### Inputs / Fields
- 32px, Surface 1 fill, Hairline Strong border, 8px radius, Ink 4 placeholder. Focus swaps the border to lavender and adds the 3px wash. Invalid (`aria-invalid`) turns the border Disputed Red.
- Error text (`.ferr`): 12.5px Disputed Red under the field, 6px above.

### Row
Tracker row: status icon, mono ID, title with a small Ink 3 suffix, amount (mono, right-aligned, NT shortfall or an Ink 4 dash), due (mono; Pending Yellow when open, plain when closed), submitted-at (Ink 4). Hover Surface 1; selected is the lavender wash (hover on selected is `rgba(94,106,210,0.22)`). Focus outline is inset. Loading is a three-line shimmer skeleton.

### Group Header
Sticky 36px strip on Surface 1: status icon, label (13px, weight 500, Ink 2), mono count in Ink 3. Groups are 等待雇主回應 and 已結案.

### Panel Header
Sticky 52px on the work surface with a hairline: status icon, status text, mono record ID, ghost close button pushed right. The composer and rules panels use the same header with their own icon and title.

### Props List
Two-column definition list, `92px` label column in Ink 3 and value in Ink 2, rows 10px apart, inside a section divided by a top hairline with an Ink 3 weight-500 heading and a mono Ink 4 count. Values can carry an avatar and a tag. Tags are 22px pills: neutral by default, red or green wash for ME ID level at registration.

### Attendance vs Payslip Bars
Two labelled horizontal bars on a Surface 1 track (14px tall, 3px radius). Attendance is Ink 2; payslip is Ink 4. The shortfall sits on the payslip track as a **red hatched segment** (`repeating-linear-gradient(-45deg)`, 2px red lines every 5px, with an inset 1px red outline). The hatch is data: its width is the unpaid hours. Mono values sit on the right. Below, an "owed" strip (Surface 1, 8px radius) shows the estimated shortfall as an 18px mono number. Inside option cards the bars shrink to 8px.

### Deadline Clock and Track
A 28px mono countdown in Pending Yellow with an Ink 3 caption. Below it a 6px track fills from left to right with the status colour (`--c`); closed records show a 2px marker at the moment of the response, in the answer's colour (green or red), or a full grey track when expired. End labels (registered, deadline) are mono Ink 4.

### Employer Action Box
Surface 1 box, 12px radius, 1px strong border, 14px padding, shown for open records. Contains an explanatory line, a confirm button with the confirmed icon, a reason field and a dispute button with the disputed icon, with an inline `ferr`. When the employer is not the demo account it shows an explanation only.

### On-chain Trail
A vertical list joined by a 1px hairline running through 15px circular dots. Each dot holds the action's status icon (or a plain Ink 2 dot for submit). Entry: weight 500 title, then 12.5px Ink 3 lines for signer, block height (mono), time, fee, and a link to the transaction. An open record ends with a hollow "waiting" dot.

### Composer Options
Two radio groups drawn as option cards (Surface 1, 12px radius, strong border). The checked card gets a lavender border and the lavender wash; the native input is visually hidden and focus is shown on the card. The report card carries a title, mono shortfall, subtitle and a compact bar pair. A segmented control (30 秒 / 60 秒 / 1 小時) sits between them.

**ME ID gate ladder.** The employer card shows three 22x6px steps filled to the identity's ME ID rank (green when it meets the contract's minimum, red on a `.below` card), a dashed vertical marker at the required level, and a caption "ME ID level, meets or will be refused by the contract". A card below the requirement is a deliberate path for demonstrating refusal.

### Toast
Fixed bottom-right (full width with 12px margin on mobile), Surface 2, 12px radius, the lift shadow, a 3-column grid: icon (confirmed or disputed icon, or a spinner while busy), message with a mono code link, ghost dismiss. Announced with `role="status"`.

### Note and Field Errors
`.note` is an inline result block (Surface 1, strong border, 12px radius, 13px at 1.6). The refusal variant `.note.no` takes a red border at 40% and a red wash; its bold lead uses `#ff8f8f` to stay readable on the wash. A busy variant holds a spinner and a mono seconds counter. Contract error codes are shown in mono beneath a plain Chinese explanation. Field errors use `.ferr` as above.

### Navigation (sidebar)
30px nav buttons, 6px radius, 13.5px Ink 2; hover Surface 1, current Surface 2 with Ink; each leads with a status icon (or a lines icon for 全部) and ends with a mono count. A "who" list shows the two demo identities with a 20px initial avatar and their ME ID level in Ink 3 (red when unverified). The footer carries the live chain status in mono and the synthetic-data disclaimer.

## Do's and Don'ts

### Do:
- **Do** express every status as its own icon shape plus text label; keep the pie filling in real time from chain time.
- **Do** use lavender only for the primary action, the selected row or option wash, and focus.
- **Do** set IDs, amounts, hashes, times, block numbers and the countdown in Geist Mono with tabular numerals.
- **Do** separate regions with 1px hairlines and one-step surface changes; keep the toast as the only shadowed element.
- **Do** draw values as data (bars, hatched shortfall, tracks, the gate ladder) rather than decorating with them.
- **Do** keep the 44px row, 36px group header and 52px panel header cadence, and the 440px panel.
- **Do** label demo data as fictional wherever it is shown.

### Don't:
- **Don't** add a hero, story section, stats band or card grid; the tracker is the entire surface.
- **Don't** signal status or errors by colour alone.
- **Don't** use status colours or lavender as decoration, or lavender for links and text.
- **Don't** add uppercase tracked eyebrows or kickers above headings.
- **Don't** use the hatched pattern for anything except an unpaid shortfall.
- **Don't** put a shadow on a card, row or panel.

### Sanctioned detector exceptions
- **Overused-font (Geist):** pinned by the token reference. Geist and Geist Mono are the declared substitutes for Linear's faces.
- **Repeating stripes:** the hatched segment in the attendance vs payslip bars is the shortfall itself, i.e. data.
- **`.work` cramped padding:** the container has none by design; its rows, header and panel each inset themselves.

### Drift and defects not canonized
- `#62666d` appears only inline in `app.js` (the "unverified" avatar and the 已結案 group icon) and is not a token.
- Status and avatar hex values are duplicated in JS instead of reading the CSS custom properties.
- `#ff8f8f` (note.no bold lead) and white on primary are one-off literals.
- The surface brief states a 240px sidebar and 420px panel; the shipped build is 236px and 440px, and the build is what is recorded here.
