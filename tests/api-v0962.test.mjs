import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeLibraryEvents, extractCatalogBooks, normalizeCoverUrl, coverUrlForBook, v2CatalogItem } from '../src/worker.js';

const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const worker=fs.readFileSync(new URL('../src/worker.js',import.meta.url),'utf8');
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const sw=fs.readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');

assert.equal(pkg.version,'0.9.8');
assert.equal(normalizeCoverUrl('//cdn.kobo.com/book-images/x/0/0/False/foo.jpg'),'https://cdn.kobo.com/book-images/x/0/0/False/foo.jpg');
assert.equal(normalizeCoverUrl('javascript:alert(1)'),'');

const sync = normalizeLibraryEvents([{NewEntitlement:{
  BookEntitlement:{Accessibility:'Full'},
  BookMetadata:{Title:'Cover direct',RevisionId:'rev-cover',CoverImageUrl:'//cdn.kobo.com/book-images/direct/0/0/False/book.jpg'}
}}]);
assert.equal(sync.length,1);
assert.equal(sync[0].coverUrl,'https://cdn.kobo.com/book-images/direct/0/0/False/book.jpg');
assert.equal(coverUrlForBook(sync[0]),'https://cdn.kobo.com/book-images/direct/0/0/False/book.jpg');

const fallback = coverUrlForBook({coverImageId:'cover id'});
assert.match(fallback,/https:\/\/cdn\.kobo\.com\/book-images\/cover%20id\/300\/450\/90\/false\/image\.jpg/);

const catalog = extractCatalogBooks({Products:[{Book:{Title:'Catalogue cover',RevisionId:'rev-cat',CoverImageUrl:'https://cdn.kobo.com/book-images/catalog/0/0/False/book.jpg'}}]});
assert.equal(catalog[0].coverUrl,'https://cdn.kobo.com/book-images/catalog/0/0/False/book.jpg');
assert.equal(v2CatalogItem(catalog[0]).cover_url,'https://cdn.kobo.com/book-images/catalog/0/0/False/book.jpg');
assert.match(v2CatalogItem({title:'Fallback',mediaType:'ebook',coverImageId:'fallback-id'}).cover_url,/fallback-id/);

assert.match(worker,/__v2_catalog_v3/);
assert.match(worker,/__internal-cache\/kobo-catalog-v3/);
assert.match(app,/book\?\.coverUrl/);
assert.match(app,/projectionCoverUrl\(book\)/);
assert.match(sw,/kobo-vault-v098/);
console.log('api-v0962.test.mjs: OK');
