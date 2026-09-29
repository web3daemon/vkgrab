"""Render README screenshots of the real popup with demo data.

    python scripts/screenshot.py        # needs: pip install playwright pillow

The popup runs unmodified; only the chrome.* APIs are replaced with a stub
that answers like a VK tab would. The thumbnail is generated here, so the
repo ships no third-party imagery.
"""

import base64
import io
import json
from pathlib import Path

from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
EXT = ROOT / "extension"
ASSETS = ROOT / "assets"


def demo_thumb() -> str:
    w, h = 640, 360
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):  # dusk sky
        k = y / h
        d.line([(0, y), (w, y)], fill=(int(40 + 180 * k), int(60 + 70 * k), int(140 - 40 * k)))
    d.ellipse((380, 170, 520, 310), fill=(255, 196, 120))
    for i, (x, top) in enumerate([(0, 250), (90, 215), (170, 265), (260, 200), (360, 245), (470, 225), (560, 255)]):
        d.rectangle((x, top, x + 95, h), fill=(22 + i * 3, 24 + i * 2, 38 + i * 4))
        for wy in range(top + 14, h - 10, 22):
            for wx in range(x + 12, x + 85, 20):
                if (wx * 7 + wy * 3 + i) % 5 < 2:
                    d.rectangle((wx, wy, wx + 7, wy + 9), fill=(255, 214, 140))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=88)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def stub(locale: str) -> str:
    messages = json.loads((EXT / "_locales" / locale / "messages.json").read_text("utf-8"))
    manifest = json.loads((EXT / "manifest.json").read_text("utf-8"))
    mp4 = [{"height": h, "url": f"https://cdn.example/{h}.mp4"} for h in (1080, 720, 480, 360, 240, 144)]
    sizes = {f"https://cdn.example/{h}.mp4": s for h, s in zip((1080, 720, 480, 360), (412e6, 231e6, 128e6, 82e6))}
    info = {
        "oid": "-100", "vid": "200", "title": "Таймлапс ночного города за 4 часа — от заката до огней",
        "author": "vkgrab demo", "duration": 754, "thumb": demo_thumb(), "live": False,
        "mp4": mp4, "hls": None, "hlsFmp4": None, "hlsVariants": [],
    }
    videos = [
        {"id": "-100_200", "title": "Таймлапс ночного города"},
        {"id": "-100_201", "title": "Как снимать гиперлапс на телефон"},
        {"id": "-100_202", "title": "Обзор штатива за 900 рублей"},
    ]
    return f"""
    (() => {{
      const M = {json.dumps(messages, ensure_ascii=False)};
      const replies = {{
        'vkgrab:scan': {{ current: '-100_200', videos: {json.dumps(videos, ensure_ascii=False)} }},
        'vkgrab:info': {json.dumps(info, ensure_ascii=False)},
        'vkgrab:sizes': {json.dumps(sizes)},
      }};
      window.chrome = {{
        i18n: {{ getMessage: (k, subs) => {{
          const m = M[k]; if (!m) return '';
          return m.message.replace(/\\$ARG\\$/g, (subs || [])[0] ?? '');
        }} }},
        runtime: {{ getManifest: () => ({json.dumps({"version": manifest["version"]})}) }},
        tabs: {{
          query: async () => [{{ id: 1, url: 'https://vkvideo.ru/video-100_200' }}],
          get: async () => ({{ id: 1, url: 'https://vkvideo.ru/video-100_200' }}),
          sendMessage: async (_id, msg) => ({{ ok: true, data: replies[msg.type] }}),
        }},
        scripting: {{ executeScript: async () => [] }},
        storage: {{ local: {{ get: async () => ({{ preferred: 1080 }}), set: async () => {{}} }} }},
        downloads: {{ download: async () => 1 }},
      }};
    }})();
    """


def shoot(page, scheme: str, locale: str) -> Image.Image:
    page.emulate_media(color_scheme=scheme)
    page.add_init_script(stub(locale))
    page.goto((EXT / "popup" / "popup.html").as_uri())
    page.wait_for_selector(".fmt")
    page.wait_for_timeout(300)
    page.evaluate("document.querySelector('.others').open = false")
    return Image.open(io.BytesIO(page.screenshot(full_page=True)))


def compose(shots: list[Image.Image]) -> Image.Image:
    pad, gap = 48, 40
    w = sum(s.width for s in shots) + gap * (len(shots) - 1) + pad * 2
    h = max(s.height for s in shots) + pad * 2
    canvas = Image.new("RGB", (w, h), (234, 238, 245))
    d = ImageDraw.Draw(canvas)
    for y in range(h):
        k = y / h
        d.line([(0, y), (w, y)], fill=(int(226 - 190 * k), int(233 - 195 * k), int(245 - 190 * k)))
    x = pad
    for s in shots:
        shadow = Image.new("RGBA", (s.width + 24, s.height + 24), (0, 0, 0, 0))
        ImageDraw.Draw(shadow).rounded_rectangle((12, 16, s.width + 12, s.height + 12), 18, fill=(0, 0, 0, 70))
        canvas.paste(shadow, (x - 12, pad - 12), shadow)
        mask = Image.new("L", s.size, 0)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, s.width - 1, s.height - 1), 14, fill=255)
        canvas.paste(s, (x, pad), mask)
        x += s.width + gap
    return canvas


def main() -> None:
    ASSETS.mkdir(exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        shots = []
        for scheme in ("light", "dark"):
            page = browser.new_page(viewport={"width": 360, "height": 200}, device_scale_factor=2)
            shots.append(shoot(page, scheme, "ru"))
            page.close()
        browser.close()
    img = compose(shots)
    img.save(ASSETS / "popup.png", optimize=True)
    print("->", ASSETS / "popup.png", img.size)


if __name__ == "__main__":
    main()
