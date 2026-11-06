import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/worker.js';

class S {
  constructor(db, sql, args=[]) { this.db=db; this.sql=sql; this.args=args; }
  bind(...args) { return new S(this.db,this.sql,args); }
  async first() { return this.db.prepare(this.sql).get(...this.args) ?? null; }
  async all() { return {results:this.db.prepare(this.sql).all(...this.args)}; }
  async run() { const r=this.db.prepare(this.sql).run(...this.args); return {success:true,meta:{changes:Number(r.changes||0)}}; }
}
class D {
  constructor(){this.db=new DatabaseSync(':memory:');}
  prepare(sql){return new S(this.db,sql);}
  async batch(stmts){this.db.exec('BEGIN');try{const out=[];for(const s of stmts)out.push(await s.run());this.db.exec('COMMIT');return out;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  exec(sql){this.db.exec(sql);}
}
async function sha(text){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');}

const d1=new D();
for(const file of ['0001_init.sql','0002_api_jobs.sql','0003_provider_api_v2.sql','0004_library_sync_state.sql']) {
  d1.exec(fs.readFileSync(new URL(`../migrations/${file}`, import.meta.url),'utf8'));
}
const env={
  KOBO_VAULT:d1, APP_VERSION:'0.9.8', KOBO_APP_VERSION:'4.44.23552',
  KOBO_API_CREDENTIAL_KEY:'test-secret-key-which-is-at-least-thirty-two-bytes-long',
  ASSETS:{fetch:()=>new Response('unused')}, CATALOG_CACHE_TTL_SECONDS:'86400'
};
const ctx={waitUntil(){}};
const base='https://vault.example';
async function call(path,{method='GET',headers={},body}={}){
  const h=new Headers(headers); if(body!==undefined)h.set('Content-Type','application/json');
  const res=await worker.fetch(new Request(base+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)}),env,ctx);
  const text=await res.text(); return {res,data:text?JSON.parse(text):null};
}

const uid='8'.repeat(64), secret='vault-secret-098-with-enough-entropy';
const now=new Date().toISOString();
await d1.prepare('INSERT INTO vaults(uid_hash,salt,auth_hash,version,chunk_count,byte_length,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
  .bind(uid,'ABCDEFGHIJKLMNOPQRSTUV',await sha(secret),1,0,0,now,now).run();
const vaultHeaders={'X-Vault-Auth':secret};
await call(`/api/v2/vault/${uid}/projection`,{method:'PUT',headers:vaultHeaders,body:{
  account:{id:'acct',display_name:'Kobo'},
  source_sync_at:new Date(Date.now()-2*86400000).toISOString(),
  items:[{product_id:'owned',revision_id:'owned-r',title:'Owned',authors:['A'],downloadable:true,archived:false}]
}});

let r=await call(`/api/v2/vault/${uid}/api-tokens`,{method:'POST',headers:vaultHeaders,body:{
  label:'legacy',scopes:['kobo.catalog.read','kobo.library.read']
}});
const legacy={Authorization:`Bearer ${r.data.token.value}`};
r=await call(`/api/v2/vault/${uid}/api-tokens`,{method:'POST',headers:vaultHeaders,body:{
  label:'refresh',scopes:['kobo.catalog.read','kobo.library.read','kobo.library.refresh']
}});
const refreshHeaders={Authorization:`Bearer ${r.data.token.value}`};

// Authenticated status reports effective capabilities of the bearer.
r=await call('/api/v2/status',{headers:legacy});
assert.equal(r.res.status,200);
assert.equal(r.data.contract_revision,'2.3.4');
assert.equal(r.data.capabilities.includes('library_refresh'),false);
r=await call('/api/v2/status',{headers:refreshHeaders});
assert.equal(r.data.capabilities.includes('library_refresh'),true);

// Old tokens are never silently elevated.
r=await call('/api/v2/library/refresh',{method:'POST',headers:legacy});
assert.equal(r.res.status,403);
assert.equal(r.data.error.code,'forbidden');

// Library reads are passive even with a stale projection.
let upstreamCalls=0;
const originalFetch=globalThis.fetch;
const originalCaches=globalThis.caches;
const cacheMap=new Map();
globalThis.caches={default:{
  async match(req){const hit=cacheMap.get(req.url);return hit?hit.clone():undefined;},
  async put(req,res){cacheMap.set(req.url,res.clone());}
}};
globalThis.fetch=async(input)=>{
  const u=input instanceof URL?input:new URL(typeof input==='string'?input:input.url);
  upstreamCalls++;
  if(u.pathname==='/v1/auth/device') return new Response(JSON.stringify({
    AccessToken:'ANON_ACCESS_098',RefreshToken:'ANON_REFRESH_098',TokenType:'Bearer'
  }),{status:200,headers:{'Content-Type':'application/json'}});
  if(u.pathname==='/v1/initialization') return new Response(JSON.stringify({
    Resources:{products:'https://storeapi.kobo.com/v1/products'}
  }),{status:200,headers:{'Content-Type':'application/json'}});
  if(u.pathname==='/v1/products') return new Response(JSON.stringify({
    Items:[{Book:{Title:'Catalogue 098',ProductId:'cat-p',RevisionId:'cat-r',Contributors:['Auteur']}}],
    TotalPageCount:1,TotalItemCount:1,PageIndex:0
  }),{status:200,headers:{'Content-Type':'application/json'}});
  throw new Error(`unexpected fetch ${u}`);
};

try {
  r=await call('/api/v2/library/manifest',{headers:refreshHeaders});
  assert.equal(r.res.status,200);
  assert.deepEqual(r.data.items.map(x=>x.product_id),['owned']);
  assert.equal(upstreamCalls,0);

  // Provider catalogue: miss -> hit -> explicit revalidation.
  r=await call('/api/v2/catalog/search?q=catalogue',{headers:refreshHeaders});
  assert.equal(r.res.status,200);
  assert.equal(r.data.cache_status,'miss');
  const afterMiss=upstreamCalls;
  assert.ok(afterMiss>=3);

  r=await call('/api/v2/catalog/search?q=catalogue',{headers:refreshHeaders});
  assert.equal(r.data.cache_status,'hit');
  assert.equal(upstreamCalls,afterMiss);

  r=await call('/api/v2/catalog/search?q=catalogue&refresh=true',{headers:refreshHeaders});
  assert.equal(r.data.cache_status,'revalidated');
  assert.ok(upstreamCalls>afterMiss);
  assert.ok(r.data.origin_fetched_at);

  r=await call('/api/v2/catalog/search?q=catalogue&refresh=1',{headers:refreshHeaders});
  assert.equal(r.res.status,400);
  assert.equal(r.data.error.code,'invalid_request');
} finally {
  globalThis.fetch=originalFetch;
  if(originalCaches===undefined) delete globalThis.caches; else globalThis.caches=originalCaches;
}

console.log('api-v098-integration.test.mjs: OK');
