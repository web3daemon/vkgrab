# Changelog

## 0.1.0 — 2026-09-29

First public release.

- Popup that finds videos on any vk.com / vk.ru / vkvideo.ru page: the open video, clips, `?z=video…` modals, `?list=` access keys, plus every other video linked on the page.
- Direct MP4 downloads in every quality VK serves (144p up to 4K) through `chrome.downloads`, with file sizes.
- Private and "signed-in only" videos via the user's own session.
- HLS fallback for videos without MP4: segments fetched in the tab (4 parallel, retries), joined into `.ts`, progress toast with cancel.
- Filenames `Title [oid_vid] 1080p.mp4`, safe on every OS; preferred quality remembered.
- Russian and English UI, light and dark theme.
- Zero-dependency tooling: unit tests (`node:test`), manifest/locale checker, reproducible zip packer, live smoke test (Playwright).
