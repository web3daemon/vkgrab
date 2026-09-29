'use strict';

const VK = globalThis.VKGrab;
const t = (key, ...subs) => chrome.i18n.getMessage(key, subs) || key;
const $app = document.getElementById('app');

const DOWNLOAD_ICON =
  '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M7.25 1.5h1.5v7.19l2.47-2.47 1.06 1.06L8 11.56 3.72 7.28l1.06-1.06 2.47 2.47zM2.5 12.5h11V14h-11z"/></svg>';

function localize(root) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
}

function showMessage({ glyph = '!', title, text, error = false, retry = null }) {
  const node = document.getElementById('tpl-message').content.cloneNode(true);
  const sec = node.querySelector('.state');
  if (error) sec.classList.add('error');
  node.querySelector('.glyph').textContent = glyph;
  node.querySelector('h2').textContent = title;
  node.querySelector('p').textContent = text || '';
  if (retry) {
    const b = document.createElement('button');
    b.className = 'ghost';
    b.textContent = t('retry');
    b.addEventListener('click', retry);
    sec.appendChild(b);
  }
  $app.replaceChildren(node);
}

function showLoading() {
  $app.innerHTML = '<section class="state"><div class="spinner"></div><p></p></section>';
  $app.querySelector('p').textContent = t('stateLoading');
}

// ---------- talking to the content script ----------

async function getTargetTab() {
  // popup.html?tab=123 lets tests and screenshots point the popup at a tab.
  const forced = Number(new URLSearchParams(location.search).get('tab'));
  if (forced) return chrome.tabs.get(forced);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function send(tabId, msg) {
  let res;
  try {
    res = await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    // Tab was open before the extension was installed: inject on demand.
    await chrome.scripting.executeScript({ target: { tabId }, files: ['lib/vk.js', 'content.js'] });
    res = await chrome.tabs.sendMessage(tabId, msg);
  }
  if (!res) throw new Error(t('errReload'));
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

// ---------- rendering ----------

const state = { tab: null, scan: null, selected: null, info: null };

function formatRow({ height, kind, meta, size, best, onClick }) {
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.className = 'fmt' + (best ? ' best' : '');
  b.innerHTML = `<span class="q"></span><span class="tag"></span><span class="meta"></span><span class="size"></span>${DOWNLOAD_ICON}`;
  b.querySelector('.q').textContent = `${height}p`;
  b.querySelector('.tag').textContent = kind;
  b.querySelector('.meta').textContent = meta || '';
  b.querySelector('.size').textContent = size || '';
  b.addEventListener('click', onClick);
  li.appendChild(b);
  return li;
}

function setStatus(root, text, error = false) {
  const s = root.querySelector('.status');
  s.textContent = text;
  s.classList.toggle('error', error);
}

async function renderVideo(info) {
  const node = document.getElementById('tpl-video').content.cloneNode(true);
  localize(node);
  const root = node.querySelector('.video');

  const img = node.querySelector('.thumb img');
  img.src = info.thumb || '';
  img.addEventListener('error', () => img.setAttribute('src', ''));
  node.querySelector('.dur').textContent = info.duration ? VK.formatDuration(info.duration) : '';
  node.querySelector('.title').textContent = info.title || `video${info.oid}_${info.vid}`;
  node.querySelector('.title').title = info.title || '';
  node.querySelector('.author').textContent = info.author || '';

  const list = node.querySelector('.formats');
  const { preferred } = await chrome.storage.local.get('preferred');

  if (info.live) {
    setStatus(root, t('errLive'), true);
  } else if (info.mp4.length) {
    const best = info.mp4.find((f) => f.height === preferred) || info.mp4[0];
    for (const f of info.mp4) {
      const li = formatRow({
        height: f.height,
        kind: 'MP4',
        best: f === best,
        onClick: () => downloadMp4(root, info, f),
      });
      li.dataset.url = f.url;
      list.appendChild(li);
    }
    send(state.tab.id, { type: 'vkgrab:sizes', urls: info.mp4.map((f) => f.url) })
      .then((sizes) => {
        for (const li of list.children) {
          const n = sizes[li.dataset.url];
          if (n) li.querySelector('.size').textContent = VK.formatSize(n);
        }
      })
      .catch(() => {});
  } else if (info.hlsVariants.length) {
    info.hlsVariants.forEach((v, i) => {
      list.appendChild(
        formatRow({
          height: v.height,
          kind: 'HLS',
          meta: i === 0 ? t('hlsHint') : '',
          best: i === 0,
          onClick: () => downloadHls(root, info, v),
        }),
      );
    });
  } else {
    setStatus(root, t('errNoFormats'), true);
  }

  renderOthers(node);
  $app.replaceChildren(node);
}

function renderOthers(node) {
  const others = state.scan.videos;
  if (others.length < 2) return;
  const box = node.querySelector('.others');
  box.hidden = false;
  box.querySelector('.count').textContent = others.length;
  const ul = box.querySelector('.list');
  for (const v of others) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.innerHTML = '<span class="t"></span><span class="id"></span>';
    b.querySelector('.t').textContent = v.title || `video${v.id}`;
    b.querySelector('.id').textContent = v.id;
    if (v.id === state.selected.id) b.classList.add('active');
    b.addEventListener('click', () => select(v));
    li.appendChild(b);
    ul.appendChild(li);
  }
}

// ---------- actions ----------

async function downloadMp4(root, info, f) {
  const filename = VK.buildFilename(info, f.height, 'mp4');
  try {
    await chrome.downloads.download({ url: f.url, filename, conflictAction: 'uniquify' });
    await chrome.storage.local.set({ preferred: f.height });
    setStatus(root, t('downloadStarted', `${f.height}p`));
  } catch (e) {
    setStatus(root, String(e.message || e), true);
  }
}

async function downloadHls(root, info, v) {
  const filename = VK.buildFilename(info, v.height, 'ts');
  try {
    await send(state.tab.id, { type: 'vkgrab:hls', variantUrl: v.url, filename });
    setStatus(root, t('hlsStarted'));
  } catch (e) {
    setStatus(root, String(e.message || e), true);
  }
}

async function select(ref) {
  state.selected = ref;
  showLoading();
  try {
    state.info = await send(state.tab.id, { type: 'vkgrab:info', id: ref.id, list: ref.list });
    await renderVideo(state.info);
  } catch (e) {
    const msg = String(e.message || e);
    showMessage({
      title: t('stateErrorTitle'),
      text: msg === 'no_player' ? t('errNoPlayer') : msg,
      error: true,
      retry: () => select(ref),
    });
  }
}

async function main() {
  document.getElementById('ver').textContent = 'v' + chrome.runtime.getManifest().version;
  localize(document);

  const tab = await getTargetTab();
  state.tab = tab;
  let host = '';
  try {
    host = new URL(tab.url).hostname;
  } catch {
    /* no access to this tab's URL — not a VK tab */
  }
  if (!VK.isVkHost(host)) {
    showMessage({ glyph: '↓', title: t('stateNotVkTitle'), text: t('stateNotVkText') });
    return;
  }

  try {
    state.scan = await send(tab.id, { type: 'vkgrab:scan' });
  } catch (e) {
    showMessage({ title: t('stateErrorTitle'), text: String(e.message || e), error: true, retry: main });
    return;
  }
  const { current, videos } = state.scan;
  if (!videos.length) {
    showMessage({ glyph: '?', title: t('stateNoVideoTitle'), text: t('stateNoVideoText') });
    return;
  }
  await select(videos.find((v) => v.id === current) || videos[0]);
}

main();
