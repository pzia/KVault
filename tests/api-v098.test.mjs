import assert from 'node:assert/strict';
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

assert.equal(pkg.version, '0.9.8');
assert.match(worker, /kobo\.library\.refresh/);
assert.match(worker, /contract_revision:"2\.3\.4"/);
assert.match(worker, /\/api\/v2\/library\/refresh/);
assert.match(worker, /strictOptionalBooleanQuery\(url, "refresh"\)/);
assert.match(worker, /__v2_catalog_v4/);
assert.match(worker, /cache_status:cacheStatus/);
assert.match(html, /id="apiTokenLibraryRefresh"[^>]*checked/);
assert.match(app, /kobo\.library\.refresh/);
// Server defaults remain least-privilege: refresh and delegation are opt-in.
assert.match(worker, /API_V2_DEFAULT_SCOPES = \["kobo\.catalog\.read", "kobo\.library\.read", "kobo\.acquisition\.read"\]/);

console.log('api-v098.test.mjs: OK');
