"""Regenerate every app icon / splash from the emblem in frontend/public/Logo3.png
(the old "Resume2Job" wordmark is cropped off). Run from the repo root:
    python3 scripts/make_icons.py
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "frontend/public/Logo3.png")
NAVY = (14, 22, 54)

def emblem():
    im = Image.open(SRC).convert("RGB").crop((92, 13, 598, 498))  # emblem only, no text
    w, h = im.size
    side = max(w, h)
    sq = Image.new("RGB", (side, side), NAVY)
    # soft mask: keep the bright strokes, flatten the dark gradient behind them
    lum = im.convert("L").point(lambda v: max(0, min(255, (v - 45) * 6)))
    sq.paste(im, ((side - w) // 2, (side - h) // 2), lum)
    rgba = im.convert("RGBA"); rgba.putalpha(lum)
    tr = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    tr.paste(rgba, ((side - w) // 2, (side - h) // 2))
    return sq, tr

SQ, TR = emblem()

def on_bg(size, scale, bg=NAVY, transparent=False, radius=0):
    canvas = Image.new("RGBA", size, (0, 0, 0, 0) if transparent else bg + (255,))
    s = int(min(size) * scale)
    canvas.alpha_composite(TR.resize((s, s), Image.LANCZOS), ((size[0] - s) // 2, (size[1] - s) // 2))
    if radius:
        m = Image.new("L", size, 0)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius, fill=255)
        canvas.putalpha(m)
    return canvas

def circle(img):
    m = Image.new("L", img.size, 0)
    ImageDraw.Draw(m).ellipse([0, 0, img.size[0] - 1, img.size[1] - 1], fill=255)
    img = img.copy(); img.putalpha(m); return img

def save(img, rel, rgb=False):
    p = os.path.join(ROOT, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
    (img.convert("RGB") if rgb else img).save(p)

# Web
save(TR, "frontend/public/emblem.png")
save(on_bg((512, 512), 0.78, radius=96), "frontend/public/icon-512.png")
save(on_bg((180, 180), 0.78), "frontend/public/apple-touch-icon.png", rgb=True)

# Android launcher + adaptive foreground (safe zone = 66% of 108dp)
res = "frontend/android/app/src/main/res"
for d, px in {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}.items():
    full = on_bg((px, px), 0.8)
    save(full, f"{res}/mipmap-{d}/ic_launcher.png")
    save(circle(on_bg((px, px), 0.68)), f"{res}/mipmap-{d}/ic_launcher_round.png")
    fg = int(px * 108 / 48)
    save(on_bg((fg, fg), 0.56, transparent=True), f"{res}/mipmap-{d}/ic_launcher_foreground.png")

# Android splash (plain: emblem on navy)
for f in os.listdir(os.path.join(ROOT, res)):
    p = os.path.join(ROOT, res, f, "splash.png")
    if os.path.exists(p):
        sz = Image.open(p).size
        save(on_bg(sz, 0.35), f"{res}/{f}/splash.png", rgb=True)

# iOS
ios = "frontend/ios/App/App/Assets.xcassets"
if os.path.isdir(os.path.join(ROOT, ios)):
    save(on_bg((1024, 1024), 0.8), f"{ios}/AppIcon.appiconset/AppIcon-512@2x.png", rgb=True)  # no alpha allowed
    for n in ("", "-1", "-2"):
        save(on_bg((2732, 2732), 0.22), f"{ios}/Splash.imageset/splash-2732x2732{n}.png", rgb=True)

# Desktop (Electron)
ico = on_bg((256, 256), 0.8, radius=48)
save(ico, "desktop/build/icon.png")
ico.save(os.path.join(ROOT, "desktop/build/icon.ico"), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
save(TR.resize((320, 320), Image.LANCZOS), "desktop/emblem.png")
print("icons written")
