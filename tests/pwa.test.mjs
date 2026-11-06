import assert from 'node:assert/strict';
import fs from 'node:fs';
const manifest = JSON.parse(fs.readFileSync('public/manifest.webmanifest','utf8'));
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.scope, '/');
assert.equal(manifest.start_url, '/');
const sizes = new Set(manifest.icons.flatMap(i => String(i.sizes || '').split(/\s+/)));
assert.equal(sizes.has('192x192'), true);
assert.equal(sizes.has('512x512'), true);
for (const icon of manifest.icons) assert.equal(fs.existsSync(`public${icon.src}`), true, `missing ${icon.src}`);
function pngSize(path){const b=fs.readFileSync(path);assert.equal(b.toString('ascii',1,4),'PNG');return[b.readUInt32BE(16),b.readUInt32BE(20)]}
assert.deepEqual(pngSize('public/icons/icon-192.png'), [192,192]);
assert.deepEqual(pngSize('public/icons/icon-512.png'), [512,512]);
const sw = fs.readFileSync('public/sw.js','utf8');
assert.match(sw, /kobo-vault-v098/);
assert.match(sw, /manifest\.webmanifest/);
assert.match(sw, /NETWORK_FIRST/);
assert.match(sw, /cache: "no-store"/);
console.log('pwa.test.mjs: OK');
