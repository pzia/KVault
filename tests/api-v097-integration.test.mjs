import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/worker.js';

class S { constructor(db,sql,args=[]){this.db=db;this.sql=sql;this.args=args} bind(...a){return new S(this.db,this.sql,a)} async first(){return this.db.prepare(this.sql).get(...this.args)??null} async all(){return{results:this.db.prepare(this.sql).all(...this.args)}} async run(){const r=this.db.prepare(this.sql).run(...this.args);return{success:true,meta:{changes:Number(r.changes||0)}}} }
class D { constructor(){this.db=new DatabaseSync(':memory:')} prepare(s){return new S(this.db,s)} async batch(ss){this.db.exec('BEGIN');try{const o=[];for(const s of ss)o.push(await s.run());this.db.exec('COMMIT');return o}catch(e){this.db.exec('ROLLBACK');throw e}} exec(s){this.db.exec(s)} }

const d1=new D();
for(const f of ['0001_init.sql','0002_api_jobs.sql','0003_provider_api_v2.sql','0004_library_sync_state.sql']) d1.exec(fs.readFileSync(new URL(`../migrations/${f}`,import.meta.url),'utf8'));
const env={KOBO_VAULT:d1,APP_VERSION:'0.9.7',KOBO_APP_VERSION:'4.44.23552',KOBO_API_CREDENTIAL_KEY:'test-secret-key-which-is-at-least-thirty-two-bytes-long',ASSETS:{fetch:()=>new Response('unused')}};
const ctx={waitUntil(){}}; const base='https://vault.example';
async function sha(t){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(t));return[...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('')}
async function call(path,{method='GET',headers={},body}={}){const h=new Headers(headers);if(body!==undefined)h.set('Content-Type','application/json');const res=await worker.fetch(new Request(base+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)}),env,ctx);const t=await res.text();return{res,data:t?JSON.parse(t):null}}

const uid='f'.repeat(64), secret='vault-secret-097-with-enough-entropy';
await d1.prepare('INSERT INTO vaults(uid_hash,salt,auth_hash,version,chunk_count,byte_length,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(uid,'ABCDEFGHIJKLMNOPQRSTUV',await sha(secret),1,0,0,new Date().toISOString(),new Date().toISOString()).run();
const vh={'X-Vault-Auth':secret};
await call(`/api/v2/vault/${uid}/projection`,{method:'PUT',headers:vh,body:{account:{id:'acct',display_name:'Kobo'},items:[{product_id:'prod-sync',revision_id:'rev-sync',title:'Livre KDRM',authors:['Auteur'],format:'EPUB',content_type:'ebook',downloadable:true,archived:false}]}});
await call(`/api/v2/vault/${uid}/acquisition-access`,{method:'PUT',headers:vh,body:{accessToken:'ACCESS_097_SECRET',refreshToken:'REFRESH_097_SECRET',appVersion:'4.44.23552',userId:'u',deviceId:'d',serialNumber:'s'}});

let r=await call(`/api/v2/vault/${uid}/api-tokens`,{method:'POST',headers:vh,body:{label:'Paris old',scopes:['kobo.library.read','kobo.acquisition.read']}});
const oldHeaders={Authorization:`Bearer ${r.data.token.value}`};
r=await call(`/api/v2/vault/${uid}/api-tokens`,{method:'POST',headers:vh,body:{label:'Paris 0.9.7',scopes:['kobo.library.read','kobo.acquisition.read','kobo.acquisition.delegate']}});
const delegatedHeaders={Authorization:`Bearer ${r.data.token.value}`};

// An existing token without the sensitive scope is not silently upgraded.
r=await call('/api/v2/library/prod-sync/acquisition',{method:'POST',headers:oldHeaders,body:{mode:'delegated',include_acsm:false}});
assert.equal(r.res.status,403);
assert.equal(r.data.error.code,'forbidden');

const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,init={})=>{
  const u=input instanceof URL?input:new URL(typeof input==='string'?input:input.url);
  if(u.pathname==='/v1/initialization') return new Response(JSON.stringify({Resources:{content_access_book:'https://storeapi.kobo.com/v1/products/books/{ProductId}/access',library_sync:'https://storeapi.kobo.com/v1/library/sync'}}),{status:200,headers:{'Content-Type':'application/json'}});
  if(u.pathname==='/v1/products/books/rev-sync/access') return new Response(JSON.stringify({ContentUrls:[],ContentKeys:[{Name:'OEBPS/a.xhtml',Value:'CONTENT_KEY_097_MUST_NOT_LEAK'}]}),{status:200,headers:{'Content-Type':'application/json'}});
  if(u.pathname==='/v1/library/sync') return new Response(JSON.stringify([
    {NewEntitlement:{BookMetadata:{CrossRevisionId:'prod-sync',RevisionId:'rev-sync',DownloadUrls:[{DrmType:'KDRM',Format:'FLEPUB',Url:'https://storedownloads.kobo.com/download?downloadToken=first',Platform:'Android'}]}}},
    {NewEntitlement:{BookMetadata:{CrossRevisionId:'prod-sync',RevisionId:'rev-sync',DownloadUrls:[{DrmType:'KDRM',Format:'FLEPUB',Url:'https://storedownloads.kobo.com/download?downloadToken=duplicate',Platform:'Android'}]}}}
  ]),{status:200,headers:{'Content-Type':'application/json'}});
  throw new Error(`unexpected fetch ${u}`);
};
try {
  r=await call('/api/v2/library/prod-sync/acquisition',{method:'POST',headers:delegatedHeaders,body:{mode:'delegated',include_acsm:false,display_profile:'Android'}});
  assert.equal(r.res.status,200);
  assert.equal(r.data.acquisition.mode,'delegated');
  assert.equal(r.data.acquisition.candidates.length,1);
  const c=r.data.acquisition.candidates[0];
  assert.equal(c.handling,'kobo_kdrm');
  assert.equal(c.media_format,'epub');
  assert.equal(c.source_format,'FLEPUB');
  assert.equal(c.kobo.source,'library_sync');
  assert.equal(c.kobo.display_profile,null);
  assert.equal(c.kobo.platform,'Android');
  assert.match(c.headers.Authorization,/Bearer ACCESS_097_SECRET/);
  assert.match(r.data.acquisition.delegation.content_access_request.headers.Authorization,/Bearer ACCESS_097_SECRET/);
  assert.equal(r.data.acquisition.delegation.content_access_request.query.DisplayProfile,'Android');
  assert.equal(r.data.acquisition.content_keys.present,true);
  assert.equal(r.data.acquisition.content_keys.values_exposed,false);
  assert.equal(JSON.stringify(r.data).includes('CONTENT_KEY_097_MUST_NOT_LEAK'),false);
  assert.equal(JSON.stringify(r.data).includes('REFRESH_097_SECRET'),false);
} finally { globalThis.fetch=originalFetch; }

console.log('api-v097-integration.test.mjs: OK');
