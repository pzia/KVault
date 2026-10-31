import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeAcquisitionCandidates } from '../src/worker.js';

const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
const openapi = fs.readFileSync(new URL('../interfaces/kobo-vault-openapi-v2.3.1.yaml', import.meta.url), 'utf8');

assert.match(worker, /APP_RELEASE = "0\.9\.7"/);
assert.ok(worker.includes('api_version:"2.3"'));
assert.ok(openapi.includes('version: 2.3.1'));

const candidates = normalizeAcquisitionCandidates({
  ContentKeys:[{Name:'key-a',Value:'secret'}],
  ContentUrls:[
    {
      DrmType:'KDRM',
      UrlFormat:'KEPUB',
      Url:'https://storedownloads.kobo.com/content/book.kepub?b=drop-me&sig=keep-me'
    },
    {
      DRMType:'SignedNoDrm',
      Format:'EPUB3',
      DownloadUrl:'https://downloads.example.test/plain.epub'
    }
  ],
  DownloadUrls:[
    {
      DRMType:'AdobeDrm',
      UrlFormat:'EPUB3',
      Url:'https://cdn.kobo.com/content/adobe.epub'
    },
    // Exact duplicate from another upstream container must not be duplicated.
    {
      DRMType:'KDRM',
      UrlFormat:'KEPUB',
      DownloadUrl:'https://storedownloads.kobo.com/content/book.kepub?b=drop-me&sig=keep-me'
    }
  ]
}, 'Android');

assert.equal(candidates.length, 3);

const kdrm = candidates.find(x => x.handling === 'kobo_kdrm');
assert.ok(kdrm);
assert.equal(kdrm.media_format, 'kepub');
assert.equal(new URL(kdrm.url).searchParams.has('b'), false);
assert.equal(new URL(kdrm.url).searchParams.get('sig'), 'keep-me');
assert.equal(kdrm.headers['x-amz-request-payer'], 'requester');
assert.equal(kdrm.kobo.requires_kobo_authorization, true);
assert.equal(kdrm.kobo.content_keys_present, true);
assert.equal(kdrm.kobo.content_key_count, 1);

const plain = candidates.find(x => x.handling === 'http_plain');
assert.ok(plain);
assert.equal(plain.kobo.requires_kobo_authorization, false);
assert.equal(plain.headers['x-amz-request-payer'], 'requester');

const adobe = candidates.find(x => x.handling === 'adobe_adept');
assert.ok(adobe);
assert.equal(adobe.kobo.requires_kobo_authorization, true);
assert.equal(adobe.headers['x-amz-request-payer'], 'requester');

const s3 = normalizeAcquisitionCandidates({DownloadUrls:[
  {DRMType:'SignedNoDrm',UrlFormat:'EPUB3',Url:'https://bucket.s3.amazonaws.com/book.epub?b=must-stay&X-Amz-Signature=signed'}
]})[0];
assert.ok(s3);
assert.equal(new URL(s3.url).searchParams.get('b'),'must-stay');
assert.equal(s3.kobo.requires_kobo_authorization,false);
assert.equal(s3.headers['x-amz-request-payer'],'requester');

console.log('api-v092.test.mjs: OK');
