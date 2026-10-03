"""Build the Windows icon from the approved, unchanged idle cat artwork."""

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
source = Image.open(ROOT / "assets" / "Idle 1.png").convert("RGBA")
bounds = source.getchannel("A").getbbox()
if not bounds:
    raise SystemExit("Idle artwork has no visible pixels")

cat = source.crop(bounds)
side = max(cat.size)
padding = round(side * 0.05)
canvas = Image.new("RGBA", (side + padding * 2, side + padding * 2))
canvas.alpha_composite(cat, ((canvas.width - cat.width) // 2, (canvas.height - cat.height) // 2))

output = ROOT / "build" / "icon.ico"
canvas.save(output, format="ICO", sizes=[(size, size) for size in (16, 24, 32, 48, 64, 128, 256)])
print(f"Created {output} from assets/Idle 1.png")
