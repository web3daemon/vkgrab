// Pure helpers shared by the content script, the popup and the node tests.
// No DOM, no chrome.* — everything here takes plain data and returns plain data.

(function (root) {
  'use strict';

  const VK_HOSTS = ['vk.com', 'vk.ru', 'vkvideo.ru'];

  // "video-123_456", "clip123_456" etc. Owner id may be negative (communities).
  const REF_RE = /(?:video|clip)(-?\d+)_(\d+)/;

  function isVkHost(hostname) {
    const h = String(hostname || '').toLowerCase();
    return VK_HOSTS.some((d) => h === d || h.endsWith('.' + d));
  }

  // Extracts {oid, vid, id, list} from any VK / VK Video URL form:
  //   https://vkvideo.ru/video-1_2
  //   https://vk.com/video-1_2?list=ln-abc
  //   https://vk.com/feed?z=video-1_2%2Fabcdef123   (access hash after the slash)
  //   https://vk.com/clip-1_2
  function parseVideoRef(input) {
    let url;
    try {
      url = new URL(String(input), 'https://vk.com/');
    } catch {
      return null;
    }
    const z = url.searchParams.get('z');
    const candidates = [z, url.pathname].filter(Boolean);
    for (const c of candidates) {
      const m = c.match(REF_RE);
      if (!m) continue;
      let list = url.searchParams.get('list') || null;
      if (!list && c === z) {
        const tail = z.slice(z.indexOf(m[0]) + m[0].length);
        const hash = tail.match(/^\/([0-9a-z_-]+)/i);
        if (hash && !/^pl_/i.test(hash[1])) list = hash[1];
      }
      return { oid: m[1], vid: m[2], id: `${m[1]}_${m[2]}`, list };
    }
    return null;
  }

  // al_video.php answers in windows-1251 regardless of the page encoding.
  function decodeResponse(buffer, contentType) {
    const cs = /charset=([\w-]+)/i.exec(contentType || '');
    const charset = cs ? cs[1].toLowerCase() : 'windows-1251';
    try {
      return new TextDecoder(charset).decode(buffer);
    } catch {
      return new TextDecoder('windows-1251').decode(buffer);
    }
  }

  function stripHtml(s) {
    return String(s || '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Turns the raw al_video.php?act=show JSON into what the UI needs.
  // Throws an Error with a human-readable message when VK refuses.
  function parseShowResponse(json) {
    const payload = json && json.payload;
    const data = payload && payload[1];
    const box = Array.isArray(data) ? data.find((x) => x && typeof x === 'object' && x.player) : null;
    const params = box && box.player && box.player.params && box.player.params[0];
    if (!params) {
      const msg = Array.isArray(data) ? data.map((x) => (typeof x === 'string' ? stripHtml(x) : '')).find((s) => s.length > 3) : '';
      const err = new Error(msg || 'no_player');
      err.code = 'no_player';
      throw err;
    }

    const mp4 = Object.keys(params)
      .map((k) => /^url(\d+)$/.exec(k))
      .filter(Boolean)
      .map((m) => ({ height: Number(m[1]), url: params[m[0]] }))
      .filter((f) => typeof f.url === 'string' && /^https?:/.test(f.url))
      .sort((a, b) => b.height - a.height);

    const mv = box.mvData || {};
    return {
      oid: String(params.oid ?? mv.oid ?? ''),
      vid: String(params.vid ?? mv.vid ?? ''),
      title: stripHtml(params.md_title || mv.title || ''),
      author: stripHtml(params.md_author || ''),
      duration: Number(params.duration || mv.duration || 0),
      thumb: params.jpg || params.first_frame_800 || params.first_frame_320 || '',
      live: Boolean(params.live && params.live !== 0),
      mp4,
      hls: typeof params.hls === 'string' ? params.hls : null,
      hlsFmp4: typeof params.hls_fmp4 === 'string' ? params.hls_fmp4 : null,
    };
  }

  function parseAttrs(s) {
    const out = {};
    const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
    let m;
    while ((m = re.exec(s))) out[m[1]] = m[2].replace(/^"|"$/g, '');
    return out;
  }

  // Master playlist -> [{height, width, bandwidth, url}], best first.
  function parseHlsMaster(text, baseUrl) {
    const lines = String(text).split(/\r?\n/);
    const variants = [];
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
      const a = parseAttrs(lines[i].slice(18));
      let j = i + 1;
      while (j < lines.length && (!lines[j] || lines[j].startsWith('#'))) j++;
      if (j >= lines.length) break;
      const [w, h] = (a.RESOLUTION || '0x0').split('x').map(Number);
      variants.push({ width: w, height: h, bandwidth: Number(a.BANDWIDTH || 0), url: new URL(lines[j].trim(), baseUrl).href });
    }
    return variants.sort((x, y) => y.height - x.height || y.bandwidth - x.bandwidth);
  }

  // Media playlist -> {init, segments[], encrypted}
  function parseHlsMedia(text, baseUrl) {
    const lines = String(text).split(/\r?\n/).map((l) => l.trim());
    let init = null;
    let encrypted = false;
    const segments = [];
    for (const l of lines) {
      if (!l) continue;
      if (l.startsWith('#EXT-X-MAP:')) {
        const uri = parseAttrs(l.slice(11)).URI;
        if (uri) init = new URL(uri, baseUrl).href;
      } else if (l.startsWith('#EXT-X-KEY:')) {
        const method = parseAttrs(l.slice(11)).METHOD;
        if (method && method !== 'NONE') encrypted = true;
      } else if (!l.startsWith('#')) {
        segments.push(new URL(l, baseUrl).href);
      }
    }
    return { init, segments, encrypted };
  }

  // Safe on Windows/macOS/Linux, keeps Cyrillic.
  function sanitizeFilename(name, max = 120) {
    let s = String(name || '')
      .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^[.\s]+|[.\s]+$/g, '');
    if (s.length > max) s = s.slice(0, max).trim();
    if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = '_' + s;
    return s || 'video';
  }

  function buildFilename(info, height, ext) {
    const base = sanitizeFilename(info.title || `video${info.oid}_${info.vid}`);
    return `${base} [${info.oid}_${info.vid}] ${height}p.${ext}`;
  }

  function formatDuration(sec) {
    sec = Math.max(0, Math.round(Number(sec) || 0));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = String(sec % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  }

  function formatSize(bytes) {
    const b = Number(bytes);
    if (!b) return '';
    if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
    if (b < 1024 ** 3) return `${(b / 1024 ** 2).toFixed(b < 10 * 1024 ** 2 ? 1 : 0)} MB`;
    return `${(b / 1024 ** 3).toFixed(2)} GB`;
  }

  const api = {
    VK_HOSTS,
    isVkHost,
    parseVideoRef,
    decodeResponse,
    stripHtml,
    parseShowResponse,
    parseHlsMaster,
    parseHlsMedia,
    sanitizeFilename,
    buildFilename,
    formatDuration,
    formatSize,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VKGrab = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
