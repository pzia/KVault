import assert from 'node:assert/strict';
import fs from 'node:fs';

const script = fs.readFileSync(new URL('../scripts/update-from-zip.sh', import.meta.url), 'utf8');
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const profile = fs.readFileSync(new URL('../docs/DISTRIBUTION_PROFILE.md', import.meta.url), 'utf8');

assert.equal(pkg.version, '0.9.8');
assert.match(script, /--dry-run/);
assert.match(script, /--rollback/);
assert.match(script, /validate_zip_names/);
assert.match(script, /release candidate/i);
assert.match(script, /kobo-library-vault-dist-/);
assert.match(script, /restore_distribution/);
assert.match(profile, /Provider API v2\.3/);
assert.match(profile, /indépendant du contrat métier|indépendante du contrat métier/i);

console.log('update-v081.test.mjs: OK');
