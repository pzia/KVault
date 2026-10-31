import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/worker.js';

class FakeStatement {
  constructor(db, sql, args = []) { this.db=db; this.sql=sql; this.args=args; }
  bind(...args) { return new FakeStatement(this.db,this.sql,args); }
  async first() { return this.db.prepare(this.sql).get(...this.args) ?? null; }
  async all() { return {results:this.db.prepare(this.sql).all(...this.args)}; }
  async run() { const r=this.db.prepare(this.sql).run(...this.args); return {success:true,meta:{changes:Number(r.changes||0)}}; }
}
class FakeD1 {
  constructor(){ this.db=new DatabaseSync(':memory:'); }
  prepare(sql){ return new FakeStatement(this.db,sql); }
  async batch(stmts){ this.db.exec('BEGIN'); try { const out=[]; for(const s of stmts) out.push(await s.run()); this.db.exec('COMMIT'); return out; } catch(e){this.db.exec('ROLLBACK'); throw e;} }
  exec(sql){ this.db.exec(sql); }
}

const d1=new FakeD1();
for(const f of ['0001_init.sql','0002_api_jobs.sql','0003_provider_api_v2.sql','0004_library_sync_state.sql']) d1.exec(fs.readFileSync(new URL(`../migrations/${f}`,import.meta.url),'utf8'));
const env={KOBO_VAULT:d1,APP_VERSION:'0.9.3',KOBO_APP_VERSION:'4.44.23552',KOBO_API_CREDENTIAL_KEY:'test-secret-key-which-is-at-least-thirty-two-bytes-long',ASSETS:{fetch:()=>new Response('unused')}};
const ctx={waitUntil(){}};
const base='https://vault.example';
async function sha256Hex(text){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');}
async function call(path,{method='GET',headers={},body}={}){const h=new Headers(headers);if(body!==undefined)h.set('Content-Type','application/json');const res=await worker.fetch(new Request(base+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)}),env,ctx);const text=await res.text();return {res,data:text?JSON.parse(text):null};}

const uid='e'.repeat(64), secret='vault-secret-091-with-enough-entropy';
await d1.prepare('INSERT INTO vaults(uid_hash,salt,auth_hash,version,chunk_count,byte_length,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(uid,'ABCDEFGHIJKLMNOPQRSTUV',await sha256Hex(secret),1,0,0,new Date().toISOString(),new Date().toISOString()).run();
const vh={'X-Vault-Auth':secret};
let r=await call(`/api/v2/vault/${uid}/projection`,{method:'PUT',headers:vh,body:{account:{id:'acct',display_name:'Kobo'},items:[{product_id:'prod-1',revision_id:'rev-1',title:'Livre Adobe',authors:['Auteur'],format:'EPUB',content_type:'ebook',downloadable:true}]}});
assert.equal(r.res.status,200);
r=await call(`/api/v2/vault/${uid}/api-tokens`,{method:'POST',headers:vh,body:{label:'Paris',scopes:['kobo.library.read','kobo.acquisition.read','kobo.acquisition.delegate']}});
const token=r.data.token.value, ah={Authorization:`Bearer ${token}`};
r=await call(`/api/v2/vault/${uid}/acquisition-access`,{method:'PUT',headers:vh,body:{accessToken:'ACCESS_091',refreshToken:'REFRESH_091',appVersion:'4.44.23552',userId:'u',deviceId:'d',serialNumber:'s'}});
assert.equal(r.res.status,200);

const originalFetch=globalThis.fetch;
let downloadLinkCalls=0;
globalThis.fetch=async (input,init={})=>{
  const u=input instanceof URL?input:new URL(typeof input==='string'?input:input.url);
  if(u.pathname==='/v1/initialization') return new Response(JSON.stringify({Resources:{content_access_book:'https://storeapi.kobo.com/v1/products/books/{ProductId}/access',get_download_link:'https://storeapi.kobo.com/v1/library/downloadlink'}}),{status:200,headers:{'Content-Type':'application/json'}});
  if(u.pathname==='/v1/products/books/rev-1/access') return new Response(JSON.stringify({ContentKeys:[],ContentUrls:[{DRMType:'AdobeDrm',UrlFormat:'EPUB3',DownloadUrl:'https://cdn.kobo.com/book.epub?exp=1893456000'}]}),{status:200,headers:{'Content-Type':'application/json'}});
  if(u.pathname==='/v1/library/downloadlink') {
    downloadLinkCalls++;
    assert.equal(init.redirect,'manual');
    assert.equal(u.searchParams.get('RevisionId'),'rev-1');
    return new Response(null,{status:302,headers:{Location:'https://acs4.kobo.com/fulfillment/URLLink.acsm?fulfillmentToken=abc123'}});
  }
  throw new Error(`unexpected fetch ${u}`);
};
try {
  r=await call('/api/v2/status');
  assert.equal(r.data.api_version,'2.3');

  r=await call('/api/v2/library/prod-1/acquisition',{method:'POST',headers:ah,body:{mode:'descriptor',display_profile:'Desktop'}});
  assert.equal(r.res.status,200);
  assert.equal(r.data.schema_version,'1.4');
  assert.equal(r.data.acquisition.candidates.length,2);
  const acsm=r.data.acquisition.candidates.find(x=>x.kind==='acsm');
  assert.ok(acsm);
  assert.equal(acsm.media_format,'acsm');
  assert.equal(acsm.handling,'adobe_adept');
  assert.equal(acsm.kobo.source,'library_download_link');
  assert.equal(acsm.kobo.display_profile,null);
  assert.equal(acsm.kobo.requires_kobo_authorization,false);
  assert.match(acsm.url,/acs4\.kobo\.com\/fulfillment\/URLLink\.acsm/);
  assert.equal(r.data.acquisition.sources.acsm_export.status,'available');
  assert.equal(r.data.acquisition.sources.acsm_export.candidate_count,1);
  assert.equal(r.data.acquisition.sources.acsm_export.request_shape,'get_revision_id');
  assert.deepEqual(new Set(r.data.acquisition.mechanisms),new Set(['adobe_adept']));
  assert.equal(downloadLinkCalls,1);

  r=await call('/api/v2/library/prod-1/acquisition',{method:'POST',headers:ah,body:{mode:'descriptor',include_acsm:false,display_profile:'Desktop'}});
  assert.equal(r.res.status,200);
  assert.equal(r.data.acquisition.candidates.length,1);
  assert.equal(r.data.acquisition.sources.acsm_export.status,'skipped');
  assert.equal(downloadLinkCalls,1);
} finally { globalThis.fetch=originalFetch; }

console.log('api-v091-integration.test.mjs: OK');
