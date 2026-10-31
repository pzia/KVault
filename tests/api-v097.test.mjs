import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeLibrarySyncCandidates } from '../src/worker.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');

assert.equal(pkg.version, '0.9.7');

// Real library_sync shape: FLEPUB/KDRM is a full EPUB-family artifact, not unknown.
// Duplicate entitlement recipes with different temporary tokens collapse semantically.
const events = [
  {NewEntitlement:{BookMetadata:{CrossRevisionId:'prod',RevisionId:'rev',DownloadUrls:[
    {DrmType:'KDRM',Format:'FLEPUB',Url:'https://storedownloads.kobo.com/download?downloadToken=one',Platform:'Android'},
    {DrmType:'None',Format:'EPUB3FL_SAMPLE',Url:'https://storedownloads.kobo.com/download?downloadToken=sample',Platform:'Generic'}
  ]}}},
  {NewEntitlement:{BookMetadata:{CrossRevisionId:'prod',RevisionId:'rev',DownloadUrls:[
    {DrmType:'KDRM',Format:'FLEPUB',Url:'https://storedownloads.kobo.com/download?downloadToken=two',Platform:'Android'}
  ]}}}
];
const candidates = normalizeLibrarySyncCandidates(events, ['prod','rev'], {ContentKeys:[{Name:'OEBPS/a.xhtml',Value:'secret'}]}, 'Desktop');
assert.equal(candidates.length, 1);
assert.equal(candidates[0].media_format, 'epub');
assert.equal(candidates[0].source_format, 'FLEPUB');
assert.equal(candidates[0].handling, 'kobo_kdrm');
assert.equal(candidates[0].kobo.source, 'library_sync');
assert.equal(candidates[0].kobo.display_profile, null);
assert.equal(candidates[0].kobo.platform, 'Android');
assert.equal(candidates[0].kobo.content_keys_present, true);
assert.ok(!JSON.stringify(candidates).includes('sample'));

// Paris preset: sensitive scope is explicit, visible and selected by default.
assert.match(html, /id="apiTokenDelegate"[^>]*type="checkbox"[^>]*checked|id="apiTokenDelegate"[^>]*checked[^>]*type="checkbox"/);
assert.match(html, /requis pour que Paris puisse confier un livre Kobo KDRM à Kobo-Adept/);
assert.match(app, /kobo\.acquisition\.delegate/);
assert.match(app, /KDRM délégué indisponible/);
// Generic server-side token defaults remain least-privilege.
assert.match(worker, /API_V2_DEFAULT_SCOPES = \["kobo\.catalog\.read", "kobo\.library\.read", "kobo\.acquisition\.read"\]/);

console.log('api-v097.test.mjs: OK');
