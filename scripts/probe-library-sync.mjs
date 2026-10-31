#!/usr/bin/env node
import fs from 'node:fs/promises';

const base = String(process.env.KOBO_VAULT_URL || '').replace(/\/$/, '');
const uid = String(process.env.KOBO_VAULT_UID_HASH || '');
const auth = String(process.env.KOBO_VAULT_AUTH || '');
const output = process.env.KOBO_VAULT_PROBE_OUTPUT || `kobo-library-sync-probe-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
const productIds = process.argv.slice(2);
if (!base || !/^[a-f0-9]{64}$/i.test(uid) || auth.length < 20) {
  console.error('Set KOBO_VAULT_URL, KOBO_VAULT_UID_HASH and KOBO_VAULT_AUTH. Optional: KOBO_VAULT_PROBE_OUTPUT.');
  process.exit(2);
}
if (!productIds.length) {
  console.error('Pass one or more Kobo ProductId values as command-line arguments. No personal ProductId is embedded in the public source.');
  process.exit(2);
}
const body = { product_ids: productIds };
const response = await fetch(`${base}/api/v2/vault/${uid}/diagnostics/library-sync`, {
  method:'POST',
  headers:{ 'Content-Type':'application/json', 'X-Vault-Auth':auth },
  body:JSON.stringify(body)
});
const text = await response.text();
if (!response.ok) {
  console.error(`Probe failed: HTTP ${response.status}\n${text}`);
  process.exit(1);
}
await fs.writeFile(output, text.endsWith('\n') ? text : `${text}\n`, { mode:0o600 });
console.log(output);
