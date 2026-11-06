import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeAcquisitionCandidates } from '../src/worker.js';

const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../migrations/0003_provider_api_v2.sql', import.meta.url), 'utf8');
const openapi = fs.readFileSync(new URL('../interfaces/kobo-vault-openapi-v2.yaml', import.meta.url), 'utf8');

assert.match(worker, /const APP_RELEASE = "0\.9\.8"/);
assert.match(app, /const APP_VERSION = '0\.9\.7'/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS kobo_api_credentials/);
assert.match(migration, /ciphertext TEXT NOT NULL/);

for (const route of [
  '/api/v2/status', '/api/v2/account', '/api/v2/catalog/search', '/api/v2/library/manifest',
  '/acquisition'
]) assert.ok(worker.includes(route), `missing v2 route ${route}`);

for (const scope of ['kobo.catalog.read','kobo.library.read','kobo.acquisition.read']) {
  assert.ok(worker.includes(scope), `missing scope ${scope}`);
  assert.ok(openapi.includes(scope), `OpenAPI missing scope ${scope}`);
}

assert.match(html, /API fournisseur Kobo/);
assert.match(html, /Activer l’accès Provider Kobo/);
assert.doesNotMatch(html, /Derniers jobs/);
assert.doesNotMatch(html, /Code d’appairage/);
assert.match(app, /async function publishAcquisitionAccess/);
assert.match(app, /async function createConsumerApiToken/);

const candidates = normalizeAcquisitionCandidates({
  ContentKeys:[{Name:'secret-name',Value:'DO_NOT_EXPOSE'}],
  ContentUrls:[
    { DRMType:'SignedNoDrm', UrlFormat:'EPUB3', DownloadUrl:'https://cdn.kobo.com/book.epub?b=forbidden&x=1' },
    { DRMType:'KDRM', UrlFormat:'KEPUB', DownloadUrl:'https://cdn.kobo.com/book.kepub?x=2' },
    { DRMType:'KDRM', UrlFormat:'KEPUB', DownloadUrl:'http://insecure.example/book' }
  ]
});
assert.equal(candidates.length, 2);
assert.equal(candidates[0].protected, false);
assert.equal(candidates[1].protected, true);
assert.ok(!candidates[0].url.includes('b='));
assert.equal(JSON.stringify(candidates).includes('DO_NOT_EXPOSE'), false);
assert.equal(JSON.stringify(candidates).includes('ContentKeys'), false);

console.log('api-v070.test.mjs: OK');
