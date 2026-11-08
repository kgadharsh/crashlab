# The home-screen icons (public/apple-touch-icon.png and public/icon-512.png): the car on amber.
# Usage: python3 scripts/appIcons.py public
import sys
from PIL import Image, ImageDraw
AMBER = (255, 179, 26)
for size, name in ((180, 'apple-touch-icon.png'), (512, 'icon-512.png')):
    s = 4; N = size * s
    ic = Image.new('RGB', (N, N), AMBER)  # square: phones round the corners themselves
    q = ImageDraw.Draw(ic)
    c = N / 2; sc = N / 34
    q.polygon([(c + (x - 16) * sc, c + (y - 16) * sc) for x, y in [(28, 16), (15, 10.5), (4.5, 12.5), (4.5, 19.5), (15, 21.5)]], fill=(24, 18, 4))
    q.ellipse((c + (14 - 3.4 - 16) * sc, c + (16 - 1.9 - 16) * sc, c + (14 + 3.4 - 16) * sc, c + (16 + 1.9 - 16) * sc), fill=AMBER)
    ic.resize((size, size), Image.LANCZOS).save(sys.argv[1] + '/' + name, optimize=True)
print('ok')
