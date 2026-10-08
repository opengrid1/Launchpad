"""Default token image for coins launched without one: the logo in one muted slate tone,
so it reads as "no image yet" and can't be mistaken for an official Etherhook coin.

    python3 brand/default-token.py   (from web/backstop) -> site/img/token-default.png
"""
import os
from PIL import Image, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
art = Image.open(os.path.join(HERE, 'logo-art.png')).convert('RGBA')
tone = ImageOps.colorize(ImageOps.grayscale(art.convert('RGB')), black='#0c1638', white='#5d6f9a').convert('RGBA')
tone.putalpha(art.getchannel('A'))
S, h = 512, 330
w = round(art.width * h / art.height)
bg = Image.new('RGBA', (S, S), '#0a1430')
bg.alpha_composite(tone.resize((w, h), Image.LANCZOS), ((S - w) // 2, (S - h) // 2))
bg.convert('RGB').resize((256, 256), Image.LANCZOS).save(os.path.join(HERE, '..', 'site', 'img', 'token-default.png'), optimize=True)
