import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/worker.js';

class FakeStatement {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new FakeStatement(this.db, this.sql, args); }
  async first() { return this.db.prepare(this.sql).get(...this.args) ?? null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.args) }; }
  async run() {
    const r = this.db.prepare(this.sql).run(...this.args);
    return { success:true, meta:{ changes:Number(r.changes || 0), last_row_id:Number(r.lastInsertRowid || 0) } };
  }
}
class FakeD1 {
  constructor() { this.db = new DatabaseSync(':memory:'); }
  prepare(sql) { return new FakeStatement(this.db, sql); }
  async batch(stmts) {
    this.db.exec('BEGIN');
    try { const out=[]; for (const s of stmts) out.push(await s.run()); this.db.exec('COMMIT'); return out; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  exec(sql) { this.db.exec(sql); }
}

const d1 = new FakeD1();
for (const file of ['0001_init.sql','0002_api_jobs.sql','0003_provider_api_v2.sql','0004_library_sync_state.sql']) {
  d1.exec(fs.readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
}
const env = {
  KOBO_VAULT:d1,
  APP_VERSION:'0.9.3',
  KOBO_APP_VERSION:'4.44.23552',
  KOBO_API_CREDENTIAL_KEY:'test-secret-key-which-is-at-least-thirty-two-bytes-long',
  ASSETS:{ fetch:()=>new Response('not used') }
};
const ctx = { waitUntil(){} };
const base='https://vault.example';

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function call(path,{method='GET',headers={},body}={}) {
  const h=new Headers(headers);
  if (body !== undefined) h.set('Content-Type','application/json');
  const req=new Request(base+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});
  const res=await worker.fetch(req,env,ctx);
  const text=await res.text();
  return {res,data:text?JSON.parse(text):null};
}

let r=await call('/api/v2/status');
assert.equal(r.res.status,200);
assert.equal(r.data.api_version,'2.3');
assert.equal(r.data.acquisition_access,'unknown');
assert.ok(r.data.capabilities.includes('acquisition_delegation'));
assert.equal(r.data.capability_details.find(x=>x.id==='acquisition_delegation').scope,'kobo.acquisition.delegate');

const uidHash='d'.repeat(64);
const vaultSecret='vault-secret-with-enough-entropy-080';
const authHash=await sha256Hex(vaultSecret);
await d1.prepare("INSERT INTO vaults(uid_hash,salt,auth_hash,version,chunk_count,byte_length,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
  .bind(uidHash,'ABCDEFGHIJKLMNOPQRSTUV',authHash,1,0,0,new Date().toISOString(),new Date().toISOString()).run();
const vaultHeaders={'X-Vault-Auth':vaultSecret};

r=await call(`/api/v2/vault/${uidHash}/projection`,{method:'PUT',headers:vaultHeaders,body:{
  account:{id:'acct-v21',display_name:'Compte Kobo'},
  items:[
    {product_id:'prod-1',revision_id:'rev-1',isbn:'9780000000001',title:'LivreTest',authors:['Auteur Test'],description:'Roman historique',format:'EPUB',content_type:'ebook',downloadable:true},
    {product_id:'prod-2',revision_id:'rev-2',isbn:'9780000000002',title:'Autre titre',authors:['Autrice'],description:'Essai',format:'EPUB',content_type:'ebook',downloadable:false}
  ]
}});
assert.equal(r.res.status,200);

async function createToken(scopes) {
  const x=await call(`/api/v2/vault/${uidHash}/api-tokens`,{method:'POST',headers:vaultHeaders,body:{label:'Paris Library',scopes}});
  assert.equal(x.res.status,201);
  return x.data.token.value;
}
const descriptorToken=await createToken(['kobo.catalog.read','kobo.library.read','kobo.acquisition.read']);
const fullToken=await createToken(['kobo.catalog.read','kobo.library.read','kobo.acquisition.read','kobo.acquisition.delegate']);
const descriptorHeaders={Authorization:`Bearer ${descriptorToken}`};
const fullHeaders={Authorization:`Bearer ${fullToken}`};

r=await call('/api/v2/library/search?q=LivreTest&field=title',{headers:fullHeaders});
assert.equal(r.res.status,200);
assert.equal(r.data.items.length,1);
assert.equal(r.data.items[0].product_id,'prod-1');

r=await call('/api/v2/library/search?q=Auteur%20Test&field=author',{headers:fullHeaders});
assert.equal(r.data.items.length,1);

r=await call('/api/v2/library/search?q=9780000000001&field=isbn',{headers:fullHeaders});
assert.equal(r.data.items.length,1);

r=await call(`/api/v2/vault/${uidHash}/acquisition-access`,{method:'PUT',headers:vaultHeaders,body:{
  accessToken:'ACCESS_TOKEN_080_SECRET',
  refreshToken:'REFRESH_TOKEN_080_MUST_NOT_LEAK',
  appVersion:'4.44.23552',
  userId:'user-080',
  deviceId:'device-080',
  serialNumber:'serial-080'
}});
assert.equal(r.res.status,200);

const originalFetch=globalThis.fetch;
globalThis.fetch=async (input,init={}) => {
  const u=input instanceof URL ? input : new URL(typeof input==='string' ? input : input.url);
  if (u.pathname==='/v1/auth/device') {
    return new Response(JSON.stringify({TokenType:'Bearer',AccessToken:'ANON_ACCESS',RefreshToken:'ANON_REFRESH'}),{status:200,headers:{'Content-Type':'application/json'}});
  }
  if (u.pathname==='/v1/initialization') {
    return new Response(JSON.stringify({Resources:{
      products:'https://storeapi.kobo.com/v1/products',
      content_access_book:'https://storeapi.kobo.com/v1/content/{ProductId}'
    }}),{status:200,headers:{'Content-Type':'application/json'}});
  }
  if (u.pathname==='/v1/products') {
    return new Response(JSON.stringify({Items:[{Book:{
      Title:'LivreTest',RevisionId:'rev-1',ProductId:'prod-1',ISBN:'9780000000001',
      Language:'fr',ContributorRoles:[{Role:'Author',Name:'Auteur Test'}],
      Price:{Amount:'9.99',CurrencyCode:'EUR'}
    }}],TotalPageCount:1,PageIndex:0}),{status:200,headers:{'Content-Type':'application/json'}});
  }
  if (u.pathname==='/v1/content/rev-1') {
    const profile=u.searchParams.get('DisplayProfile');
    assert.ok(['Android','Desktop'].includes(profile));
    return new Response(JSON.stringify({
      ContentKeys:[{Name:'secret',Value:'CONTENT_KEY_MUST_NOT_LEAK'}],
      ContentUrls: profile === 'Desktop'
        ? [{DRMType:'AdobeDrm',UrlFormat:'EPUB3',DownloadUrl:'https://cdn.kobo.com/LivreTest-desktop.epub?exp=1893456000&sig=ok'}]
        : [{DRMType:'KDRM',UrlFormat:'KEPUB',DownloadUrl:'https://cdn.kobo.com/LivreTest.kepub?b=bad&exp=1893456000&sig=ok'}]
    }),{status:200,headers:{'Content-Type':'application/json'}});
  }
  throw new Error(`unexpected fetch ${u}`);
};
try {
  r=await call('/api/v2/catalog/search?q=LivreTest&field=title&language=fr&limit=20&page=0',{headers:fullHeaders});
  assert.equal(r.res.status,200);
  assert.equal(r.data.items.length,1);
  assert.equal(r.data.items[0].owned,true);
  assert.equal(r.data.items[0].downloadable,true);
  assert.equal(r.data.items[0].format,'EPUB');
  assert.equal(r.data.items[0].price.currency,'EUR');

  r=await call('/api/v2/library/prod-1/acquisition',{method:'POST',headers:descriptorHeaders,body:{revision_id:'rev-1',mode:'descriptor'}});
  assert.equal(r.res.status,200);
  assert.equal(r.data.schema_version,'1.4');
  assert.equal(r.data.acquisition.mode,'descriptor');
  assert.equal(r.data.acquisition.credentials_exposed,false);
  assert.equal(r.data.acquisition.validity.refresh_strategy,'resolve_again');
  assert.equal(r.data.acquisition.validity.expires_at,'2030-01-01T00:00:00.000Z');
  assert.equal(r.data.acquisition.display_profile,'Android');
  assert.deepEqual(r.data.acquisition.mechanisms,['kobo_kdrm']);
  assert.equal(r.data.acquisition.content_keys.present,true);
  assert.equal(r.data.acquisition.content_keys.count,1);
  assert.equal(r.data.acquisition.content_keys.values_exposed,false);
  assert.equal(r.data.acquisition.candidates[0].media_format,'kepub');
  assert.equal(r.data.acquisition.candidates[0].drm.family,'kobo_kdrm');
  assert.equal(r.data.acquisition.candidates[0].handling,'kobo_kdrm');
  assert.equal(JSON.stringify(r.data).includes('ACCESS_TOKEN_080_SECRET'),false);
  assert.equal(JSON.stringify(r.data).includes('CONTENT_KEY_MUST_NOT_LEAK'),false);
  assert.equal(r.res.headers.get('Cache-Control'),'private, no-store');

  r=await call('/api/v2/library/prod-1/acquisition',{method:'POST',headers:descriptorHeaders,body:{mode:'delegated'}});
  assert.equal(r.res.status,403);

  r=await call('/api/v2/library/prod-1/acquisition',{method:'POST',headers:fullHeaders,body:{mode:'delegated'}});
  assert.equal(r.res.status,200);
  assert.equal(r.data.acquisition.mode,'delegated');
  assert.equal(r.data.acquisition.credentials_exposed,true);
  assert.match(r.data.acquisition.delegation.content_access_request.headers.Authorization,/Bearer ACCESS_TOKEN_080_SECRET/);
  assert.equal(r.data.acquisition.delegation.session_context.device_id,'device-080');
  assert.equal(r.data.acquisition.delegation.refresh_token_exposed,false);
  assert.equal(r.data.acquisition.delegation.content_access_request.query.DisplayProfile,'Android');
  assert.equal(new URL(r.data.acquisition.delegation.content_access_request.url).searchParams.has('DisplayProfile'),false);
  assert.equal(r.data.acquisition.delegation.content_access_response.may_include_content_keys,true);
  assert.equal(r.data.acquisition.delegation.content_access_response.content_keys_values_returned_by_vault,false);
  assert.equal(JSON.stringify(r.data).includes('REFRESH_TOKEN_080_MUST_NOT_LEAK'),false);
  assert.equal(JSON.stringify(r.data).includes('CONTENT_KEY_MUST_NOT_LEAK'),false);

  r=await call('/api/v2/library/prod-1/acquisition',{method:'POST',headers:fullHeaders,body:{mode:'descriptor',display_profile:'Desktop'}});
  assert.equal(r.res.status,200);
  assert.equal(r.data.acquisition.display_profile,'Desktop');
  assert.deepEqual(r.data.acquisition.mechanisms,['adobe_adept']);
  assert.equal(r.data.acquisition.candidates[0].media_format,'epub');
  assert.equal(r.data.acquisition.candidates[0].drm.family,'adobe_adept');
  assert.equal(r.data.acquisition.candidates[0].handling,'adobe_adept');
} finally {
  globalThis.fetch=originalFetch;
}

console.log('api-v080-integration.test.mjs: OK');
