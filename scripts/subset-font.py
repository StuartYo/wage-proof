# Subset Noto Sans TC (variable, SIL OFL 1.1) to only the characters the demo page uses.
# Run after changing any Chinese text in web/index.html or web/app.js:
#   python scripts/subset-font.py [path-to-NotoSansTC-VF.ttf]
# Output: web/fonts/NotoSansTC-subset.woff2 (all weights kept; user-typed text outside the subset
# falls back to the system Chinese font).
import sys, pathlib
from fontTools import subset

ROOT = pathlib.Path(__file__).resolve().parent.parent
src = sys.argv[1] if len(sys.argv) > 1 else r"C:\Windows\Fonts\NotoSansTC-VF.ttf"
text = "".join((ROOT / p).read_text(encoding="utf-8") for p in ["web/index.html", "web/app.js", "demo/synthetic-report.json", "demo/synthetic-report-2.json"])
chars = {c for c in text if ord(c) > 0x7F} | {chr(c) for c in range(0x20, 0x7F)}
chars |= set("０１２３４５６７８９：；，。、！？（）「」『』…～・－＋％／")
opts = subset.Options()
opts.flavor = "woff2"
opts.layout_features = ["*"]
opts.name_IDs = ["*"]
opts.notdef_outline = True
font = subset.load_font(src, opts)
s = subset.Subsetter(opts)
s.populate(text="".join(sorted(chars)))
s.subset(font)
out = ROOT / "web/fonts/NotoSansTC-subset.woff2"
subset.save_font(font, str(out), opts)
print(f"{out.name}: {len(chars)} chars, {out.stat().st_size // 1024} KB")
