"""Render the default token avatar PNG used when a creator provides no image."""
import math
from PIL import Image, ImageDraw, ImageFilter, ImageChops

S = 4
SZ = 256
W = SZ * S

CYAN_HI = (108, 236, 220)
CYAN_LO = (24, 191, 178)
BG_TOP = (20, 28, 39)
BG_BOT = (10, 14, 20)


def vgrad(w, top, bot):
    g = Image.new("RGB", (1, w))
    for y in range(w):
        t = y / (w - 1)
        g.putpixel((0, y), tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)))
    return g.resize((w, w))


def diag_grad(w, c1, c2):
    g = Image.new("RGB", (64, 64))
    px = g.load()
    for y in range(64):
        for x in range(64):
            t = (x + y) / 126
            px[x, y] = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))
    return g.resize((w, w)).convert("RGBA")


def clip(mask, fill):
    layer = fill.copy()
    layer.putalpha(mask)
    return layer


def star_points(cx, cy, outer, inner, n=4, rot=0):
    pts = []
    for k in range(n * 2):
        a = rot + math.pi * k / n
        r = outer if k % 2 == 0 else inner
        pts.append((cx + r * math.sin(a), cy - r * math.cos(a)))
    return pts


img = vgrad(W, BG_TOP, BG_BOT).convert("RGBA")
cx = cy = W // 2

# soft center glow
glow = Image.new("RGBA", (W, W), (0, 0, 0, 0))
ImageDraw.Draw(glow).ellipse([cx - W * 0.34, cy - W * 0.34, cx + W * 0.34, cy + W * 0.34], fill=(63, 224, 207, 70))
img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(W * 0.06)))

# coin disc with diagonal gradient
rad = int(W * 0.27)
cm = Image.new("L", (W, W), 0)
ImageDraw.Draw(cm).ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=255)
coin = clip(cm, diag_grad(W, CYAN_HI, CYAN_LO))
img.alpha_composite(coin)

# glossy top-left highlight on the coin
hl = Image.new("RGBA", (W, W), (0, 0, 0, 0))
ImageDraw.Draw(hl).ellipse([cx - rad * 0.8, cy - rad * 0.9, cx + rad * 0.1, cy - rad * 0.1], fill=(255, 255, 255, 90))
hl = hl.filter(ImageFilter.GaussianBlur(W * 0.03))
hl.putalpha(ImageChops.multiply(hl.getchannel("A"), cm))
img.alpha_composite(hl)

# negative-space spark cut into the coin (dark)
sm = Image.new("L", (W, W), 0)
ImageDraw.Draw(sm).polygon(star_points(cx, cy, rad * 0.62, rad * 0.17, 4, 0), fill=255)
ImageDraw.Draw(sm).polygon(star_points(cx, cy, rad * 0.34, rad * 0.12, 4, math.pi / 4), fill=255)
spark = Image.new("RGBA", (W, W), (0, 0, 0, 0))
spark.putalpha(sm)
spark_rgb = Image.new("RGBA", (W, W), (10, 22, 26, 255))
spark_rgb.putalpha(sm)
img.alpha_composite(spark_rgb)

img.resize((SZ, SZ), Image.LANCZOS).save("public/token-default.png")
print("saved public/token-default.png")
