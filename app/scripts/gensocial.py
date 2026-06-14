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
