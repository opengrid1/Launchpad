"""Render Hyprpad logo concepts as high-res PNGs (no SVG, supersampled for crisp AA)."""
import math
from PIL import Image, ImageDraw, ImageFilter, ImageChops

S = 4          # supersample factor
SZ = 256       # final size
W = SZ * S
R = int(W * 0.235)  # tile corner radius

CYAN_HI = (108, 236, 220)
CYAN_LO = (24, 191, 178)
TILE_TOP = (16, 26, 36)
TILE_BOT = (8, 13, 19)


def rounded_mask(w, radius):
    m = Image.new("L", (w, w), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, w - 1, w - 1], radius=radius, fill=255)
    return m


def vgrad(w, top, bot):
    g = Image.new("RGB", (1, w))
    for y in range(w):
        t = y / (w - 1)
        g.putpixel((0, y), tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)))
    return g.resize((w, w))


def diag_grad_rgba(w, c1, c2):
    g = Image.new("RGB", (64, 64))
    px = g.load()
    for y in range(64):
        for x in range(64):
            t = (x + y) / 126
            px[x, y] = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))
    return g.resize((w, w)).convert("RGBA")


def tile_base():
    icon = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    mask = rounded_mask(W, R)
    icon.paste(vgrad(W, TILE_TOP, TILE_BOT).convert("RGBA"), (0, 0), mask)
    # top gloss
    gloss = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    ImageDraw.Draw(gloss).ellipse([-W * 0.25, -W * 0.6, W * 1.25, W * 0.45], fill=(255, 255, 255, 38))
    gloss = gloss.filter(ImageFilter.GaussianBlur(W * 0.04))
    gloss.putalpha(ImageChops.multiply(gloss.getchannel("A"), mask))
    icon.alpha_composite(gloss)
    return icon, mask


def add_glow(icon, mask, cx, cy, rad, color=(63, 224, 207), alpha=120):
    glow = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=color + (alpha,))
    glow = glow.filter(ImageFilter.GaussianBlur(W * 0.05))
    glow.putalpha(ImageChops.multiply(glow.getchannel("A"), mask))
    icon.alpha_composite(glow)


def clip_to(shape_mask, fill_rgba):
    layer = fill_rgba.copy()
    layer.putalpha(shape_mask)
    return layer


def disc_with_shading(rad, c_hi, c_lo):
    """A circle filled with a diagonal gradient + a soft top-left highlight."""
    d = 2 * rad
    cm = Image.new("L", (d, d), 0)
    ImageDraw.Draw(cm).ellipse([0, 0, d - 1, d - 1], fill=255)
    disc = clip_to(cm, diag_grad_rgba(d, c_hi, c_lo))
    hl = Image.new("RGBA", (d, d), (0, 0, 0, 0))
    ImageDraw.Draw(hl).ellipse([d * 0.12, d * 0.08, d * 0.6, d * 0.5], fill=(255, 255, 255, 110))
    hl = hl.filter(ImageFilter.GaussianBlur(d * 0.08))
    hl.putalpha(ImageChops.multiply(hl.getchannel("A"), cm))
    disc.alpha_composite(hl)
    return disc


# ---------------------------------------------------------------- concept: orbit
def concept_orbit():
    icon, mask = tile_base()
    cx = cy = W // 2
    add_glow(icon, mask, cx, cy, W * 0.3)

    # orbit ring (tilted): draw on own layer, rotate, composite behind disc
    ring = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    rw = int(W * 0.022)
    ImageDraw.Draw(ring).ellipse(
        [cx - W * 0.34, cy - W * 0.17, cx + W * 0.34, cy + W * 0.17],
        outline=(150, 245, 232, 235), width=rw,
    )
    ring = ring.rotate(-24, resample=Image.BICUBIC, center=(cx, cy))
    icon.alpha_composite(ring)

    # core disc
    rad = int(W * 0.155)
    disc = disc_with_shading(rad, CYAN_HI, CYAN_LO)
    icon.alpha_composite(disc, (cx - rad, cy - rad))

    # satellite dot in front, on the ring's upper-right
    ang = math.radians(-24)
    ex, ey = W * 0.34, W * 0.17
    px = cx + (ex * math.cos(ang)) * math.cos(math.radians(-35)) - (ey * math.sin(ang)) * math.sin(math.radians(-35))
    sx = cx + 0.62 * W * 0.34 * math.cos(math.radians(-58))
    sy = cy + 0.62 * W * 0.34 * math.sin(math.radians(-58)) - W * 0.02
    sd = int(W * 0.05)
    sat = disc_with_shading(sd, (210, 255, 250), CYAN_HI)
    icon.alpha_composite(sat, (int(sx - sd), int(sy - sd)))
    return icon


# ---------------------------------------------------------------- concept: spark
def star_points(cx, cy, outer, inner, n=4, rot=0):
    pts = []
    for k in range(n * 2):
        ang = rot + math.pi * k / n
        r = outer if k % 2 == 0 else inner
        pts.append((cx + r * math.sin(ang), cy - r * math.cos(ang)))
    return pts


def concept_spark():
    icon, mask = tile_base()
    cx = cy = W // 2
    add_glow(icon, mask, cx, cy, W * 0.28, alpha=140)

    sm = Image.new("L", (W, W), 0)
    ImageDraw.Draw(sm).polygon(star_points(cx, cy, W * 0.3, W * 0.085, 4, 0), fill=255)
    ImageDraw.Draw(sm).polygon(star_points(cx, cy, W * 0.17, W * 0.06, 4, math.pi / 4), fill=255)
    spark = clip_to(sm, diag_grad_rgba(W, CYAN_HI, CYAN_LO))
    icon.alpha_composite(spark)

    core = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    ImageDraw.Draw(core).ellipse([cx - W * 0.05, cy - W * 0.05, cx + W * 0.05, cy + W * 0.05], fill=(235, 255, 252, 255))
    core = core.filter(ImageFilter.GaussianBlur(W * 0.01))
    icon.alpha_composite(core)
    return icon


# ---------------------------------------------------------------- concept: prism
def concept_prism():
    icon, mask = tile_base()
    cx = cy = W // 2
    add_glow(icon, mask, cx, cy, W * 0.3)

    rad = W * 0.30
    hexpts = [(cx + rad * math.sin(math.radians(a)), cy - rad * math.cos(math.radians(a))) for a in range(0, 360, 60)]
    hm = Image.new("L", (W, W), 0)
    ImageDraw.Draw(hm).polygon(hexpts, fill=255)
    inner = Image.new("L", (W, W), 0)
    ir = rad * 0.66
    ipts = [(cx + ir * math.sin(math.radians(a)), cy - ir * math.cos(math.radians(a))) for a in range(0, 360, 60)]
    ImageDraw.Draw(inner).polygon(ipts, fill=255)
    ring_mask = ImageChops.subtract(hm, inner)
    hexagon = clip_to(ring_mask, diag_grad_rgba(W, CYAN_HI, CYAN_LO))
    icon.alpha_composite(hexagon)

    # inner facet lines for a prism feel
    facets = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    fd = ImageDraw.Draw(facets)
    for a in range(0, 360, 120):
        x = cx + ir * math.sin(math.radians(a + 30))
        y = cy - ir * math.cos(math.radians(a + 30))
        fd.line([cx, cy, x, y], fill=(120, 240, 226, 150), width=int(W * 0.014))
    fd.ellipse([cx - W * 0.04, cy - W * 0.04, cx + W * 0.04, cy + W * 0.04], fill=(220, 255, 250, 255))
    icon.alpha_composite(facets)
    return icon


def finish(icon, name):
    out = icon.resize((SZ, SZ), Image.LANCZOS)
    out.save(f"public/{name}.png")
    return out


concepts = {"orbit": concept_orbit(), "spark": concept_spark(), "prism": concept_prism()}
finals = {k: finish(v, f"logo-{k}") for k, v in concepts.items()}

# side-by-side preview on the app background
pad, gap, label = 48, 40, 30
cell = SZ
prev = Image.new("RGB", (pad * 2 + cell * 3 + gap * 2, pad * 2 + cell + label), (11, 15, 20))
d = ImageDraw.Draw(prev)
for i, (k, img) in enumerate(finals.items()):
    x = pad + i * (cell + gap)
    prev.paste(img, (x, pad), img)
    d.text((x + cell // 2 - 18, pad + cell + 6), k, fill=(160, 166, 176))
prev.save("/tmp/logo-concepts.png")
finals["orbit"].save("public/logo.png")  # default live logo
print("saved:", list(finals), "+ /tmp/logo-concepts.png")
