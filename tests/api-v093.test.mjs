import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const updater = fs.readFileSync(new URL('../scripts/update-from-zip.sh', import.meta.url), 'utf8');
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
const lockBootstrap = JSON.parse(fs.readFileSync(new URL('../scripts/package-lock.bootstrap.json', import.meta.url), 'utf8'));
const ensureLock = fs.readFileSync(new URL('../scripts/ensure-lockfile.sh', import.meta.url), 'utf8');
const statusSchema = JSON.parse(fs.readFileSync(new URL('../interfaces/kobo-vault-status.schema.json', import.meta.url), 'utf8'));
const openapi = fs.readFileSync(new URL('../interfaces/kobo-vault-openapi-v2.3.2.yaml', import.meta.url), 'utf8');

assert.match(worker, /APP_RELEASE = "0\.9\.8"/);
assert.match(worker, /API_V2_DEFAULT_SCOPES = \["kobo\.catalog\.read", "kobo\.library\.read", "kobo\.acquisition\.read"\]/);
assert.match(worker, /LEGACY_API_V1_ENABLED/);
assert.match(worker, /legacy_api_disabled/);
assert.match(worker, /contract_revision:"2\.3\.3"/);
assert.match(worker, /acquisition_schema_version:"1\.4"/);
assert.match(app, /APP_VERSION = '0\.9\.8'/);
assert.match(app, /kobo-vault-v098/);
assert.match(html, /apiTokenDelegate/);
assert.match(html, /kobo\.acquisition\.delegate/);
assert.match(html, /checked/);
assert.equal(pkg.version, '0.9.8');
assert.equal(pkg.devDependencies.wrangler, '4.30.0');
assert.equal(lock.packages[''].devDependencies.wrangler, '4.30.0');
assert.equal(lock.packages['node_modules/wrangler'].version, '4.30.0');
assert.deepEqual(lockBootstrap, lock);
assert.match(ensureLock, /package-lock\.bootstrap\.json/);
assert.match(updater, /package-lock\.json/);
assert.match(updater, /npm ci/);
assert.equal(statusSchema.properties.contract_revision.const, '2.3.3');
assert.equal(statusSchema.properties.acquisition_schema_version.const, '1.4');
assert.match(openapi, /version: 2\.3\.2/);
assert.ok(!fs.existsSync(new URL('../docs/interfaces/', import.meta.url)), 'docs/interfaces duplicate must be removed');

console.log('api-v093.test.mjs: OK');
