---
version: 1
slug: "web-index-html"
primary_target: "web/index.html"
related_targets: []
---

# Surface: online demo (web/index.html)

Scope: the single-screen demo app at https://wage-proof.vercel.app/. Mode: Operate.
Audience: hackathon judges (3–5 min). Task: register a wage-gap report, then answer as the employer, and see the contract's ME ID gate refuse an unverified employer.
Constraints: Traditional Chinese UI; tokens from the owner's chosen reference (Linear app, via design-md-library) per the owner's interface standard v2.

## Direction contract
THESIS: Wage records as an issue tracker. Each record is a row that someone owes an answer on, with a deadline; it refuses the landing-page arrangement (hero, story, stats band) and the card grid.
OWN-WORLD: Linear app tokens: near-black canvas, four-step charcoal surface ladder, 1px hairlines, lavender #5e6ad2 only on the primary action, selection and focus. Status speaks through drawn circle icons in Linear's grammar: pending is a yellow pie that fills as the deadline runs out, confirmed a green check, disputed a red cross-bar, expired a grey clock. Geist for text, Geist Mono for IDs, hashes and block heights.
STORY: The judge sees a list of real on-chain records, opens one, sees attendance vs payslip side by side and the full on-chain trail (who signed, block, fee, tx). They press 登記報告, register in one panel, watch the pie fill, answer as employer, then try the unverified employer and read the contract's refusal.
FIRST VIEWPORT: left sidebar 240px (views with live counts, the two demo identities with ME ID level, contract link). Centre: title row with one-line purpose and the lavender 登記報告 button; record list grouped 等待回應 / 已結案. Right 420px panel: the selected record's detail or the composer.
FORM: Linear-style three-pane issue tracker, position 1 of 1; seed: none (pinned) "選一個真產品當 token 起點（design-md-library：Linear／Stripe／Vercel／Notion…）".
Signature interaction: the pending pie icon and the detail countdown fill in real time from chain time; when the block lands, the row's icon turns into the employer's answer.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
