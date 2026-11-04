def mark(id, stripe='#fff6dc', bg=True, ink='#141008', wingfill='#fff6dc', outline=9, dx=-22):
    wings=f'''<g stroke="{ink}" stroke-width="{outline}" fill="{wingfill}" transform="translate({dx} 0)">
<ellipse cx="0" cy="-62" rx="50" ry="80" transform="translate(296 246) rotate(22)"/>
<ellipse cx="0" cy="-46" rx="38" ry="60" transform="translate(304 252) rotate(66)"/></g>'''
    back=f'<rect width="512" height="512" fill="url(#g{id})"/>' if bg else ''
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><radialGradient id="g{id}" cx="35%" cy="25%" r="85%"><stop offset="0" stop-color="#ffd34d"/><stop offset="1" stop-color="#ffb21a"/></radialGradient>
<clipPath id="bt{id}"><text x="{226+dx}" y="420" text-anchor="middle" font-family="Nunito" font-weight="900" font-size="300">B</text></clipPath></defs>
{back}{wings}<g clip-path="url(#bt{id})"><rect width="512" height="512" fill="{ink}"/><rect x="0" y="296" width="512" height="18" fill="{stripe}"/></g></svg>'''
