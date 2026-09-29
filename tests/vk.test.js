'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const VK = require('../extension/lib/vk.js');

test('parseVideoRef: plain video and clip pages', () => {
  assert.deepEqual(VK.parseVideoRef('https://vkvideo.ru/video-22822305_456242110'), {
    oid: '-22822305',
    vid: '456242110',
    id: '-22822305_456242110',
    list: null,
  });
  assert.equal(VK.parseVideoRef('https://vk.com/video123_456').id, '123_456');
  assert.equal(VK.parseVideoRef('https://vk.com/clip-1_2').id, '-1_2');
  assert.equal(VK.parseVideoRef('/video7_8').id, '7_8');
});

test('parseVideoRef: list param and access hash in ?z=', () => {
  assert.equal(VK.parseVideoRef('https://vk.com/video-1_2?list=ln-AbC123').list, 'ln-AbC123');
  const z = VK.parseVideoRef('https://vk.com/feed?z=video-1_2%2F0a1b2c3d4e');
  assert.equal(z.id, '-1_2');
  assert.equal(z.list, '0a1b2c3d4e');
  // playlist suffix is not an access hash
  assert.equal(VK.parseVideoRef('https://vk.com/videos-1?z=video-1_2%2Fpl_-1_-2').list, null);
});

test('parseVideoRef: non-video URLs', () => {
  assert.equal(VK.parseVideoRef('https://vk.com/feed'), null);
  assert.equal(VK.parseVideoRef('https://vk.com/videos-1'), null);
  assert.equal(VK.parseVideoRef(':::'), null);
});

test('isVkHost', () => {
  for (const h of ['vk.com', 'm.vk.com', 'vk.ru', 'vkvideo.ru', 'www.vkvideo.ru']) assert.ok(VK.isVkHost(h), h);
  for (const h of ['evilvk.com', 'vk.com.example.org', 'example.com', '']) assert.ok(!VK.isVkHost(h), h);
});

test('decodeResponse: windows-1251 by default', () => {
  // "Видео" in cp1251
  const bytes = new Uint8Array([0xc2, 0xe8, 0xe4, 0xe5, 0xee]);
  assert.equal(VK.decodeResponse(bytes.buffer, 'application/json'), 'Видео');
  assert.equal(VK.decodeResponse(new TextEncoder().encode('Видео').buffer, 'application/json; charset=utf-8'), 'Видео');
});

function showFixture(params, extra = {}) {
  return {
    payload: [0, ['', '', '', '', { player: { type: 'vk', params: [params] }, mvData: { title: 'mv title' }, ...extra }]],
  };
}

test('parseShowResponse: progressive mp4, best first', () => {
  const info = VK.parseShowResponse(
    showFixture({
      oid: -1,
      vid: 2,
      md_title: 'Кот &amp; <b>пёс</b>',
      md_author: 'Автор',
      duration: 542,
      jpg: 'https://cdn.example/thumb.jpg',
      url360: 'https://cdn.example/v?type=2',
      url1080: 'https://cdn.example/v?type=5',
      url720: 'https://cdn.example/v?type=3',
      hls: 'https://cdn.example/master.m3u8',
    }),
  );
  assert.equal(info.title, 'Кот & пёс');
  assert.equal(info.author, 'Автор');
  assert.equal(info.oid, '-1');
  assert.deepEqual(
    info.mp4.map((f) => f.height),
    [1080, 720, 360],
  );
  assert.equal(info.hls, 'https://cdn.example/master.m3u8');
  assert.equal(info.live, false);
});

test('parseShowResponse: surfaces VK error text', () => {
  const json = { payload: [0, ['Это видео <b>недоступно</b>', '', '']] };
  assert.throws(() => VK.parseShowResponse(json), /Это видео недоступно/);
  assert.throws(() => VK.parseShowResponse({}), (e) => e.code === 'no_player');
});

test('parseHlsMaster: variants resolved and sorted', () => {
  const master = [
    '#EXTM3U',
    '#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=557890,QUALITY=lowest,RESOLUTION=426x238',
    '/expires/1/type/0/video/',
    '#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=4139598,QUALITY=full,RESOLUTION=1920x1072',
    '/expires/1/type/5/video/',
    '#EXT-X-STREAM-INF:PROGRAM-ID=1,BANDWIDTH=2588314,CODECS="avc1.64002A,mp4a.40.2",RESOLUTION=1280x714',
    'hd/index.m3u8',
    '',
  ].join('\n');
  const v = VK.parseHlsMaster(master, 'https://cdn.example/a/b/master.m3u8');
  assert.deepEqual(
    v.map((x) => x.height),
    [1072, 714, 238],
  );
  assert.equal(v[0].url, 'https://cdn.example/expires/1/type/5/video/');
  assert.equal(v[1].url, 'https://cdn.example/a/b/hd/index.m3u8');
});

test('parseHlsMedia: segments, init map, encryption', () => {
  const ts = VK.parseHlsMedia('#EXTM3U\n#EXTINF:4,\nseg1.ts\n#EXTINF:4,\nseg2.ts\n#EXT-X-ENDLIST\n', 'https://c.example/x/list.m3u8');
  assert.deepEqual(ts.segments, ['https://c.example/x/seg1.ts', 'https://c.example/x/seg2.ts']);
  assert.equal(ts.init, null);
  assert.equal(ts.encrypted, false);

  const fmp4 = VK.parseHlsMedia('#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:4,\n1.m4s\n', 'https://c.example/x/');
  assert.equal(fmp4.init, 'https://c.example/x/init.mp4');

  const enc = VK.parseHlsMedia('#EXT-X-KEY:METHOD=AES-128,URI="k"\n#EXTINF:4,\n1.ts\n', 'https://c.example/');
  assert.equal(enc.encrypted, true);
});

test('sanitizeFilename / buildFilename', () => {
  assert.equal(VK.sanitizeFilename('a/b\\c:d*e?"f"<g>|h'), 'a b c d e f g h');
  assert.equal(VK.sanitizeFilename('  ...  '), 'video');
  assert.equal(VK.sanitizeFilename('CON'), '_CON');
  assert.equal(VK.sanitizeFilename('x'.repeat(300)).length, 120);
  assert.equal(
    VK.buildFilename({ title: 'Мой ролик: часть 1/2', oid: '-1', vid: '2' }, 1080, 'mp4'),
    'Мой ролик часть 1 2 [-1_2] 1080p.mp4',
  );
  assert.equal(VK.buildFilename({ title: '', oid: '5', vid: '6' }, 720, 'ts'), 'video5_6 [5_6] 720p.ts');
});

test('formatDuration / formatSize', () => {
  assert.equal(VK.formatDuration(542), '9:02');
  assert.equal(VK.formatDuration(3725), '1:02:05');
  assert.equal(VK.formatSize(93466862), '89 MB');
  assert.equal(VK.formatSize(5 * 1024 * 1024), '5.0 MB');
  assert.equal(VK.formatSize(0), '');
});
