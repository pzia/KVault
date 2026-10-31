import assert from 'node:assert/strict';
import fs from 'node:fs';
import { collectLibrarySyncSignals, redactSyncNode, candidateUrlsFromSyncEvent, formatFromHeadersOrUrl } from '../src/worker.js';

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const workerSource = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
const openapi = fs.readFileSync(new URL('../interfaces/kobo-vault-openapi-v2.3.2.yaml', import.meta.url), 'utf8');

assert.equal(pkg.version, '0.9.7');
assert.match(workerSource, /APP_RELEASE = "0\.9\.7"/);
assert.match(workerSource, /diagnostics\\\/library-sync/);
assert.match(openapi, /version: 2\.3\.2/); // diagnostic route is internal; Provider contract intentionally unchanged.

const event = {
  NewEntitlement: {
    BookEntitlement: { Id:'ent-1', Accessibility:'Full' },
    BookMetadata: {
      ProductId:'11111111-1111-4111-8111-111111111111',
      RevisionId:'rev-1',
      CoverUrl:'https://cdn.kobo.com/cover.jpg?token=secret',
      DownloadUrls:[{
        Platform:'Generic',
        DRMType:'KDRM',
        UrlFormat:'KEPUB',
        DownloadUrl:'https://storedownloads.kobo.com/file.kepub?X-Amz-Signature=abc&X-Amz-Expires=600'
      }],
      ContentKeys:[{ Name:'chapter1', Value:'this-is-a-secret-content-key-value' }]
    }
  }
};

const signals = collectLibrarySyncSignals(event);
assert.ok(signals.some(x => x.path.includes('DownloadUrls')));
assert.ok(signals.some(x => x.path.endsWith('.UrlFormat') && x.value === 'KEPUB'));
assert.ok(signals.some(x => x.url?.host === 'storedownloads.kobo.com'));
assert.ok(signals.every(x => x.value !== 'this-is-a-secret-content-key-value'));

const redacted = redactSyncNode(event);
assert.equal(redacted.NewEntitlement.BookMetadata.ContentKeys[0].Value, '[REDACTED]');
assert.match(redacted.NewEntitlement.BookMetadata.DownloadUrls[0].DownloadUrl, /X-Amz-Signature=%5BREDACTED%5D/);
assert.doesNotMatch(JSON.stringify(redacted), /this-is-a-secret-content-key-value|X-Amz-Signature=abc/);

const candidates = candidateUrlsFromSyncEvent(event);
assert.equal(candidates.length, 1); // CoverUrl is diagnostic metadata, not an acquisition recipe.
assert.equal(candidates[0].host, 'storedownloads.kobo.com');
assert.equal(candidates[0].signed_or_tokenized, true);
assert.equal(candidates[0].expiry_signal, true);

assert.equal(formatFromHeadersOrUrl('application/epub+zip', '', 'https://example/book'), 'EPUB');
assert.equal(formatFromHeadersOrUrl('application/pdf', '', 'https://example/book'), 'PDF');
assert.equal(formatFromHeadersOrUrl('', '', 'https://example/book.kepub'), 'KEPUB');
assert.equal(formatFromHeadersOrUrl('application/octet-stream', '', 'https://example/blob'), 'unknown');

console.log('api-v095.test.mjs: OK');
