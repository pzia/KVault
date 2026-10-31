import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

assert.match(worker, /const APP_RELEASE = "0\.9\.7"/);
assert.match(app, /const APP_VERSION = '0\.9\.7'/);
assert.match(sw, /kobo-vault-v097/);
assert.match(worker, /ReviewSummary\[ProductId\]\.AvgRating/);
assert.match(worker, /node\.OpinionCount/);
assert.match(worker, /node\.TotalRating/);
assert.match(worker, /const revisionId = String\(book\?\.revisionId/);
assert.match(worker, /extractReviewAggregate\(probe\.payload, productId\)/);
const reviewsPos = worker.indexOf('const reviewsTemplate');
const detailPos = worker.indexOf('const detailTemplate', reviewsPos);
assert.ok(reviewsPos >= 0 && detailPos > reviewsPos, 'reviews must be attempted before book detail');
console.log('ui-v054.test.mjs: OK');
