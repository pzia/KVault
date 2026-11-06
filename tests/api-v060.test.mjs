import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeProjectionItem, projectionRowToApi, publicJob, sanitizeJobResult } from '../src/worker.js';

const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../migrations/0002_api_jobs.sql', import.meta.url), 'utf8');

assert.match(worker, /const APP_RELEASE = "0\.9\.8"/);
assert.match(app, /const APP_VERSION = '0\.9\.7'/);
assert.match(sw, /kobo-vault-v098/);

for (const table of ['account_projection','library_projection','api_tokens','agent_pairings','agents','jobs']) {
  assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
}
for (const route of [
  '/api/v1/status', '/api/v1/account', '/api/v1/search', '/api/v1/library/manifest',
  'download-jobs', '/api/v1/agent/pair/start', '/api/v1/agent/pair/complete',
  '/api/v1/agent/jobs/next', '/api/v1/agent/heartbeat'
]) assert.ok(worker.includes(route), `missing route ${route}`);

assert.match(worker, /capabilities: \["library", "library_search", "agent_export"\]/);
assert.doesNotMatch(worker, /capabilities: \[[^\]]*"catalog_search"/);
assert.match(worker, /catalog_search_requires_agent/);
assert.match(worker, /\/api\/v1\/agent\/pair\/start/);
assert.match(app, /async function publishProjection/);
assert.doesNotMatch(html, /Appairer kobo-adept/);
assert.match(html, /API fournisseur Kobo/);

const normalized = normalizeProjectionItem({
  productId:'prod-1', revisionId:'rev-1', title:'Titre', authors:['A','B'], mediaType:'ebook',
  downloadable:true, accessToken:'SECRET', refreshToken:'SECRET2'
});
assert.deepEqual(normalized, {
  productId:'prod-1', revisionId:'rev-1', isbn:'', title:'Titre', authors:['A','B'], language:'', publisher:'',
  publicationDate:'', description:'', coverUrl:'', productUrl:'', format:'EPUB', contentType:'ebook', downloadable:true, archived:false
});
assert.equal('accessToken' in normalized, false);

const apiRow = projectionRowToApi({
  product_id:'prod-1', revision_id:'rev-1', title:'Titre', authors_json:'["Auteur"]', publisher:'Pub',
  publication_date:'2026-01-01', description:'Desc', cover_url:'https://c', product_url:'https://p', format:'EPUB',
  content_type:'ebook', downloadable:1, isbn:'123', language:'fr', archived:0
});
assert.equal(apiRow.owned, true);
assert.equal(apiRow.downloadable, true);
assert.deepEqual(apiRow.authors, ['Auteur']);
assert.equal(apiRow.price, null);

const result = sanitizeJobResult({ filename:'/home/user/Books/Livre.epub', size:123, sha256:'A'.repeat(64), hook:{status:'success',exit_code:0}, accessToken:'DO_NOT_KEEP' });
assert.deepEqual(result, { filename:'Livre.epub', size:123, sha256:'a'.repeat(64), storage:'local-agent', hook:{status:'success',exit_code:0} });
assert.equal('accessToken' in result, false);

const job = publicJob({
  id:'job_x', type:'DOWNLOAD_KOBO_BOOK', product_id:'prod-1', revision_id:'rev-1', format:'epub', status:'complete',
  created_at:'2026-01-01T00:00:00Z', started_at:null, completed_at:'2026-01-01T00:01:00Z',
  result_json:JSON.stringify(result), error_code:null, error_message:null
});
assert.equal(job.status, 'complete');
assert.equal(job.result.storage, 'local-agent');

console.log('api-v060.test.mjs: OK');
