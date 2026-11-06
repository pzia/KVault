import assert from 'node:assert/strict';
import fs from 'node:fs';

const script=fs.readFileSync(new URL('../scripts/update_from_git',import.meta.url),'utf8');
const updater=fs.readFileSync(new URL('../scripts/update-from-zip.sh',import.meta.url),'utf8');
const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));

assert.equal(pkg.version,'0.9.8');
assert.equal(pkg.scripts['update:git'],'bash scripts/update_from_git');
assert.match(script,/pzia\/KVault/);
assert.match(script,/commits\/\$ENCODED_REF/);
assert.match(script,/\^\[0-9a-f\]\{40\}\$/);
assert.match(script,/archive\/\$SHA\.zip/);
assert.match(script,/update-from-zip\.sh/);
assert.match(script,/--deploy/);
assert.match(script,/--dry-run/);
assert.match(script,/GITHUB_TOKEN/);
assert.match(updater,/scripts\/update_from_git/);

console.log('update-from-git.test.mjs: OK');
