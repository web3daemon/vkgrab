# Privacy / Приватность

**Short version:** vkgrab collects nothing, stores nothing about you, and talks to no servers other than VK's own.

## What the extension does

- On `vk.com`, `vk.ru` and `vkvideo.ru` pages it reads the page URL and video links to find videos.
- When you open the popup, it requests the video's player parameters from VK (`/al_video.php`) **from the page itself**, with your existing VK cookies — the same request VK's player makes when you press play.
- When you pick a quality, the file is downloaded directly from VK's CDN — by Chrome's download manager (MP4) or inside the VK tab (HLS).

## What it does not do

- No analytics, telemetry, crash reporting or tracking of any kind.
- No servers of its own; no third-party requests.
- It never reads, stores or transmits your cookies, password or tokens — the browser attaches cookies to VK's own requests as usual.
- No access to pages outside VK domains.

## Stored data

One value in `chrome.storage.local`: the last quality you picked (e.g. `1080`). It never leaves your browser; removing the extension deletes it.

---

**Коротко:** vkgrab ничего не собирает, ничего о вас не хранит и не обращается ни к каким серверам, кроме серверов VK. Расширение запрашивает параметры плеера у VK со страницы и с вашими cookies — тот же запрос, что делает плеер VK. Аналитики, телеметрии и сторонних запросов нет. Локально хранится только последнее выбранное качество.
