from pathlib import Path
from PIL import Image, ImageDraw

destination = Path(__file__).resolve().parents[1] / "frontend" / "public"
destination.mkdir(parents=True, exist_ok=True)
for size in (192, 512):
    image = Image.new("RGB", (size, size), "#147d70")
    draw = ImageDraw.Draw(image)
    outer = size * 0.21
    inner = size * 0.38
    draw.ellipse((outer, outer, size - outer, size - outer), outline="white", width=int(size * 0.055))
    draw.ellipse((inner, inner, size - inner, size - inner), fill="#dfc04a")
    image.save(destination / f"icon-{size}.png")