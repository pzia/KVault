import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const storage = fs.readFileSync(new URL('../public/storage.js', import.meta.url), 'utf8');

assert.match(html, />Ouvrir le coffre</);
assert.doesNotMatch(html, />Ouvrir ou créer le coffre</);
assert.match(html, /id="profileSelect"/);
assert.match(html, /id="knownProfilesSelect"/);
assert.match(html, /id="createVaultBtn"/);
assert.match(html, /Créer un nouveau compte Vault/);
assert.match(app, /La création implicite est désactivée/);
assert.match(app, /async function createVaultFromCurrent/);
assert.match(app, /async function switchVaultProfile/);
assert.match(storage, /KNOWN_PROFILES_KEY/);
assert.match(storage, /rememberKnownProfile/);
assert.match(storage, /forgetKnownProfile/);
assert.match(html, /Accès Provider Kobo/);
assert.doesNotMatch(html, /Accès acquisition<\/dt>/);

console.log('ui-v097.test.mjs: OK');
