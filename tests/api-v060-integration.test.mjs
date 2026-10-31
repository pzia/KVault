import assert from 'node:assert/strict';
import fs from 'node:fs';
let DatabaseSync;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  console.log('api-v060-integration.test.mjs: SKIP (node:sqlite unavailable; requires Node >=22)');
  process.exit(0);
}
import worker from '../src/worker.js';

class FakeStatement {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args; }
  bind(...args) { return new FakeStatement(this.db, this.sql, args); }
  async first() {
    const stmt = this.db.prepare(this.sql);
    const row = stmt.get(...this.args);
    return row ?? null;
  }
  async all() {
    const stmt = this.db.prepare(this.sql);
    return { results: stmt.all(...this.args) };
  }
  async run() {
    const stmt = this.db.prepare(this.sql);
    const r = stmt.run(...this.args);
    return { success: true, meta: { changes: Number(r.changes || 0), last_row_id: Number(r.lastInsertRowid || 0) } };
  }
}

class FakeD1 {
  constructor() { this.db = new DatabaseSync(':memory:'); }
  prepare(sql) { return new FakeStatement(this.db, sql); }
  async batch(stmts) {
    this.db.exec('BEGIN');
    try {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  exec(sql) { this.db.exec(sql); }
}

const d1 = new FakeD1();
d1.exec(fs.readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
d1.exec(fs.readFileSync(new URL('../migrations/0002_api_jobs.sql', import.meta.url), 'utf8'));
d1.exec(fs.readFileSync(new URL('../migrations/0003_provider_api_v2.sql', import.meta.url), 'utf8'));
d1.exec(fs.readFileSync(new URL('../migrations/0004_library_sync_state.sql', import.meta.url), 'utf8'));
const env = { KOBO_VAULT: d1, APP_VERSION: '0.9.0', LEGACY_API_V1_ENABLED:'true', ASSETS: { fetch: () => new Response('not used') } };
const ctx = { waitUntil(){} };
const base = 'https://vault.example';

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2,'0')).join('');
}
async function call(path, {method='GET', headers={}, body}={}) {
  const h = new Headers(headers);
  if (body !== undefined) h.set('Content-Type','application/json');
  const req = new Request(base + path, { method, headers:h, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await worker.fetch(req, env, ctx);
  let data = null;
  const text = await res.text();
  if (text) data = JSON.parse(text);
  return {res,data};
}

const uidHash = 'a'.repeat(64);
const vaultSecret = 'vault-secret-with-enough-entropy-123';
const authHash = await sha256Hex(vaultSecret);
d1.prepare("INSERT INTO vaults(uid_hash,salt,auth_hash,version,chunk_count,byte_length,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
  .bind(uidHash,'ABCDEFGHIJKLMNOPQRSTUV',authHash,1,0,0,new Date().toISOString(),new Date().toISOString()).run();
const vaultHeaders = {'X-Vault-Auth':vaultSecret};

// Projection is browser-authenticated and contains metadata only.
let r = await call(`/api/v1/vault/${uidHash}/projection`, { method:'PUT', headers:vaultHeaders, body:{
  account:{id:'acct-hash',display_name:'Compte Kobo lié'},
  items:[{product_id:'prod-1',revision_id:'rev-1',title:'LivreTest',authors:['Auteur'],isbn:'9780000000001',format:'EPUB',content_type:'ebook',downloadable:true}]
}});
assert.equal(r.res.status, 200);
assert.equal(r.data.count, 1);

// Create Paris bearer token, then use only that token for the public v1 contract.
r = await call(`/api/v1/vault/${uidHash}/api-tokens`, {method:'POST',headers:vaultHeaders,body:{label:'Paris',scopes:['paris.read','paris.jobs.create']}});
assert.equal(r.res.status, 201);
const parisToken = r.data.token.value;
assert.match(parisToken,/^kvp_[a-f0-9]{64}$/);
const parisHeaders = {Authorization:`Bearer ${parisToken}`};

r = await call('/api/v1/status',{headers:parisHeaders});
assert.equal(r.res.status,200);
assert.deepEqual(r.data.capabilities,['library','library_search','agent_export']);

r = await call('/api/v1/account',{headers:parisHeaders});
assert.equal(r.data.account.id,'acct-hash');

r = await call('/api/v1/library/manifest?limit=200',{headers:parisHeaders});
assert.equal(r.data.items.length,1);
assert.equal(r.data.items[0].product_id,'prod-1');
assert.equal(r.data.items[0].downloadable,true);

r = await call('/api/v1/search?q=LivreTest&scope=library&field=title',{headers:parisHeaders});
assert.equal(r.data.items.length,1);
r = await call('/api/v1/search?q=LivreTest&scope=all',{headers:parisHeaders});
assert.equal(r.res.status,501);
assert.equal(r.data.error.code,'catalog_search_requires_agent');

// Queue a download job.
r = await call('/api/v1/library/prod-1/download-jobs',{method:'POST',headers:{...parisHeaders,'Idempotency-Key':'idem-1'},body:{revision_id:'rev-1',format:'epub'}});
assert.equal(r.res.status,202);
const jobId = r.data.job.id;
assert.equal(r.data.job.status,'queued');

// Reusing the same idempotency key with another request must conflict.
r = await call('/api/v1/library/prod-1/download-jobs',{method:'POST',headers:{...parisHeaders,'Idempotency-Key':'idem-1'},body:{revision_id:'rev-other',format:'epub'}});
assert.equal(r.res.status,409); // revision mismatch is detected before idempotency reuse

// Pair local agent without ever sharing a Kobo token.
r = await call('/api/v1/agent/pair/start',{method:'POST',body:{agent_name:'linux-home'}});
assert.equal(r.res.status,201);
const {pair_id,code} = r.data.pairing;
assert.ok(pair_id && code);
r = await call(`/api/v1/vault/${uidHash}/agent-pairings/approve`,{method:'POST',headers:vaultHeaders,body:{code}});
assert.equal(r.res.status,200);
r = await call('/api/v1/agent/pair/complete',{method:'POST',body:{pair_id,code}});
assert.equal(r.res.status,201);
const agentToken = r.data.agent.token;
assert.match(agentToken,/^kva_[a-f0-9]{64}$/);
const agentHeaders = {Authorization:`Bearer ${agentToken}`};

r = await call('/api/v1/agent/jobs/next',{headers:agentHeaders});
assert.equal(r.res.status,200);
assert.equal(r.data.job.id,jobId);
assert.equal('accessToken' in r.data.job,false);

r = await call(`/api/v1/agent/jobs/${jobId}/claim`,{method:'POST',headers:agentHeaders,body:{}});
assert.equal(r.res.status,200);
r = await call(`/api/v1/agent/jobs/${jobId}/progress`,{method:'POST',headers:agentHeaders,body:{status:'downloading',progress:25}});
assert.equal(r.res.status,200);
r = await call(`/api/v1/agent/jobs/${jobId}/complete`,{method:'POST',headers:agentHeaders,body:{filename:'/home/user/Books/LivreTest.epub',size:1234,sha256:'b'.repeat(64),hook:{status:'success',exit_code:0},accessToken:'must-not-persist'}});
assert.equal(r.res.status,200);

r = await call(`/api/v1/jobs/${jobId}`,{headers:parisHeaders});
assert.equal(r.data.job.status,'complete');
assert.equal(r.data.job.result.filename,'LivreTest.epub');
assert.equal(r.data.job.result.storage,'local-agent');
assert.equal(r.data.job.result.sha256,'b'.repeat(64));
assert.equal(JSON.stringify(r.data).includes('must-not-persist'),false);

// Removing the projection leaves tokens/jobs intact but removes account/manifest metadata.
r = await call(`/api/v1/vault/${uidHash}/projection`,{method:'DELETE',headers:vaultHeaders});
assert.equal(r.res.status,200);
r = await call('/api/v1/library/manifest',{headers:parisHeaders});
assert.equal(r.data.items.length,0);
r = await call(`/api/v1/jobs/${jobId}`,{headers:parisHeaders});
assert.equal(r.data.job.status,'complete');

console.log('api-v060-integration.test.mjs: OK');
