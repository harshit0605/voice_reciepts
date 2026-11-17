"""
Builds the app's text faces from Anek Devanagari (Ek Type, SIL Open Font License 1.1).

Anek ships a 0.69 em descent, far below its deepest glyph (-0.54 em), and a 1.01 em ascent. With
the app's line heights that left Latin text riding high in buttons and pills on iOS, and iOS
clipped the marks above the Devanagari headline ("हिंदी" drew as "हिदा"). This rewrites only the
vertical metrics to the glyphs' real extents and renames the family, as the OFL asks of modified
fonts. Run: uvx --from fonttools python -I assets/fonts/patch-anek.py
"""
import os
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "../../../../node_modules/@expo-google-fonts/anek-devanagari")
FAMILY = "Counterwell Anek"
for weight, style in [("400Regular", "Regular"), ("500Medium", "Medium"), ("600SemiBold", "SemiBold"), ("700Bold", "Bold")]:
    f = TTFont(os.path.join(SRC, weight, f"AnekDevanagari_{weight}.ttf"))
    upm = f["head"].unitsPerEm  # 2000
    ascent, descent = round(0.98 * upm), round(0.44 * upm)
    f["hhea"].ascent, f["hhea"].descent, f["hhea"].lineGap = ascent, -descent, 0
    os2 = f["OS/2"]
    os2.sTypoAscender, os2.sTypoDescender, os2.sTypoLineGap = ascent, -descent, 0
    # Windows/Android clip glyphs outside the win box: keep it wide enough for the deepest conjunct.
    os2.usWinAscent, os2.usWinDescent = ascent, round(0.56 * upm)
    for rec in f["name"].names:
        text = rec.toUnicode()
        if rec.nameID in (1, 16):
            rec.string = FAMILY
        elif rec.nameID == 4:
            rec.string = f"{FAMILY} {style}"
        elif rec.nameID == 6:
            rec.string = f"CounterwellAnek-{style}"
        elif rec.nameID == 3:
            rec.string = f"CounterwellAnek-{style};patched-metrics"
    f.save(os.path.join(HERE, f"CounterwellAnek-{style}.ttf"))
    print("wrote", f"CounterwellAnek-{style}.ttf")
