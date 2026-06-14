"""Generate Hyprpad social assets: X banner (1500x500) + profile picture (1000x1000)."""
from PIL import Image, ImageDraw, ImageFilter, ImageChops, ImageFont

SS = 2  # supersample
CYAN_HI = (108, 236, 220)
CYAN_LO = (24, 191, 178)
BG_TOP = (15, 23, 32)
BG_BOT = (7, 11, 16)
FONT_BOLD = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
FONT_REG = "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"


def vgrad(w, h, top, bot):
    g = Image.new("RGB", (1, h))
    for y in range(h):
        t = y / (h - 1)
        g.putpixel((0, y), tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)))
    return g.resize((w, h)).convert("RGBA")


def diag_grad(d, c1, c2):
    g = Image.new("RGB", (64, 64))
    px = g.load()
    for y in range(64):
        for x in range(64):
            t = (x + y) / 126
            px[x, y] = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))
    return g.resize((d, d)).convert("RGBA")


def disc(d, c_hi, c_lo):
    cm = Image.new("L", (d, d), 0)
    ImageDraw.Draw(cm).ellipse([0, 0, d - 1, d - 1], fill=255)
    g = diag_grad(d, c_hi, c_lo)
    g.putalpha(cm)
    hl = Image.new("RGBA", (d, d), (0, 0, 0, 0))
    ImageDraw.Draw(hl).ellipse([d * 0.12, d * 0.08, d * 0.6, d * 0.5], fill=(255, 255, 255, 120))
    hl = hl.filter(ImageFilter.GaussianBlur(d * 0.08))
    hl.putalpha(ImageChops.multiply(hl.getchannel("A"), cm))
    g.alpha_composite(hl)
    return g


def glow(img, cx, cy, rad, color=(63, 224, 207), alpha=90):
    g = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(g).ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=color + (alpha,))
    img.alpha_composite(g.filter(ImageFilter.GaussianBlur(rad * 0.35)))


def draw_orbit(img, cx, cy, rad):
    glow(img, cx, cy, rad * 2.0)
    # tilted orbit ring
    ring = Image.new("RGBA", img.size, (0, 0, 0, 0))
    rw = max(2, int(rad * 0.13))
    ImageDraw.Draw(ring).ellipse([cx - rad * 2.05, cy - rad * 1.02, cx + rad * 2.05, cy + rad * 1.02], outline=(155, 246, 233, 240), width=rw)
    img.alpha_composite(ring.rotate(-24, resample=Image.BICUBIC, center=(cx, cy)))
    # core disc
    d = int(rad * 2)
    img.alpha_composite(disc(d, CYAN_HI, CYAN_LO), (int(cx - rad), int(cy - rad)))
    # satellite (front)
    sd = int(rad * 0.36)
    sx, sy = cx + rad * 1.55, cy - rad * 0.92
    img.alpha_composite(disc(sd, (220, 255, 251), CYAN_HI), (int(sx - sd / 2), int(sy - sd / 2)))


# faint dotted grid for depth
def grid(img, step, alpha=14):
    g = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(g)
    for x in range(0, img.width, step):
        d.line([(x, 0), (x, img.height)], fill=(63, 224, 207, alpha), width=1)
    for y in range(0, img.height, step):
        d.line([(0, y), (img.width, y)], fill=(63, 224, 207, alpha), width=1)
    img.alpha_composite(g)


# ---------------------------------------------------------------- profile picture
def make_pfp(out, size=1000):
    W = size * SS
    img = vgrad(W, W, BG_TOP, BG_BOT)
    glow(img, W * 0.5, W * 0.42, W * 0.34, alpha=70)
    draw_orbit(img, W * 0.5, W * 0.5, W * 0.165)
    img.resize((size, size), Image.LANCZOS).save(out)


# ---------------------------------------------------------------- X banner
def make_banner(out, w=1500, h=500):
    W, H = w * SS, h * SS
    img = vgrad(W, H, BG_TOP, BG_BOT)
    grid(img, int(H * 0.13))
    glow(img, W * 0.22, H * 0.5, H * 0.6, alpha=70)
    glow(img, W * 0.85, H * 0.2, H * 0.7, color=(46, 214, 148), alpha=45)

    cx, cy, rad = W * 0.18, H * 0.5, H * 0.23
    draw_orbit(img, cx, cy, rad)

    d = ImageDraw.Draw(img)
    name_font = ImageFont.truetype(FONT_BOLD, int(H * 0.27))
    tag_font = ImageFont.truetype(FONT_REG, int(H * 0.085))
    tx = W * 0.34
    d.text((tx, H * 0.32), "Hyprpad", font=name_font, fill=(245, 246, 248))
    # accent underline dot
    nb = d.textbbox((tx, H * 0.32), "Hyprpad", font=name_font)
    d.ellipse([nb[2] + H * 0.03, nb[3] - H * 0.12, nb[2] + H * 0.03 + H * 0.06, nb[3] - H * 0.06], fill=CYAN_HI)
    d.text((tx + 3, H * 0.62), "Launch coins. Keep 70% of every trade.", font=tag_font, fill=(150, 168, 178))
    d.text((tx + 3, H * 0.74), "A token launchpad on HyperEVM", font=tag_font, fill=(100, 114, 124))

    img.resize((w, h), Image.LANCZOS).save(out)


make_pfp("/tmp/hyprpad-pfp.png")
make_banner("/tmp/hyprpad-banner.png")
print("saved /tmp/hyprpad-pfp.png + /tmp/hyprpad-banner.png")


# ---------------------------------------------------------------- mesh banner (v2)
import math


def _wave(u, v):
    return math.sin(u * 8 + v * 5) * 0.5 + math.sin(u * 5 - v * 7 + 1.3) * 0.34 + math.sin(u * 13 + v * 3) * 0.16


def make_banner_mesh(out, w=1500, h=500):
    W, H = w * SS, h * SS
    img = vgrad(W, H, (12, 24, 21), (6, 12, 11))
    glow(img, W * 0.8, H * 0.1, H * 0.9, color=(46, 214, 148), alpha=30)

    cols, rows = 64, 36
    horizon = H * 0.02
    mesh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    md = ImageDraw.Draw(mesh)
    P = [[None] * (cols + 1) for _ in range(rows + 1)]
    for i in range(rows + 1):
        tv = i / rows  # 0 far(top) .. 1 near(bottom)
        ybase = horizon + (H * 1.06 - horizon) * (tv ** 1.55)
        amp = H * 0.11 * (0.25 + tv)
        for j in range(cols + 1):
            tu = j / cols
            persp = 0.5 + 0.8 * tv
            x = W / 2 + (tu - 0.5) * W * persp * 1.2
            y = ybase - _wave(tu, tv) * amp
            P[i][j] = (x, y, tv, x)

    def lw(x):  # fade mesh out on the left so the text stays clean
        f = (x / W - 0.30) / 0.26
        return max(0.0, min(1.0, f))

    for i in range(rows + 1):
        for j in range(cols + 1):
            x, y, tv, _ = P[i][j]
            base = 30 + 150 * (tv ** 1.3)
            if j < cols:
                x2, y2, _, _ = P[i][j + 1]
                a = int(base * lw((x + x2) / 2))
                if a > 4:
                    md.line([(x, y), (x2, y2)], fill=(150, 246, 233, a), width=SS)
            if i < rows:
                x2, y2, _, _ = P[i + 1][j]
                a = int(base * lw((x + x2) / 2))
                if a > 4:
                    md.line([(x, y), (x2, y2)], fill=(150, 246, 233, a), width=SS)
    img.alpha_composite(mesh)

    # subtle dark vignette behind the headline for legibility
    vig = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(vig).ellipse([W * 0.1, H * 0.2, W * 0.85, H * 0.85], fill=(7, 13, 12, 150))
    img.alpha_composite(vig.filter(ImageFilter.GaussianBlur(H * 0.12)))

    d = ImageDraw.Draw(img)
    fs = int(H * 0.155)
    reg = ImageFont.truetype(FONT_REG, fs)
    ital = ImageFont.truetype("/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf", fs)
    bold = ImageFont.truetype(FONT_BOLD, fs)
    s1, sep, s2 = "Launch coins", "  /  ", "keep the fees"
    w1 = d.textlength(s1, font=reg)
    ws = d.textlength(sep, font=bold)
    w2 = d.textlength(s2, font=ital)
    total = w1 + ws + w2
    x = (W - total) / 2
    y = H * 0.42
    d.text((x, y), s1, font=reg, fill=(238, 242, 244))
    d.text((x + w1, y), sep, font=bold, fill=(63, 224, 207))
    d.text((x + w1 + ws, y), s2, font=ital, fill=(225, 232, 236))

    img.resize((w, h), Image.LANCZOS).save(out)


make_banner_mesh("/tmp/hyprpad-banner2.png")
print("saved /tmp/hyprpad-banner2.png")


# ---------------------------------------------------------------- orbital banner (v3)
import random


def make_banner_v3(out, w=1500, h=500):
    W, H = w * SS, h * SS
    img = vgrad(W, H, (9, 15, 19), (5, 9, 12))
    cx, cy = W * 0.75, H * 0.5
    glow(img, cx, cy, H * 0.78, alpha=48)
    glow(img, cx, cy, H * 0.34, alpha=80)
    rad = H * 0.17

    # concentric tilted rings + satellites, rotated together
    rings = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    rd = ImageDraw.Draw(rings)
    for mult, a, wd in [(1.75, 160, SS * 2), (2.6, 95, SS * 2), (3.5, 55, SS)]:
        rx, ry = rad * mult, rad * mult * 0.40
        rd.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], outline=(150, 246, 233, a), width=wd)
    for mult, sd in [(1.75, rad * 0.20), (2.6, rad * 0.15)]:
        rx = rad * mult
        s = disc(int(sd * 2), (220, 255, 251), CYAN_HI)
        rings.alpha_composite(s, (int(cx + rx - sd), int(cy - sd)))
    rings = rings.rotate(-18, resample=Image.BICUBIC, center=(cx, cy))
    img.alpha_composite(rings)

    # glowing core planet
    img.alpha_composite(disc(int(rad * 2), CYAN_HI, CYAN_LO), (int(cx - rad), int(cy - rad)))

    # drifting particles
    random.seed(7)
    parts = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    pd = ImageDraw.Draw(parts)
    for _ in range(46):
        px, py = random.uniform(W * 0.42, W * 0.99), random.uniform(H * 0.06, H * 0.94)
        r, a = random.uniform(SS * 0.7, SS * 2.4), random.randint(28, 130)
        pd.ellipse([px - r, py - r, px + r, py + r], fill=(150, 246, 233, a))
    img.alpha_composite(parts)

    d = ImageDraw.Draw(img)
    name = ImageFont.truetype(FONT_BOLD, int(H * 0.205))
    tag = ImageFont.truetype(FONT_REG, int(H * 0.072))
    chipf = ImageFont.truetype(FONT_BOLD, int(H * 0.052))
    lx = W * 0.07
    d.text((lx, H * 0.32), "Hyprpad", font=name, fill=(245, 246, 248))
    d.text((lx + 4, H * 0.58), "Launch a token. Earn from every trade.", font=tag, fill=(152, 170, 180))

    # accent pill
    ct = "70% OF FEES TO CREATORS"
    cw = d.textlength(ct, font=chipf)
    px0, py0 = lx + 4, H * 0.72
    pad = H * 0.035
    d.rounded_rectangle([px0, py0, px0 + cw + pad * 2, py0 + H * 0.115], radius=H * 0.06, fill=(63, 224, 207, 28), outline=(63, 224, 207, 120), width=SS)
    d.text((px0 + pad, py0 + H * 0.028), ct, font=chipf, fill=(108, 236, 220))

    img.resize((w, h), Image.LANCZOS).save(out)


make_banner_v3("/tmp/hyprpad-banner3.png")
print("saved /tmp/hyprpad-banner3.png")


# ---------------------------------------------------------------- favicon (matches pfp/banner)
def make_favicon(out, size=256):
    W = size * SS
    base = vgrad(W, W, (16, 26, 35), (7, 12, 17))
    mask = Image.new("L", (W, W), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, W - 1, W - 1], radius=int(W * 0.24), fill=255)
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    img.paste(base.convert("RGBA"), (0, 0), mask)
    glow(img, W * 0.5, W * 0.5, W * 0.42, alpha=75)
    draw_orbit(img, W * 0.5, W * 0.5, W * 0.265)
    clipped = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    clipped.paste(img, (0, 0), mask)
    clipped.resize((size, size), Image.LANCZOS).save(out)


make_favicon("public/favicon.png")
print("saved public/favicon.png")
