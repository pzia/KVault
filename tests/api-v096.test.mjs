import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeLibrarySyncCandidates } from '../src/worker.js';

const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
const schema=JSON.parse(fs.readFileSync(new URL('../interfaces/kobo-vault-acquisition.schema.json',import.meta.url),'utf8'));
const openapi=fs.readFileSync(new URL('../interfaces/kobo-vault-openapi-v2.3.3.yaml',import.meta.url),'utf8');
assert.equal(pkg.version,'0.9.7');
assert.equal(schema.properties.schema_version.const,'1.4');
assert.ok(schema.properties.acquisition.properties.candidates.items.properties.kobo.properties.source.enum.includes('library_sync'));
assert.match(openapi,/version: 2\.3\.3/);
const events=[{NewEntitlement:{BookMetadata:{CrossRevisionId:'prod',RevisionId:'rev',DownloadUrls:[
 {DrmType:'KDRM',Format:'FLEPUB',Url:'https://storedownloads.kobo.com/download?downloadToken=x',Platform:'Android'},
 {DrmType:'None',Format:'EPUB3FL_SAMPLE',Url:'https://storedownloads.kobo.com/sample?downloadToken=y',Platform:'Generic'}
]}}}];
const c=normalizeLibrarySyncCandidates(events,['prod','rev'],{ContentKeys:[{Name:'x',Value:'secret'}]},'Android');
assert.equal(c.length,1);
assert.equal(c[0].handling,'kobo_kdrm');
assert.equal(c[0].source_format,'FLEPUB');
assert.equal(c[0].kobo.source,'library_sync');
assert.equal(c[0].kobo.platform,'Android');
assert.equal(c[0].kobo.content_keys_present,true);
assert.equal(c[0].kobo.content_key_count,1);
assert.equal(c[0].headers['x-amz-request-payer'],'requester');
console.log('api-v096.test.mjs: OK');
