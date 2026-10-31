import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/worker.js';

class Statement {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new Statement(this.db, this.sql, args); }
  async first() { return this.db.prepare(this.sql).get(...this.args) ?? null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.args) }; }
  async run() { const r = this.db.prepare(this.sql).run(...this.args); return { success:true, meta:{ changes:Number(r.changes || 0) } }; }
}
class D1 {
  constructor() { this.db = new DatabaseSync(':memory:'); }
  prepare(sql) { return new Statement(this.db, sql); }
  async batch(statements) {
    this.db.exec('BEGIN');
    try { const out=[]; for (const s of statements) out.push(await s.run()); this.db.exec('COMMIT'); return out; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  exec(sql) { this.db.exec(sql); }
}

const d1 = new D1();
for (const file of ['0001_init.sql','0002_api_jobs.sql','0003_provider_api_v2.sql','0004_library_sync_state.sql']) {
  d1.exec(fs.readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
}
const env = {
  KOBO_VAULT:d1,
  APP_VERSION:'0.9.7',
  KOBO_APP_VERSION:'4.44.23552',
  KOBO_API_CREDENTIAL_KEY:'test-secret-key-which-is-at-least-thirty-two-bytes-long',
  ASSETS:{ fetch:()=>new Response('unused') }
};
const ctx = { waitUntil(){} };
const base = 'https://vault.example';
async function sha(text) {
  const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function call(path,{method='GET',headers={},body}={}) {
  const h=new Headers(headers); if(body!==undefined) h.set('Content-Type','application/json');
  const res=await worker.fetch(new Request(base+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)}),env,ctx);
  const text=await res.text(); return {res,data:text?JSON.parse(text):null};
}

const uid='4'.repeat(64);
const secret='vault-secret-0964-with-enough-entropy';
const now=new Date();
await d1.prepare('INSERT INTO vaults(uid_hash,salt,auth_hash,version,chunk_count,byte_length,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
  .bind(uid,'ABCDEFGHIJKLMNOPQRSTUV',await sha(secret),1,0,0,now.toISOString(),now.toISOString()).run();
const vaultHeaders={'X-Vault-Auth':secret};
const oldSync=new Date(Date.now()-48*60*60*1000).toISOString();
let r=await call(`/api/v2/vault/${uid}/projection`,{method:'PUT',headers:vaultHeaders,body:{
  account:{id:'acct',display_name:'Kobo'},
  source_sync_at:oldSync,
  items:[{product_id:'old-prod',revision_id:'old-rev',title:'Ancienne projection',authors:['Auteur'],format:'EPUB',content_type:'ebook',downloadable:true,archived:false}]
}});
assert.equal(r.res.status,200);
let state=await d1.prepare('SELECT * FROM library_sync_state WHERE uid_hash=?').bind(uid).first();
assert.equal(state.last_success_at,oldSync);

r=await call(`/api/v2/vault/${uid}/api-tokens`,{method:'POST',headers:vaultHeaders,body:{label:'Paris',scopes:['kobo.library.read']}});
assert.equal(r.res.status,201);
const apiHeaders={Authorization:`Bearer ${r.data.token.value}`};
await call(`/api/v2/vault/${uid}/acquisition-access`,{method:'PUT',headers:vaultHeaders,body:{
  accessToken:'ACCESS_0964',refreshToken:'REFRESH_0964',appVersion:'4.44.23552',userId:'user-0964',deviceId:'device',serialNumber:'serial'
}});

let mode='ok';
let initCalls=0, syncCalls=0;
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input)=>{
  const u=input instanceof URL?input:new URL(typeof input==='string'?input:input.url);
  if(u.pathname==='/v1/initialization') {
    initCalls++;
    if(mode==='fail') return new Response('unauthorized',{status:401});
    return new Response(JSON.stringify({Resources:{library_sync:'https://storeapi.kobo.com/v1/library/sync'}}),{status:200,headers:{'Content-Type':'application/json'}});
  }
  if(u.pathname==='/v1/auth/refresh') return new Response('unauthorized',{status:401});
  if(u.pathname==='/v1/library/sync') {
    syncCalls++;
    return new Response(JSON.stringify([{NewEntitlement:{
      BookEntitlement:{Accessibility:'Full',IsRemoved:false},
      BookMetadata:{Title:'Projection fraîche',ProductId:'fresh-prod',RevisionId:'fresh-rev',Contributors:['Auteur frais'],CoverImageUrl:'//cdn.kobo.com/book-images/fresh/image.jpg'}
    }}]),{status:200,headers:{'Content-Type':'application/json'}});
  }
  throw new Error(`unexpected fetch ${u}`);
};

try {
  // First page of the Provider manifest is stale: it refreshes Kobo synchronously.
  r=await call('/api/v2/library/manifest?limit=200',{headers:apiHeaders});
  assert.equal(r.res.status,200);
  assert.deepEqual(r.data.items.map(x=>x.product_id),['fresh-prod']);
  assert.equal(r.data.items[0].cover_url,'https://cdn.kobo.com/book-images/fresh/image.jpg');
  assert.equal(initCalls,1);
  assert.equal(syncCalls,1);
  const oldRow=await d1.prepare('SELECT product_id FROM library_projection WHERE uid_hash=? AND product_id=?').bind(uid,'old-prod').first();
  assert.equal(oldRow,null);
  state=await d1.prepare('SELECT * FROM library_sync_state WHERE uid_hash=?').bind(uid).first();
  assert.ok(Date.parse(state.last_success_at) > Date.now()-60_000);
  assert.equal(state.last_error,null);
  assert.equal(state.refresh_started_at,null);

  // A second call inside 24h serves D1 and does not contact Kobo.
  r=await call('/api/v2/library/manifest?limit=200',{headers:apiHeaders});
  assert.equal(r.res.status,200);
  assert.equal(initCalls,1);
  assert.equal(syncCalls,1);

  // A browser publishing an older local snapshot moves freshness backward, so the Provider repairs it on next use.
  r=await call(`/api/v2/vault/${uid}/projection`,{method:'PUT',headers:vaultHeaders,body:{
    account:{id:'acct',display_name:'Kobo'}, source_sync_at:oldSync,
    items:[{product_id:'stale-browser',revision_id:'stale-browser-rev',title:'Snapshot navigateur ancien',authors:['Auteur'],format:'EPUB',content_type:'ebook',downloadable:true,archived:false}]
  }});
  assert.equal(r.res.status,200);
  state=await d1.prepare('SELECT * FROM library_sync_state WHERE uid_hash=?').bind(uid).first();
  assert.equal(state.last_success_at,oldSync);
  r=await call('/api/v2/library/manifest?limit=200',{headers:apiHeaders});
  assert.equal(r.res.status,200);
  assert.equal(r.data.items[0].product_id,'fresh-prod');
  assert.equal(initCalls,2);
  assert.equal(syncCalls,2);

  // Pagination never starts a refresh mid-manifest, even if the state is stale.
  await d1.prepare('UPDATE library_sync_state SET last_success_at=?, last_attempt_at=NULL, last_error=NULL, refresh_started_at=NULL WHERE uid_hash=?').bind(oldSync,uid).run();
  const cursor=Buffer.from(JSON.stringify({o:1})).toString('base64url');
  r=await call(`/api/v2/library/manifest?limit=1&cursor=${cursor}`,{headers:apiHeaders});
  assert.equal(r.res.status,200);
  assert.equal(initCalls,2);

  // If another Paris instance already owns the refresh lock, serve the current projection.
  await d1.prepare('UPDATE library_sync_state SET refresh_started_at=?, last_attempt_at=? WHERE uid_hash=?').bind(new Date().toISOString(),new Date().toISOString(),uid).run();
  r=await call('/api/v2/library/manifest?limit=200',{headers:apiHeaders});
  assert.equal(r.res.status,200);
  assert.equal(r.data.items[0].product_id,'fresh-prod');
  assert.equal(initCalls,2);

  // On Kobo failure, keep serving the last projection and back off subsequent calls.
  await d1.prepare('UPDATE library_sync_state SET refresh_started_at=NULL, last_attempt_at=NULL, last_error=NULL, last_success_at=? WHERE uid_hash=?').bind(oldSync,uid).run();
  mode='fail';
  r=await call('/api/v2/library/manifest?limit=200',{headers:apiHeaders});
  assert.equal(r.res.status,200);
  assert.equal(r.data.items[0].product_id,'fresh-prod');
  assert.equal(initCalls,3);
  state=await d1.prepare('SELECT * FROM library_sync_state WHERE uid_hash=?').bind(uid).first();
  assert.match(state.last_error,/kobo_refresh_failed/);
  assert.equal(state.refresh_started_at,null);

  r=await call('/api/v2/library/manifest?limit=200',{headers:apiHeaders});
  assert.equal(r.res.status,200);
  assert.equal(initCalls,3,'15-minute failure backoff prevents an API request storm');
} finally {
  globalThis.fetch=originalFetch;
}

console.log('api-v0964-integration.test.mjs: OK');
