---
version: 3
name: wage-proof v3 (Wise start + our trade-offs)
description: Two phones side by side on a deep-green stage. Each phone is one short screen with one lime button. Under the phones, a live strip shows what happened on ME Network. Start point is Wise (money transfer); kept its lime CTA, sage surfaces, heavy amount type and 24 px radius, dropped its marketing hero.
source: awesome-design-md, wise/DESIGN.md (design-md-library)
spec: 新設計規格.md + 研究.md (contest working folder, not in this repo)

colors:
  stage: "#0e1f05"          # deeper than Wise ink-deep, so the white phones are the brightest thing
  stage-line: "#2a4417"     # hairlines and table rules on the stage
  stage-ink: "#e8ebe6"      # text on the stage (Wise canvas-soft)
  stage-mute: "#a9b5a0"     # secondary text on the stage (AA on #0e1f05)
  ink-deep: "#163300"       # Wise ink-deep: text on the lime button
  canvas: "#ffffff"         # phone surface
  canvas-soft: "#e8ebe6"    # blocks inside a phone
  ink: "#0e0f0c"
  body: "#454745"
  mute: "#6b6d6a"           # Wise mute #868685 darkened to pass 4.5:1 on white
  primary: "#9fe870"        # the ONE action colour; one lime button on the whole stage at a time
  primary-active: "#cdffad"
  primary-pale: "#e2f6d5"
  accent: "#ffc091"         # Wise accent-orange; marks "the boss side" (label chip, arrival outline)
  waiting: "#ffd11a"        # waiting for the boss; text on it uses waiting-ink
  waiting-ink: "#4a3b1c"
  paid: "#2ead4b"           # paid back
  paid-deep: "#054d28"
  disputed: "#d03238"
  disputed-deep: "#a72027"
  expired: "#868685"
  # tints derived from the tokens above (kept small and named so nothing drifts)
  stage-2: "#172d0c"        # mobile role switch track, hover on the stage
  stage-fresh: "#2f4d1a"    # a just-added evidence row, fades out in 1.2 s
  disputed-on-stage: "#ffb3b5"  # "contract refused" words on the dark stage
  disputed-pale: "#fdecec"  # blocked-by-contract card
  disputed-ink: "#4d0d10"   # body text on that card
  waiting-pale: "#fff6cc"   # the one-line "reply within 0:52" pill
  line-soft: "#b9bdb6"      # link underline, empty-state icon
  ring: "#c9cdc6"           # empty step circle in the tracker
  soft-hover: "#dde1da"     # hover on the sage secondary button
  focus: "#38c8ff"          # Wise accent-cyan, used ONLY as the keyboard focus ring

typography:
  family-text: "Noto Sans TC (subset, variable 100-900), Microsoft JhengHei, PingFang TC, sans-serif"
  family-num: "Geist Mono (tabular-nums) for block heights, hashes, MEC amounts, clocks"
  amount: { size: 56px, weight: 900, lineHeight: 1 }      # NT$523, the hero of each phone
  title: { size: 20px, weight: 800, lineHeight: 1.3 }
  body: { size: 16px, weight: 400, lineHeight: 1.5 }
  body-strong: { size: 16px, weight: 600 }
  small: { size: 14px, weight: 400, lineHeight: 1.45 }
  caption: { size: 12.5px, weight: 600 }                  # labels, table heads
  button: { size: 17px, weight: 800 }

rounded: { phone: 24px, button: 9999px, small: 12px }
spacing: { base: 4px, phone-pad: 20px, block-gap: 16px }
touch: 44px minimum on every control; the main button is 52px tall
---

# wage-proof DESIGN v3

## What changed from v2 and why
v2 was a Linear-style three-column ticket list. In a user test the person pressed "register report" and could not find "confirm and pay" for 10 seconds: it lived in a side panel behind a toast. Workers and bosses will not read a dashboard. v3 throws away every v2 layout, component and sentence (v2 files are kept in `web/_old_v2/` for reference only).

## The mental model
A wage claim is a **payment request**, the thing everyone knows from Venmo "request" and the Stripe invoice page.
- Worker phone: one amount, one reason, one button "請老闆補發 NT$523".
- Boss phone: the Stripe invoice page. Amount biggest, one reason, three lines of detail, one lime button "補發 NT$523", and "我有異議" as a text link under it.
- After sending, the worker sees a parcel-tracker: sent, waiting for the boss, result.
- Chain details sit in a "鏈上收據" fold on the phone, and in the evidence strip under the phones for judges.

## Layout
- Desktop (1024 and up): deep-green stage. Top bar: product name, the guide (① ② ③, later ④) and one sentence that says which side to press. Below it two white phones (390 wide) side by side, labelled "勞工的手機" and "老闆的手機". Below the phones, the evidence strip ("鏈上發生了什麼"), always open, newest row on top. At 1440 x 900 both phones' buttons and the first rows of the strip are visible without scrolling.
- Mobile (below 1024): one phone at a time. A sticky segmented switch "勞工 | 老闆" with a colour bar under it (pale green for the worker, orange for the boss) and the words "現在：勞工". After the worker sends, a fixed bottom button "換成老闆看看" appears.

## The one-button rule
Only one lime button exists on the whole stage at any moment, and the guide sentence says where it is (learned from DocuSign START / NEXT). Everything else is a text link, a sage secondary button, or an ink outline button. Results use a sage secondary "再送一張".

## Status grammar
Status is always icon + words, never colour alone.
| state | icon | colour | words |
|---|---|---|---|
| waiting | clock | waiting yellow, ink text | 等老闆回覆 |
| paid | check in circle | paid green | 已補發 |
| disputed | flag | disputed red | 老闆有異議 |
| expired | clock with slash look (grey clock) | expired grey | 逾期 |
| blocked by contract | shield with x | disputed red | 被合約擋下 |

## Type
- Noto Sans TC is subset at build time to only the characters the page uses (`scripts/subset-font.py`), so the page loads a ~100 KB file instead of 11 MB. Anything typed by the user that is not in the subset falls back to the system Chinese font.
- Amounts use weight 900 at 56 px; titles 800; everything else 400 or 600. Numbers that people compare (block heights, MEC, clocks) use Geist Mono with tabular figures.

## Our trade-offs against Wise
- Wise's marketing hero type (64-126 px) is not used; this is an app, so the largest thing is the money amount at 56 px.
- Wise mute grey is darkened to #6b6d6a for contrast on white.
- The stage is darker than Wise ink-deep so the phones read as the only bright surfaces.
- One accent (Wise orange) marks the boss side only. Wise cyan appears only as the keyboard focus ring.
- No gradients, glows, glass, emoji, per-element fade-ins, cards inside cards, or blocks of small text.

## Motion
- Boss phone gets a 600 ms orange outline when a claim arrives. A new evidence row gets a 1.2 s background highlight. Both are skipped under `prefers-reduced-motion`.
- Buttons react on press (scale 0.98, 100 ms). Nothing else animates.

## Words
- Words for workers and bosses: a 15-year-old can read them, one idea per sentence. Main nouns are 補薪單, 老闆, 補發. "ME ID", "MEC", "區塊" appear only in badges, receipts and small print.
- Traditional Chinese only; ME ID, MEC, ME Network stay as brand names. No maker names on screen.
