import assert from 'node:assert/strict';
import { randomSalt, randomDeviceSecret, deriveVaultKeys, importVaultKey, encryptVault, decryptVault, encryptDeviceSession, decryptDeviceSession, sha256Hex } from '../public/crypto.js';

const uid = 'Alice-Kobo';
const salt = randomSalt();
const a = await deriveVaultKeys(uid, 'une phrase de passe suffisamment longue', salt);
const b = await deriveVaultKeys(uid, 'une phrase de passe suffisamment longue', salt);
assert.equal(a.uidHash, await sha256Hex('alice-kobo'));
assert.equal(a.authSecret, b.authSecret);
assert.equal(typeof a.encKeyRaw, 'string');
const value = {hello:'é世界', n:42};
const blob = await encryptVault(value, a.encKey, a.uidHash);
assert.deepEqual(await decryptVault(blob, b.encKey, b.uidHash), value);
const imported = await importVaultKey(a.encKeyRaw);
assert.deepEqual(await decryptVault(blob, imported, a.uidHash), value);
let failed = false;
try {
  const wrong = await deriveVaultKeys(uid, 'une autre phrase de passe assez longue', salt);
  await decryptVault(blob, wrong.encKey, wrong.uidHash);
} catch { failed = true; }
assert.equal(failed, true);

const deviceSecret = randomDeviceSecret();
const sessionPayload = {uid:'alice-kobo', salt, encKeyRaw:a.encKeyRaw, authSecret:a.authSecret};
const envelope = await encryptDeviceSession(sessionPayload, deviceSecret, a.uidHash);
assert.match(envelope, /^v2\./);
assert.deepEqual(await decryptDeviceSession(envelope, deviceSecret, a.uidHash), sessionPayload);
let deviceFailed=false;
try { await decryptDeviceSession(envelope, randomDeviceSecret(), a.uidHash); } catch { deviceFailed=true; }
assert.equal(deviceFailed,true);
console.log('crypto.test.mjs: OK');
