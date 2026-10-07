# Draws the app icon: a blue tile with a white die showing five pips.
import sys
from PIL import Image, ImageDraw
def icon(size, pad_ratio, path):
    S = size * 4
    img = Image.new('RGB', (S, S), '#1f4fd1')
    d = ImageDraw.Draw(img)
    pad = int(S * pad_ratio)
    r = int((S - 2 * pad) * 0.2)
    d.rounded_rectangle([pad, pad, S - pad, S - pad], radius=r, fill='#ffffff')
    inner = S - 2 * pad
    pr = inner * 0.085
    for fx, fy in [(.27,.27),(.73,.27),(.5,.5),(.27,.73),(.73,.73)]:
        cx, cy = pad + inner * fx, pad + inner * fy
        d.ellipse([cx - pr, cy - pr, cx + pr, cy + pr], fill='#c2283b')
    img.resize((size, size), Image.LANCZOS).save(path)
out = sys.argv[1]
icon(192, .2, f'{out}/icon-192.png')
icon(512, .2, f'{out}/icon-512.png')
icon(512, .28, f'{out}/icon-maskable-512.png')
icon(180, .18, f'{out}/apple-touch-icon.png')
