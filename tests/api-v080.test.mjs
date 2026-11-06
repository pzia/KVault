import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const openapi = fs.readFileSync(new URL('../interfaces/kobo-vault-openapi-v2.2.yaml', import.meta.url), 'utf8');
const acquisition = JSON.parse(fs.readFileSync(new URL('../interfaces/kobo-vault-acquisition.schema.json', import.meta.url), 'utf8'));
const statusSchema = JSON.parse(fs.readFileSync(new URL('../interfaces/kobo-vault-status.schema.json', import.meta.url), 'utf8'));

assert.match(worker, /const APP_RELEASE = "0\.9\.8"/);
assert.match(app, /const APP_VERSION = '0\.9\.7'/);
assert.ok(worker.includes('/api/v2/library/search'));
assert.ok(worker.includes('kobo.acquisition.delegate'));
assert.ok(worker.includes('mode === "delegated"'));
assert.ok(worker.includes('refresh_strategy:"resolve_again"'));

for (const route of [
  '/status:', '/account:', '/catalog/search:', '/library/search:', '/library/manifest:',
  '/library/{product_id}/acquisition:'
]) assert.ok(openapi.includes(route), `OpenAPI missing ${route}`);

for (const scope of [
  'kobo.catalog.read','kobo.library.read','kobo.acquisition.read','kobo.acquisition.delegate'
]) assert.ok(openapi.includes(scope), `OpenAPI missing scope ${scope}`);

assert.equal(acquisition.properties.schema_version.const, '1.4');
assert.equal(statusSchema.properties.api_version.const, '2.3');
assert.match(html, /acquisition déléguée KDRM/);

console.log('api-v080.test.mjs: OK');
