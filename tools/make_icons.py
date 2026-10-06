"""Génère les icônes PNG (maison + flocon + flamme + 'PES'), thème bleu."""
from PIL import Image, ImageDraw, ImageFont
import math, os
OUT = os.path.join(os.path.dirname(__file__), '..', 'app', 'icons')
os.makedirs(OUT, exist_ok=True)
S = 1024

def font(size):
    for p in ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
              '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf']:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def base(maskable=False):
    img = Image.new('RGB', (S, S))
    d = ImageDraw.Draw(img)
    # dégradé bleu vertical
    top, bot = (30, 136, 229), (13, 71, 161)
    for y in range(S):
        t = y / (S - 1)
        d.line([(0, y), (S, y)], fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)))
    k = 0.78 if maskable else 1.0   # zone de sécurité pour icône "maskable"
    cx, cy = S / 2, S / 2
    def P(x, y):  # coordonnées dans un repère 1024 centré, réduit par k
        return (cx + (x - 512) * k, cy + (y - 512) * k)
    W = (255, 255, 255)
    # maison : toit + corps
    lw = int(46 * k)
    roof = [P(170, 470), P(512, 190), P(854, 470)]
    d.line(roof, fill=W, width=lw, joint='curve')
    for p in (roof[0], roof[2]):
        r = lw / 2; d.ellipse([p[0]-r, p[1]-r, p[0]+r, p[1]+r], fill=W)
    body = [P(250, 430), P(774, 760)]
    d.rounded_rectangle(body, radius=int(30*k), fill=W)
    # flocon (gauche) en bleu dans la maison
    fx, fy = P(395, 575); R = 95 * k
    for a in range(6):
        ang = math.radians(a * 60 + 90)
        x2, y2 = fx + R * math.cos(ang), fy - R * math.sin(ang)
        d.line([(fx, fy), (x2, y2)], fill=(21, 101, 192), width=int(16*k))
        for s in (-1, 1):  # petites branches
            bx, by = fx + R*0.6*math.cos(ang), fy - R*0.6*math.sin(ang)
            a2 = ang + s * math.radians(40)
            d.line([(bx, by), (bx + R*0.32*math.cos(a2), by - R*0.32*math.sin(a2))], fill=(21, 101, 192), width=int(13*k))
    # flamme (droite) orange
    gx, gy = P(630, 590)
    def F(x, y, sc): return (gx + x*sc*k, gy + y*sc*k)
    outer = [F(0,-120,1),F(40,-60,1),F(75,-10,1),F(78,40,1),F(55,90,1),F(0,115,1),F(-55,90,1),F(-78,40,1),F(-70,-5,1),F(-40,-40,1),F(-20,-10,1),F(-10,-70,1)]
    d.polygon(outer, fill=(251, 140, 0))
    inner = [F(0,-30,1),F(30,20,1),F(35,60,1),F(0,95,1),F(-35,60,1),F(-28,25,1)]
    d.polygon(inner, fill=(255, 202, 40))
    # PES
    f = font(int(150 * k))
    txt = 'PES'
    bb = d.textbbox((0, 0), txt, font=f)
    tw, th = bb[2]-bb[0], bb[3]-bb[1]
    tx, ty = P(512, 870)
    d.text((tx - tw/2 - bb[0], ty - th/2 - bb[1]), txt, font=f, fill=W)
    return img

big = base()
for n in (180, 192, 512):
    big.resize((n, n), Image.LANCZOS).save(os.path.join(OUT, f'icon-{n}.png'), optimize=True)
big.resize((180, 180), Image.LANCZOS).save(os.path.join(OUT, '..', 'apple-touch-icon.png'), optimize=True)
big.resize((32, 32), Image.LANCZOS).save(os.path.join(OUT, 'favicon-32.png'))
base(maskable=True).resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, 'icon-maskable-512.png'), optimize=True)
print('ok')
