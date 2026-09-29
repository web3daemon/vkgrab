// Runs inside VK pages. Talks to VK with the user's own session (same-origin
// fetch), so private and "signed-in only" videos work exactly as in the player.

(function () {
  'use strict';
  if (window.__vkgrabLoaded) return;
  window.__vkgrabLoaded = true;

  const VK = globalThis.VKGrab;
  const t = (key, ...subs) => chrome.i18n.getMessage(key, subs) || key;

  // ---------- discovery ----------

  function scanPage() {
    const seen = new Map();
    const add = (ref, title) => {
      if (!ref || seen.has(ref.id)) return;
      seen.set(ref.id, { ...ref, title: (title || '').replace(/\s+/g, ' ').trim().slice(0, 140) });
    };

    const current = VK.parseVideoRef(location.href);
    if (current) add(current, document.title);

    const nodes = document.querySelectorAll('a[href*="video"], a[href*="clip"], [data-video], [data-video-id]');
    for (const el of nodes) {
      if (seen.size >= 40) break;
      const raw = el.getAttribute('href') || '';
      let ref = raw ? VK.parseVideoRef(raw) : null;
      if (!ref) {
        const dv = el.getAttribute('data-video') || el.getAttribute('data-video-id') || '';
        ref = /^-?\d+_\d+$/.test(dv) ? VK.parseVideoRef('/video' + dv) : null;
      }
      if (!ref) continue;
      const title = el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent;
      add(ref, title);
    }
    return { current: current ? current.id : null, videos: [...seen.values()] };
  }

  // ---------- metadata ----------

  async function fetchInfo(id, list) {
    const body = new URLSearchParams({ act: 'show', al: '1', video: id });
    if (list) body.set('list', list);
    const r = await fetch('/al_video.php?act=show', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
      body,
    });
    if (!r.ok) throw new Error(t('errHttp', String(r.status)));
    const text = VK.decodeResponse(await r.arrayBuffer(), r.headers.get('content-type'));
    let json;
    try {
      json = JSON.parse(text.replace(/^<!--/, ''));
    } catch {
      throw new Error(t('errNotJson'));
    }
    const info = VK.parseShowResponse(json);

    // No progressive MP4 (some long videos, stream recordings): offer HLS.
    info.hlsVariants = [];
    if (!info.mp4.length && info.hls && !info.live) {
      const master = await (await fetch(info.hls)).text();
      info.hlsVariants = VK.parseHlsMaster(master, info.hls);
    }
    return info;
  }

  async function fetchSizes(urls) {
    const out = {};
    await Promise.all(
      urls.map(async (u) => {
        try {
          const r = await fetch(u, { method: 'HEAD' });
          const n = Number(r.headers.get('content-length'));
          if (r.ok && n) out[u] = n;
        } catch {
          /* size stays unknown */
        }
      }),
    );
    return out;
  }

  // ---------- HLS download (fallback path) ----------

  const jobs = new Map();

  async function fetchRetry(url, signal, tries = 4) {
    for (let i = 0; ; i++) {
      try {
        const r = await fetch(url, { signal });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return await r.arrayBuffer();
      } catch (e) {
        if (signal.aborted || i >= tries - 1) throw e;
        await new Promise((res) => setTimeout(res, 600 * (i + 1)));
      }
    }
  }

  async function downloadHls({ variantUrl, filename }) {
    const ctrl = new AbortController();
    const jobId = Math.random().toString(36).slice(2);
    const toast = createToast(filename, () => ctrl.abort());
    jobs.set(jobId, ctrl);
    try {
      const media = VK.parseHlsMedia(await (await fetch(variantUrl, { signal: ctrl.signal })).text(), variantUrl);
      if (media.encrypted) throw new Error(t('errDrm'));
      if (!media.segments.length) throw new Error(t('errEmptyPlaylist'));

      const parts = new Array(media.segments.length);
      let done = 0;
      let bytes = 0;
      let next = 0;
      const worker = async () => {
        while (next < media.segments.length) {
          const i = next++;
          parts[i] = await fetchRetry(media.segments[i], ctrl.signal);
          done++;
          bytes += parts[i].byteLength;
          toast.progress(done / media.segments.length, bytes);
        }
      };
      await Promise.all(Array.from({ length: 4 }, worker));

      if (media.init) parts.unshift(await fetchRetry(media.init, ctrl.signal));
      const ext = media.init ? 'mp4' : 'ts';
      const blob = new Blob(parts, { type: media.init ? 'video/mp4' : 'video/mp2t' });
      saveBlob(blob, filename.replace(/\.\w+$/, '') + '.' + ext);
      toast.finish(t('toastDone', VK.formatSize(blob.size)));
    } catch (e) {
      toast.finish(ctrl.signal.aborted ? t('toastCancelled') : t('toastError', e.message), true);
    } finally {
      jobs.delete(jobId);
    }
  }

  function saveBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  }

  function createToast(filename, onCancel) {
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        .t{font:13px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;width:300px;padding:12px 14px;border-radius:12px;
           background:#16181d;color:#e8eaed;box-shadow:0 8px 28px rgba(0,0,0,.35);border:1px solid #2a2e36}
        .h{display:flex;align-items:center;gap:8px;margin-bottom:6px;font-weight:600}
        .n{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#9aa0a6;margin-bottom:8px}
        .bar{height:6px;border-radius:3px;background:#2a2e36;overflow:hidden}
        .fill{height:100%;width:0;background:#3d8bfd;transition:width .2s}
        .row{display:flex;justify-content:space-between;align-items:center;margin-top:8px;color:#9aa0a6}
        button{all:unset;cursor:pointer;color:#3d8bfd}
        .err .fill{background:#e5534b}
      </style>
      <div class="t">
        <div class="h">vkgrab · HLS</div>
        <div class="n"></div>
        <div class="bar"><div class="fill"></div></div>
        <div class="row"><span class="s"></span><button></button></div>
      </div>`;
    root.querySelector('.n').textContent = filename;
    root.querySelector('.s').textContent = t('toastPreparing');
    root.querySelector('button').textContent = t('toastCancel');
    const fill = root.querySelector('.fill');
    const status = root.querySelector('.s');
    const btn = root.querySelector('button');
    btn.addEventListener('click', onCancel);
    document.documentElement.appendChild(host);
    return {
      progress(frac, bytes) {
        fill.style.width = `${(frac * 100).toFixed(1)}%`;
        status.textContent = `${Math.floor(frac * 100)}% · ${VK.formatSize(bytes)}`;
      },
      finish(text, isError) {
        if (isError) root.querySelector('.t').classList.add('err');
        else fill.style.width = '100%';
        status.textContent = text;
        btn.textContent = t('toastClose');
        btn.onclick = () => host.remove();
        setTimeout(() => host.remove(), isError ? 15_000 : 6_000);
      },
    };
  }

  // ---------- messaging ----------

  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    const run = async () => {
      switch (msg && msg.type) {
        case 'vkgrab:scan':
          return scanPage();
        case 'vkgrab:info':
          return fetchInfo(msg.id, msg.list);
        case 'vkgrab:sizes':
          return fetchSizes(msg.urls || []);
        case 'vkgrab:hls':
          downloadHls(msg); // long-running, reports progress in the page itself
          return { started: true };
        default:
          throw new Error('unknown message');
      }
    };
    run().then(
      (data) => reply({ ok: true, data }),
      (e) => reply({ ok: false, error: String((e && e.message) || e) }),
    );
    return true;
  });
})();
