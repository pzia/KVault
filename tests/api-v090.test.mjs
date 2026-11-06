import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeAcquisitionCandidates } from '../src/worker.js';

const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
const openapi = fs.readFileSync(new URL('../interfaces/kobo-vault-openapi-v2.2.yaml', import.meta.url), 'utf8');
const schema = JSON.parse(fs.readFileSync(new URL('../interfaces/kobo-vault-acquisition-v1.2.schema.json', import.meta.url), 'utf8'));

assert.match(worker, /APP_RELEASE = "0\.9\.8"/);
assert.ok(worker.includes('api_version:"2.3"'));
assert.ok(openapi.includes('version: 2.2.0'));
assert.ok(openapi.includes('display_profile'));
assert.equal(schema.properties.schema_version.const, '1.2');

const payload = {
  ContentKeys:[
    {Name:'chapter-1',Value:'MUST_NOT_LEAK_1'},
    {Name:'chapter-2',Value:'MUST_NOT_LEAK_2'}
  ],
  ContentUrls:[
    {DRMType:'SignedNoDrm',UrlFormat:'EPUB3',DownloadUrl:'https://cdn.kobo.com/plain.epub?b=drop&x=1'},
    {DRMType:'KDRM',UrlFormat:'KEPUB',DownloadUrl:'https://cdn.kobo.com/book.kepub?x=2'},
    {DRMType:'AdobeDrm',UrlFormat:'EPUB3',DownloadUrl:'https://cdn.kobo.com/adobe.epub?x=3'}
  ]
};
const candidates = normalizeAcquisitionCandidates(payload, 'Android');
assert.equal(candidates.length,3);
assert.equal(candidates[0].media_format,'epub');
assert.equal(candidates[0].drm.family,'none');
assert.equal(candidates[0].handling,'http_plain');
assert.equal(candidates[1].media_format,'kepub');
assert.equal(candidates[1].drm.family,'kobo_kdrm');
assert.equal(candidates[1].handling,'kobo_kdrm');
assert.equal(candidates[2].drm.family,'adobe_adept');
assert.equal(candidates[2].handling,'adobe_adept');
assert.equal(candidates[1].kobo.display_profile,'Android');
assert.equal(candidates[1].kobo.content_keys_present,true);
assert.equal(candidates[1].kobo.content_key_count,2);
assert.equal(JSON.stringify(candidates).includes('MUST_NOT_LEAK'),false);
assert.ok(!candidates[0].url.includes('b='));

console.log('api-v090.test.mjs: OK');
