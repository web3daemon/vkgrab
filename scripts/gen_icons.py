"""Render the extension icons (16/32/48/128) and the README banner.

    python scripts/gen_icons.py

The mark: a rounded tile with a downward "play" triangle landing on a bar —
"play" + "download" in one glyph. Drawn at 1024 px and downscaled, so every
size is anti-aliased from the same geometry.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "extension" / "icons"
ASSETS = ROOT / "assets"

TOP = (86, 156, 255)
BOTTOM = (38, 99, 235)
INK = (255, 255, 255)


def gradient(size: int) -> Image.Image:
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        k = y / (size - 1)
        c = tuple(round(TOP[i] + (BOTTOM[i] - TOP[i]) * k) for i in range(3))
        for x in range(size):
            px[x, y] = c
    return img


def mark(size: int = 1024) -> Image.Image:
    s = size
    tile = gradient(s)
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, s - 1, s - 1), radius=int(s * 0.23), fill=255)

    ink = Image.new("L", (s, s), 0)
    d = ImageDraw.Draw(ink)
    # downward triangle with softened corners: draw polygon + round joints
    cx, top, bottom, half = s / 2, s * 0.22, s * 0.62, s * 0.25
    tri = [(cx - half, top), (cx + half, top), (cx, bottom)]
    d.polygon(tri, fill=255)
    r = s * 0.045
    for x, y in tri:
        d.ellipse((x - r, y - r, x + r, y + r), fill=255)
    d.line([tri[0], tri[1]], fill=255, width=int(r * 2))
    d.line([tri[1], tri[2]], fill=255, width=int(r * 2))
    d.line([tri[2], tri[0]], fill=255, width=int(r * 2))
    # landing bar
    d.rounded_rectangle((s * 0.24, s * 0.71, s * 0.76, s * 0.80), radius=int(s * 0.045), fill=255)

    out = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    out.paste(tile, (0, 0), mask)
    white = Image.new("RGBA", (s, s), INK + (255,))
    out.paste(white, (0, 0), ink)
    return out


def banner(icon: Image.Image) -> Image.Image:
    w, h = 1280, 640
    img = Image.new("RGB", (w, h), (15, 17, 22))
    d = ImageDraw.Draw(img)
    for y in range(h):  # subtle vertical fade
        k = y / h
        d.line([(0, y), (w, y)], fill=(round(15 + 8 * k), round(17 + 10 * k), round(22 + 18 * k)))
    ic = icon.resize((220, 220), Image.LANCZOS)
    img.paste(ic, (120, 210), ic)

    def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
        for name in (["segoeuib.ttf", "arialbd.ttf"] if bold else ["segoeui.ttf", "arial.ttf"]):
            try:
                return ImageFont.truetype(name, size)
            except OSError:
                continue
        return ImageFont.load_default()

    d.text((390, 205), "vkgrab", font=font(112, True), fill=(240, 242, 246))
    d.text((394, 345), "Скачивайте видео из VK в один клик", font=font(38), fill=(170, 178, 192))
    d.text((394, 398), "MP4 до 4K · HLS · приватные видео через вашу сессию", font=font(30), fill=(110, 150, 230))
    return img


def main() -> None:
    ICONS.mkdir(parents=True, exist_ok=True)
    ASSETS.mkdir(parents=True, exist_ok=True)
    big = mark()
    for size in (16, 32, 48, 128):
        big.resize((size, size), Image.LANCZOS).save(ICONS / f"icon{size}.png")
    big.resize((512, 512), Image.LANCZOS).save(ASSETS / "icon.png")
    banner(big).save(ASSETS / "banner.png")
    print("icons ->", ICONS, "| banner ->", ASSETS / "banner.png")


if __name__ == "__main__":
    main()
