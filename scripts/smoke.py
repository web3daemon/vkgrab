"""Live smoke test: load the unpacked extension into Chromium and download a real video.

    pip install playwright && playwright install chromium
    python scripts/smoke.py https://vkvideo.ru/video-XXXX_YYYY

Runs signed out, so pass a public video. Checks both paths:
  1. popup -> smallest MP4 -> chrome.downloads finishes without error
  2. content script -> lowest HLS variant -> .ts file with valid MPEG-TS sync bytes
Exit code 0 means both worked.
"""

import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

EXT = Path(__file__).resolve().parent.parent / "extension"


def main(url: str) -> int:
    out = Path(tempfile.mkdtemp(prefix="vkgrab-smoke-"))
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            tempfile.mkdtemp(), headless=True, channel="chromium", accept_downloads=True,
            args=[f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"],
        )
        mgr = ctx.new_page()
        mgr.goto("chrome://extensions")
        mgr.wait_for_timeout(800)
        info = mgr.evaluate("new Promise(r => chrome.developerPrivate.getExtensionsInfo(r))")
        ext = next(e for e in info if e["name"].startswith("vkgrab"))
        assert not ext.get("manifestErrors") and not ext.get("runtimeErrors"), ext
        ext_id = ext["id"]
        mgr.close()

        vk = ctx.new_page()
        vk.goto(url, wait_until="domcontentloaded")
        vk.wait_for_timeout(3000)

        popup = ctx.new_page()
        popup.goto(f"chrome-extension://{ext_id}/popup/popup.html")
        tab = popup.evaluate("chrome.tabs.query({}).then(ts => ts.find(t => /vk(video)?\\.(com|ru)/.test(t.url)).id)")
        popup.goto(f"chrome-extension://{ext_id}/popup/popup.html?tab={tab}")
        popup.wait_for_selector(".fmt, .state h2", timeout=20000)
        popup.wait_for_timeout(1500)
        rows = popup.locator(".fmt")
        print("popup:", popup.locator("main").inner_text().replace("\n", " | ")[:300])
        if not rows.count():
            print("FAIL: no formats (private video? try a public one)")
            return 1

        # 1) MP4 via chrome.downloads
        rows.last.click()
        for _ in range(180):
            items = popup.evaluate("chrome.downloads.search({})")
            if items and all(i["state"] != "in_progress" for i in items):
                break
            time.sleep(1)
        mp4 = items[-1]
        print(f"mp4: state={mp4['state']} bytes={mp4['bytesReceived']} mime={mp4.get('mime')}")
        ok_mp4 = mp4["state"] == "complete" and mp4["bytesReceived"] > 0

        # 2) HLS in the tab
        ref = popup.evaluate("u => VKGrab.parseVideoRef(u)", url)
        res = popup.evaluate("([tab, r]) => chrome.tabs.sendMessage(tab, {type: 'vkgrab:info', id: r.id, list: r.list})", [tab, ref])
        if not res.get("ok"):
            print("FAIL: info:", res.get("error"))
            return 1
        data = res["data"]
        ok_hls = True
        if data.get("hls"):
            master = vk.evaluate("async u => (await fetch(u)).text()", data["hls"])
            low = popup.evaluate("([t, u]) => VKGrab.parseHlsMaster(t, u)", [master, data["hls"]])[-1]
            with vk.expect_download(timeout=300000) as dl:
                popup.evaluate(
                    "([tab, u]) => chrome.tabs.sendMessage(tab, {type: 'vkgrab:hls', variantUrl: u, filename: 'smoke.ts'})",
                    [tab, low["url"]],
                )
            path = out / dl.value.suggested_filename
            dl.value.save_as(path)
            head = path.read_bytes()[:377]
            ok_hls = len(head) > 188 and head[0] == 0x47 and head[188] == 0x47
            print(f"hls: {low['height']}p -> {path.stat().st_size} bytes, mpeg-ts={ok_hls}")
        else:
            print("hls: not offered for this video, skipped")
        ctx.close()

    print("OK" if ok_mp4 and ok_hls else "FAIL")
    return 0 if ok_mp4 and ok_hls else 1


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    sys.exit(main(sys.argv[1]))
