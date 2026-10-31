import assert from 'node:assert/strict';
import fs from 'node:fs';
let DatabaseSync;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  console.log('api-v070-integration.test.mjs: SKIP (node:sqlite unavailable; requires Node >=22)');
  process.exit(0);
}
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
const base = 'https://vault.example';

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function call(path,{method='GET',headers={},body}={}) {
  const h = new Headers(headers);
  if (body !== undefined) h.set('Content-Type','application/json');
  const req = new Request(base + path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)});
  const res = await worker.fetch(req,env,ctx);
  const text = await res.text();
  return {res,data:text?JSON.parse(text):null};
}

const uidHash='c'.repeat(64);
const vaultSecret='vault-secret-with-enough-entropy-070';
const authHash=await sha256Hex(vaultSecret);
await d1.prepare("INSERT INTO vaults(uid_hash,salt,auth_hash,version,chunk_count,byte_length,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
  .bind(uidHash,'ABCDEFGHIJKLMNOPQRSTUV',authHash,1,0,0,new Date().toISOString(),new Date().toISOString()).run();
const vaultHeaders={'X-Vault-Auth':vaultSecret};

let r = await call(`/api/v2/vault/${uidHash}/projection`,{method:'PUT',headers:vaultHeaders,body:{
  account:{id:'acct-v2',display_name:'Compte Kobo'},
  items:[{product_id:'prod-1',revision_id:'rev-1',isbn:'9780000000001',title:'LivreTest',authors:['Auteur'],format:'EPUB',content_type:'ebook',downloadable:true}]
}});
assert.equal(r.res.status,200);

r = await call(`/api/v2/vault/${uidHash}/api-tokens`,{method:'POST',headers:vaultHeaders,body:{
  label:'Paris Library',scopes:['kobo.catalog.read','kobo.library.read','kobo.acquisition.read']
}});
assert.equal(r.res.status,201);
const token=r.data.token.value;
assert.match(token,/^kvt_[a-f0-9]{64}$/);
const apiHeaders={Authorization:`Bearer ${token}`};

r = await call(`/api/v2/vault/${uidHash}/acquisition-access`,{method:'PUT',headers:vaultHeaders,body:{
  accessToken:'ACCESS_TOKEN_1234567890',refreshToken:'REFRESH_TOKEN_1234567890',appVersion:'4.44.23552',userId:'user-1',deviceId:'device-1'
}});
assert.equal(r.res.status,200);
const stored=await d1.prepare('SELECT iv,ciphertext FROM kobo_api_credentials WHERE uid_hash=?').bind(uidHash).first();
assert.ok(stored?.iv && stored?.ciphertext);
assert.equal(stored.ciphertext.includes('ACCESS_TOKEN'),false);

r=await call('/api/v2/status',{headers:apiHeaders});
assert.equal(r.res.status,200);
assert.equal(r.data.api_version,'2.3');
assert.equal(r.data.role,'kobo-library-provider');
assert.ok(r.data.capabilities.includes('catalog_search'));
assert.ok(r.data.capabilities.includes('library_search'));
assert.ok(r.data.capabilities.includes('acquisition_info'));
assert.equal(r.data.acquisition_access,'configured');

r=await call('/api/v2/account',{headers:apiHeaders});
assert.equal(r.data.account.id,'acct-v2');
r=await call('/api/v2/library/manifest',{headers:apiHeaders});
assert.equal(r.data.items.length,1);
r=await call('/api/v2/library/prod-1',{headers:apiHeaders});
assert.equal(r.data.item.revision_id,'rev-1');

const originalFetch=globalThis.fetch;
globalThis.fetch=async (input, init={}) => {
  const u = input instanceof URL ? input : new URL(typeof input==='string' ? input : input.url);
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
      Title:'LivreTest',RevisionId:'rev-1',ProductId:'prod-1',ISBN:'9780000000001',Language:'fr',ContributorRoles:[{Role:'Author',Name:'Auteur'}]
    }}],TotalPageCount:1,PageIndex:0}),{status:200,headers:{'Content-Type':'application/json'}});
  }
  if (u.pathname==='/v1/content/rev-1') {
    assert.equal(u.searchParams.get('DisplayProfile'),'Android');
    return new Response(JSON.stringify({
      ContentKeys:[{Name:'secret',Value:'NEVER_RETURN_THIS'}],
      ContentUrls:[
        {DRMType:'SignedNoDrm',UrlFormat:'EPUB3',DownloadUrl:'https://cdn.kobo.com/LivreTest.epub?b=bad&sig=ok'},
        {DRMType:'KDRM',UrlFormat:'KEPUB',DownloadUrl:'https://cdn.kobo.com/LivreTest.kepub?sig=ok'}
      ]
    }),{status:200,headers:{'Content-Type':'application/json'}});
  }
  throw new Error(`unexpected fetch ${u}`);
};
try {
  r=await call('/api/v2/catalog/search?q=LivreTest&language=fr&limit=20&page=0',{headers:apiHeaders});
  assert.equal(r.res.status,200);
  assert.equal(r.data.items.length,1);
  assert.equal(r.data.items[0].owned,true);

  r=await call('/api/v2/library/prod-1/acquisition',{method:'POST',headers:apiHeaders,body:{revision_id:'rev-1'}});
  assert.equal(r.res.status,200);
  assert.equal(r.data.provider,'kobo');
  assert.equal(r.data.acquisition.content_keys_exposed,false);
  assert.equal(r.data.acquisition.credentials_exposed,false);
  assert.equal(r.data.acquisition.candidates.length,2);
  assert.equal(r.data.acquisition.candidates[0].protected,false);
  assert.equal(r.data.acquisition.candidates[1].protected,true);
  assert.equal(r.data.acquisition.candidates[0].url.includes('b='),false);
  assert.equal(JSON.stringify(r.data).includes('NEVER_RETURN_THIS'),false);
  assert.equal(JSON.stringify(r.data).includes('ACCESS_TOKEN_1234567890'),false);
} finally {
  globalThis.fetch=originalFetch;
}

r=await call(`/api/v2/vault/${uidHash}/acquisition-access`,{method:'DELETE',headers:vaultHeaders});
assert.equal(r.res.status,200);
r=await call('/api/v2/status',{headers:apiHeaders});
assert.equal(r.data.acquisition_access,'not_configured');

console.log('api-v070-integration.test.mjs: OK');
