import assert from 'node:assert/strict';
import fs from 'node:fs';
import { extractCatalogBooks, v2CatalogItem } from '../src/worker.js';

const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const worker=fs.readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');
const sw=fs.readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
assert.equal(pkg.version,'0.9.8');

// Real Kobo catalog/search shape: ProductMetadata.Book may expose ImageId rather than CoverImageId/CoverImageUrl.
const payload={Items:[{ProductMetadata:{Book:{Title:'Example Catalog Book',RevisionId:'rev-image-id',ImageId:'img-example-kobo'}}}]};
const books=extractCatalogBooks(payload);
assert.equal(books.length,1);
assert.equal(books[0].coverImageId,'img-example-kobo');
assert.match(v2CatalogItem(books[0]).cover_url,/cdn\.kobo\.com\/book-images\/img-example-kobo\//);

// Direct ImageUrl variant is also preserved if Kobo sends it.
const direct=extractCatalogBooks({Products:[{Book:{Title:'Direct image',RevisionId:'rev-direct-image',ImageUrl:'//cdn.kobo.com/book-images/direct/image.jpg'}}]});
assert.equal(v2CatalogItem(direct[0]).cover_url,'https://cdn.kobo.com/book-images/direct/image.jpg');

assert.match(worker,/__v2_catalog_v3/);
assert.match(worker,/__internal-cache\/kobo-catalog-v3/);
assert.match(sw,/kobo-vault-v098/);
console.log('api-v0963.test.mjs: OK');
