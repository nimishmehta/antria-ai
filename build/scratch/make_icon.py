#!/usr/bin/env python3
"""Antria desktop app icon generator.
Mark = canonical Antria brand: ink-bordered square framing a centered olive square,
on a warm paper field. Colors from ANTRIA-DESIGN-SYSTEM.md.
"""
import os
from PIL import Image, ImageDraw

BUILD = "/Users/nimishmehta/Learning/Founders Office/desktop/build"
ISET = os.path.join(BUILD, "icon.iconset")

PAPER = (250, 248, 245, 255)   # #FAF8F5 warm paper field
INK   = (28, 26, 24, 255)      # #1C1A18 ink
OLIVE = (110, 122, 78, 255)    # #6E7A4E accent

SS = 4  # supersample

def draw_icon(size):
    S = size * SS
    img = Image.new("RGBA", (S, S), PAPER)
    d = ImageDraw.Draw(img)
    # geometry in 0..1 of canvas
    margin   = 0.146   # outer square inset
    stroke_f = 0.094   # frame stroke width (bold so it reads small)
    olive_f  = 0.322   # olive inner square side

    o0 = margin * S
    o1 = (1 - margin) * S
    sw = stroke_f * S
    # ink frame (stroked square) -> draw as filled outer minus inner
    d.rectangle([o0, o0, o1, o1], fill=INK)
    d.rectangle([o0 + sw, o0 + sw, o1 - sw, o1 - sw], fill=PAPER)
    # centered olive square
    olv = olive_f * S
    c = S / 2
    d.rectangle([c - olv/2, c - olv/2, c + olv/2, c + olv/2], fill=OLIVE)

    return img.resize((size, size), Image.LANCZOS)

# master 1024
master = draw_icon(1024)
master.save(os.path.join(BUILD, "icon-1024.png"))
master.save(os.path.join(BUILD, "icon.png"))

# iconset sizes
sizes = {
    "icon_16x16.png": 16, "icon_16x16@2x.png": 32,
    "icon_32x32.png": 32, "icon_32x32@2x.png": 64,
    "icon_128x128.png": 128, "icon_128x128@2x.png": 256,
    "icon_256x256.png": 256, "icon_256x256@2x.png": 512,
    "icon_512x512.png": 512, "icon_512x512@2x.png": 1024,
}
os.makedirs(ISET, exist_ok=True)
for name, sz in sizes.items():
    draw_icon(sz).save(os.path.join(ISET, name))

# proof sheet at 512/128/32/16 on neutral bg
proof_sizes = [512, 128, 32, 16]
pad = 40
gap = 40
W = pad*2 + sum(proof_sizes) + gap*(len(proof_sizes)-1)
H = pad*2 + 512
proof = Image.new("RGBA", (W, H), (230, 231, 228, 255))
x = pad
for sz in proof_sizes:
    ic = draw_icon(sz)
    y = pad + (512 - sz)  # baseline align bottom
    proof.alpha_composite(ic, (x, y))
    x += sz + gap
proof.save(os.path.join(BUILD, "icon-proof.png"))
print("done")
