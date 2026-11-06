import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildKoboAcsmLookupAttempts,
  extractAcsmUrls,
  normalizeAcquisitionCandidates
} from '../src/worker.js';

const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
const openapi = fs.readFileSync(new URL('../interfaces/kobo-vault-openapi-v2.3.yaml', import.meta.url), 'utf8');
const schema = JSON.parse(fs.readFileSync(new URL('../interfaces/kobo-vault-acquisition.schema.json', import.meta.url), 'utf8'));

assert.match(worker, /APP_RELEASE = "0\.9\.8"/);
assert.ok(worker.includes('api_version:"2.3"'));
assert.ok(openapi.includes('version: 2.3.0'));
assert.equal(schema.properties.schema_version.const, '1.4');

const urls = extractAcsmUrls({
  Link:'https://acs4.kobo.com/fulfillment/URLLink.acsm?token=one&amp;x=2',
  nested:{ ignored:'https://cdn.kobo.com/book.epub', other:'prefix https://acs4.kobo.com/fulfillment/URLLink.acsm?token=two suffix' }
});
assert.equal(urls.length,2);
assert.ok(urls.every(x => x.includes('URLLink.acsm')));
assert.ok(urls[0].includes('&x=2'));

const attempts = buildKoboAcsmLookupAttempts('https://storeapi.kobo.com/v1/library/downloadlink','rev-1','prod-1');
assert.equal(attempts.length,3);
assert.equal(attempts[0].method,'GET');
assert.equal(new URL(attempts[0].url).searchParams.get('RevisionId'),'rev-1');
assert.equal(new URL(attempts[1].url).searchParams.get('ProductId'),'prod-1');
assert.equal(attempts[2].method,'POST');
assert.deepEqual(attempts[2].body,{RevisionId:'rev-1',ProductId:'prod-1'});
assert.deepEqual(buildKoboAcsmLookupAttempts('https://evil.invalid/x','rev-1','prod-1'),[]);

const candidates = normalizeAcquisitionCandidates({ContentUrls:[
  {DRMType:'AdobeDrm',UrlFormat:'EPUB3',DownloadUrl:'https://cdn.kobo.com/adobe.epub'}
]},'Desktop');
assert.equal(candidates[0].kobo.source,'content_access_book');
assert.equal(candidates[0].kobo.requires_kobo_authorization,true);
assert.equal(candidates[0].headers['x-amz-request-payer'],'requester');

console.log('api-v091.test.mjs: OK');
