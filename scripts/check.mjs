// Static checks for the extension: manifest refs exist, locales agree,
// versions are in sync. Zero dependencies — runs in CI and locally.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ext = join(root, 'extension');
const errors = [];
const read = (p) => readFileSync(p, 'utf8');

const manifest = JSON.parse(read(join(ext, 'manifest.json')));
const pkg = JSON.parse(read(join(root, 'package.json')));

if (manifest.manifest_version !== 3) errors.push('manifest_version must be 3');
if (manifest.version !== pkg.version) errors.push(`version mismatch: manifest ${manifest.version} vs package.json ${pkg.version}`);

const files = [
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {}),
  manifest.action?.default_popup,
  ...(manifest.content_scripts || []).flatMap((c) => c.js || []),
].filter(Boolean);
for (const f of files) if (!existsSync(join(ext, f))) errors.push(`missing file referenced by manifest: ${f}`);

// every <script src> / <link href> in the popup must resolve
const popupPath = join(ext, manifest.action.default_popup);
const popupDir = dirname(popupPath);
for (const m of read(popupPath).matchAll(/(?:src|href)="([^"#:]+)"/g)) {
  if (!existsSync(join(popupDir, m[1]))) errors.push(`popup references missing ${m[1]}`);
}

// locales: same keys everywhere, every __MSG_x__ and t('x') defined
const locales = readdirSync(join(ext, '_locales'));
const keys = Object.fromEntries(locales.map((l) => [l, new Set(Object.keys(JSON.parse(read(join(ext, '_locales', l, 'messages.json')))))]));
const base = keys[manifest.default_locale];
if (!base) errors.push(`default_locale ${manifest.default_locale} has no messages.json`);
for (const [l, set] of Object.entries(keys)) {
  for (const k of base) if (!set.has(k)) errors.push(`_locales/${l} is missing "${k}"`);
  for (const k of set) if (!base.has(k)) errors.push(`_locales/${l} has extra "${k}"`);
}
const used = new Set();
for (const m of read(join(ext, 'manifest.json')).matchAll(/__MSG_(\w+)__/g)) used.add(m[1]);
for (const f of ['content.js', 'popup/popup.js', 'popup/popup.html']) {
  const src = read(join(ext, f));
  for (const m of src.matchAll(/\bt\('(\w+)'/g)) used.add(m[1]);
  for (const m of src.matchAll(/data-i18n="(\w+)"/g)) used.add(m[1]);
}
for (const k of used) if (!base.has(k)) errors.push(`message "${k}" is used but not defined`);

if (errors.length) {
  console.error(errors.map((e) => '✖ ' + e).join('\n'));
  process.exit(1);
}
console.log(`✔ manifest v${manifest.version}: ${files.length} files, ${locales.length} locales, ${used.size} messages`);
