# The link-preview card (public/og.png, 1200 x 630): a frosted-glass card over a track and the car.
# Uses Avenir Next from macOS. Usage: python3 scripts/previewImage.py public/og.png
import math, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops
OUT = sys.argv[1]
S = 2
W, H = 1200 * S, 630 * S
AV = '/System/Library/Fonts/Avenir Next.ttc'
font = lambda size, face: ImageFont.truetype(AV, size * S, index={'bold': 0, 'demi': 2, 'medium': 5, 'regular': 7}[face])
AMBER = (255, 179, 26); CYAN = (90, 210, 255)

# ---- the scene behind the glass: a dark gradient, a track, the car ----
scene = Image.new('RGB', (W, H))
top, bot = (16, 20, 28), (8, 10, 14)
sd = ImageDraw.Draw(scene)
for y in range(H):
    t = y / H
    sd.line([(0, y), (W, y)], fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)))

def bez(p0, p1, p2, p3, n=400):
    out = []
    for i in range(n + 1):
        t = i / n; u = 1 - t
        out.append((u**3*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t**3*p3[0], u**3*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t**3*p3[1]))
    return out
def offset(pts, dist):
    out = []
    for i in range(len(pts)):
        a = pts[max(0, i - 1)]; b = pts[min(len(pts) - 1, i + 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy) or 1
        out.append((pts[i][0] - dy / L * dist, pts[i][1] + dx / L * dist))
    return out

road = bez((-0.05 * W, 0.98 * H), (0.40 * W, 1.02 * H), (0.62 * W, 0.20 * H), (1.08 * W, 0.18 * H))
RW = 170 * S
sd.polygon(offset(road, RW / 2 + 5 * S) + offset(road, -RW / 2 - 5 * S)[::-1], fill=(70, 78, 92))
sd.polygon(offset(road, RW / 2) + offset(road, -RW / 2)[::-1], fill=(30, 35, 44))
kerb = offset(road, -RW / 2 + 7 * S)
for i in range(0, len(kerb) - 5, 5):
    sd.line(kerb[i:i + 6], fill=(214, 64, 58) if (i // 5) % 2 else (236, 238, 242), width=13 * S)
for i in range(0, len(road) - 8, 16):
    sd.line(road[i:i + 7], fill=(62, 70, 84), width=4 * S)

# the car where the road leaves the card, its rays fanning ahead
k = min(range(len(road)), key=lambda i: abs(road[i][0] - 0.78 * W))
cx, cy = road[k]; nx, ny = road[k + 4]
ang = math.atan2(ny - cy, nx - cx)
rot = lambda x, y: (cx + x * math.cos(ang) - y * math.sin(ang), cy + x * math.sin(ang) + y * math.cos(ang))
rays = Image.new('RGBA', (W, H), (0, 0, 0, 0)); rd = ImageDraw.Draw(rays)
for spread in (-50, -25, 0, 25, 50):
    a = math.radians(spread); L = (230 if spread == 0 else 180) * S
    ex, ey = rot(math.cos(a) * L, math.sin(a) * L)
    rd.line([rot(40 * S, 0), (ex, ey)], fill=CYAN + (200,), width=3 * S)
    rd.ellipse((ex - 6 * S, ey - 6 * S, ex + 6 * S, ey + 6 * S), fill=CYAN + (255,))
scene.paste(rays, (0, 0), rays)
sd = ImageDraw.Draw(scene)
body = [(62, 0), (-34, -30), (-56, -27), (-56, 27), (-34, 30)]
sd.polygon([rot(x * S, y * S) for x, y in body], fill=AMBER)
sd.polygon([rot(x * S, y * S) for x, y in [(10, 0), (-14, -11), (-28, 0), (-14, 11)]], fill=(20, 24, 30))

# ---- the glass card ----
X0, Y0, X1, Y1 = 72 * S, 118 * S, 700 * S, 512 * S
R = 46 * S
mask = Image.new('L', (W, H), 0)
ImageDraw.Draw(mask).rounded_rectangle((X0, Y0, X1, Y1), radius=R, fill=255)
# soft shadow under the card
shadow = Image.new('L', (W, H), 0)
ImageDraw.Draw(shadow).rounded_rectangle((X0, Y0 + 26 * S, X1, Y1 + 26 * S), radius=R, fill=150)
shadow = shadow.filter(ImageFilter.GaussianBlur(40 * S))
img = Image.composite(Image.new('RGB', (W, H), (0, 0, 0)), scene, shadow)
# frosted: the scene blurred, lifted towards white
frost = scene.filter(ImageFilter.GaussianBlur(34 * S))
frost = Image.blend(frost, Image.new('RGB', (W, H), (255, 255, 255)), 0.12)
# a faint top-to-bottom sheen
sheen = Image.new('L', (W, H), 0); shd = ImageDraw.Draw(sheen)
for y in range(Y0, Y1):
    shd.line([(X0, y), (X1, y)], fill=int(34 * (1 - (y - Y0) / (Y1 - Y0)) ** 1.6))
frost = Image.composite(Image.new('RGB', (W, H), (255, 255, 255)), frost, sheen)
img.paste(frost, (0, 0), mask)
# the edge: a thin light rim, brighter along the top
rim = Image.new('RGBA', (W, H), (0, 0, 0, 0)); rimd = ImageDraw.Draw(rim)
rimd.rounded_rectangle((X0, Y0, X1, Y1), radius=R, outline=(255, 255, 255, 70), width=2 * S)
rimd.rounded_rectangle((X0 + 2 * S, Y0 + 2 * S, X1 - 2 * S, Y1 - 2 * S), radius=R - 2 * S, outline=(255, 255, 255, 22), width=1 * S)
fade = Image.new('L', (W, H), 0); fd = ImageDraw.Draw(fade)
for y in range(Y0, Y0 + 90 * S):
    fd.line([(X0, y), (X1, y)], fill=int(120 * (1 - (y - Y0) / (90 * S))))
rim.putalpha(ImageChops.add(rim.getchannel('A'), ImageChops.multiply(fade, rim.getchannel('A').point(lambda v: 255 if v else 0))))
img.paste(rim, (0, 0), rim)

# ---- what is on the card ----
d = ImageDraw.Draw(img)
PAD = 56 * S
ix, iy, isz = X0 + PAD, Y0 + PAD, 96 * S
d.rounded_rectangle((ix, iy, ix + isz, iy + isz), radius=24 * S, fill=AMBER)
c = (ix + isz / 2, iy + isz / 2); sc = isz / 34
d.polygon([(c[0] + (x - 16) * sc, c[1] + (y - 16) * sc) for x, y in [(28, 16), (15, 10.5), (4.5, 12.5), (4.5, 19.5), (15, 21.5)]], fill=(24, 18, 4))
d.ellipse((c[0] + (14 - 3.4 - 16) * sc, c[1] + (16 - 1.9 - 16) * sc, c[0] + (14 + 3.4 - 16) * sc, c[1] + (16 + 1.9 - 16) * sc), fill=AMBER)
d.text((ix + isz + 28 * S, iy - 4 * S), 'CrashLab', font=font(62, 'bold'), fill=(255, 255, 255))
d.text((ix + isz + 31 * S, iy + 66 * S), 'Racing game', font=font(23, 'medium'), fill=(190, 196, 206))
lines = ['Build a car, train its brain, and race it', 'on tracks it has never seen.']
for i, t in enumerate(lines):
    d.text((ix, iy + isz + 40 * S + i * 42 * S), t, font=font(28, 'medium'), fill=(236, 238, 242))
d.text((ix, Y1 - PAD - 18 * S), 'kgadharsh.github.io/crashlab', font=font(21, 'demi'), fill=(160, 168, 182))

img.resize((1200, 630), Image.LANCZOS).save(OUT, optimize=True)
print('ok')
