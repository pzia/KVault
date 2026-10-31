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

function makeEnv(extra={}) {
  const d1=new FakeD1();
  for(const f of ['0001_init.sql','0002_api_jobs.sql','0003_provider_api_v2.sql','0004_library_sync_state.sql']) d1.exec(fs.readFileSync(new URL(`../migrations/${f}`,import.meta.url),'utf8'));
  return {d1,env:{KOBO_VAULT:d1,APP_VERSION:'0.9.3',ASSETS:{fetch:()=>new Response('unused')},...extra}};
}
const ctx={waitUntil(){}};
const base='https://vault.example';
async function sha256Hex(text){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('');}
async function call(env,path,{method='GET',headers={},body}={}){const h=new Headers(headers);if(body!==undefined)h.set('Content-Type','application/json');const res=await worker.fetch(new Request(base+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)}),env,ctx);const text=await res.text();return {res,data:text?JSON.parse(text):null};}

// Status exposes independent version axes without changing API major/minor.
{
  const {env}=makeEnv();
  const r=await call(env,'/api/v2/status');
  assert.equal(r.res.status,200);
  assert.equal(r.data.api_version,'2.3');
  assert.equal(r.data.contract_revision,'2.3.3');
  assert.equal(r.data.acquisition_schema_version,'1.4');
}

// Legacy v1 is dead by default, but an explicit temporary compatibility flag can restore it.
{
  const {env}=makeEnv();
  let r=await call(env,'/api/v1/status');
  assert.equal(r.res.status,410);
  assert.equal(r.data.error.code,'legacy_api_disabled');
  const enabled={...env,LEGACY_API_V1_ENABLED:'true'};
  r=await call(enabled,'/api/v1/agent/pair/start',{method:'POST',body:{agent_name:'compat-test'}});
  assert.equal(r.res.status,201);
  assert.ok(r.data.pairing?.pair_id);
}

// Sensitive delegation is never granted implicitly; callers must request it.
{
  const {d1,env}=makeEnv();
  const uid='a'.repeat(64), secret='vault-secret-093-with-enough-entropy';
  await d1.prepare('INSERT INTO vaults(uid_hash,salt,auth_hash,version,chunk_count,byte_length,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .bind(uid,'ABCDEFGHIJKLMNOPQRSTUV',await sha256Hex(secret),1,0,0,new Date().toISOString(),new Date().toISOString()).run();
  const vh={'X-Vault-Auth':secret};
  let r=await call(env,`/api/v2/vault/${uid}/api-tokens`,{method:'POST',headers:vh,body:{label:'Default'}});
  assert.equal(r.res.status,201);
  assert.deepEqual(r.data.token.scopes,['kobo.catalog.read','kobo.library.read','kobo.acquisition.read']);
  assert.ok(!r.data.token.scopes.includes('kobo.acquisition.delegate'));

  r=await call(env,`/api/v2/vault/${uid}/api-tokens`,{method:'POST',headers:vh,body:{label:'Delegated',scopes:['kobo.catalog.read','kobo.library.read','kobo.acquisition.read','kobo.acquisition.delegate']}});
  assert.equal(r.res.status,201);
  assert.ok(r.data.token.scopes.includes('kobo.acquisition.delegate'));
}

console.log('api-v093-integration.test.mjs: OK');
