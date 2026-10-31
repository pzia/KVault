const DB_NAME = "kobo-library-vault";
const DB_VERSION = 3;
const STORE = "vaults";
const SESSION_STORE = "sessions";
const CATALOG_STORE = "catalog-cache";
const CATALOG_MAX_ENTRY_BYTES = 6 * 1024 * 1024;
const CATALOG_MAX_TOTAL_BYTES = 24 * 1024 * 1024;

function db() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: "uidHash" });
      if (!r.result.objectStoreNames.contains(SESSION_STORE)) r.result.createObjectStore(SESSION_STORE, { keyPath: "uidHash" });
      let catalog;
      if (!r.result.objectStoreNames.contains(CATALOG_STORE)) {
        catalog = r.result.createObjectStore(CATALOG_STORE, { keyPath: "id" });
      } else {
        catalog = r.transaction.objectStore(CATALOG_STORE);
      }
      if (!catalog.indexNames.contains("uidHash")) catalog.createIndex("uidHash", "uidHash", { unique: false });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function tx(store, mode, fn) {
  const d = await db();
  try {
    return await new Promise((resolve, reject) => {
      const t = d.transaction(store, mode);
      const s = t.objectStore(store);
      let result;
      try { result = fn(s); } catch (e) { reject(e); return; }
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally { d.close(); }
}

async function get(store, key) {
  const d = await db();
  try {
    return await new Promise((resolve, reject) => {
      const t = d.transaction(store, "readonly");
      const r = t.objectStore(store).get(key);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  } finally { d.close(); }
}

async function getCatalogRecords(uidHash) {
  const d = await db();
  try {
    return await new Promise((resolve, reject) => {
      const t = d.transaction(CATALOG_STORE, "readonly");
      const s = t.objectStore(CATALOG_STORE);
      const r = s.index("uidHash").getAll(IDBKeyRange.only(uidHash));
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    });
  } finally { d.close(); }
}

function jsonBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value ?? null)).byteLength;
}

export async function getLocalVault(uidHash) { return get(STORE, uidHash); }
export async function putLocalVault(record) { return tx(STORE, "readwrite", s => s.put(record)); }
export async function deleteLocalVault(uidHash) { return tx(STORE, "readwrite", s => s.delete(uidHash)); }
export async function getRememberedSession(uidHash) { return get(SESSION_STORE, uidHash); }
export async function putRememberedSession(record) { return tx(SESSION_STORE, "readwrite", s => s.put(record)); }
export async function deleteRememberedSession(uidHash) { return tx(SESSION_STORE, "readwrite", s => s.delete(uidHash)); }

export async function getCatalogCache(uidHash, key) {
  if (!uidHash || !key) return null;
  const record = await get(CATALOG_STORE, `${uidHash}:${key}`);
  return record ? { ...record, id: undefined, uidHash: undefined, key: undefined } : null;
}

export async function putCatalogCache(uidHash, key, value, limits = {}) {
  if (!uidHash || !key || !value) return { stored: false, reason: "invalid" };
  const maxEntryBytes = Number(limits.maxEntryBytes || CATALOG_MAX_ENTRY_BYTES);
  const maxTotalBytes = Number(limits.maxTotalBytes || CATALOG_MAX_TOTAL_BYTES);
  const bytes = jsonBytes(value);
  if (bytes > maxEntryBytes) return { stored: false, reason: "entry_too_large", bytes, maxEntryBytes };
  const now = new Date().toISOString();
  await tx(CATALOG_STORE, "readwrite", s => s.put({
    id: `${uidHash}:${key}`, uidHash, key, ...value, bytes, lastAccessedAt: now
  }));
  const pruned = await pruneCatalogCache(uidHash, maxTotalBytes);
  return { stored: true, bytes, pruned };
}

export async function deleteCatalogCache(uidHash, key) {
  if (!uidHash || !key) return;
  return tx(CATALOG_STORE, "readwrite", s => s.delete(`${uidHash}:${key}`));
}

export async function deleteCatalogCaches(uidHash) {
  if (!uidHash) return;
  const records = await getCatalogRecords(uidHash);
  if (!records.length) return;
  return tx(CATALOG_STORE, "readwrite", s => {
    for (const record of records) s.delete(record.id);
  });
}

export async function pruneCatalogCache(uidHash, maxTotalBytes = CATALOG_MAX_TOTAL_BYTES) {
  const records = await getCatalogRecords(uidHash);
  records.sort((a, b) => Date.parse(b.lastAccessedAt || b.fetchedAt || 0) - Date.parse(a.lastAccessedAt || a.fetchedAt || 0));
  let total = records.reduce((sum, r) => sum + Number(r.bytes || jsonBytes(r)), 0);
  const remove = [];
  for (let i = records.length - 1; i >= 0 && total > maxTotalBytes; i -= 1) {
    const record = records[i];
    total -= Number(record.bytes || jsonBytes(record));
    remove.push(record.id);
  }
  if (remove.length) await tx(CATALOG_STORE, "readwrite", s => { for (const id of remove) s.delete(id); });
  return { removed: remove.length, bytes: Math.max(0, total), maxTotalBytes };
}

export function getLastUid() { return localStorage.getItem("kobo-vault:last-uid") || ""; }
export function setLastUid(uid) { localStorage.setItem("kobo-vault:last-uid", uid); }
export function clearLastUid() { localStorage.removeItem("kobo-vault:last-uid"); }
const KNOWN_PROFILES_KEY = "kobo-vault:known-profiles-v1";
export function getKnownProfiles() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KNOWN_PROFILES_KEY) || "[]");
    const last = getLastUid();
    return [...new Set([...(Array.isArray(parsed) ? parsed : []), ...(last ? [last] : [])].map(x => String(x || "").trim()).filter(Boolean))].slice(0, 32);
  } catch {
    const last = getLastUid();
    return last ? [last] : [];
  }
}
export function rememberKnownProfile(uid) {
  const value = String(uid || "").trim();
  if (!value) return;
  const next = [value, ...getKnownProfiles().filter(x => x !== value)].slice(0, 32);
  localStorage.setItem(KNOWN_PROFILES_KEY, JSON.stringify(next));
}
export function forgetKnownProfile(uid) {
  const value = String(uid || "").trim();
  const next = getKnownProfiles().filter(x => x !== value);
  if (next.length) localStorage.setItem(KNOWN_PROFILES_KEY, JSON.stringify(next));
  else localStorage.removeItem(KNOWN_PROFILES_KEY);
}
const DEVICE_SECRET_KEY = "kobo-vault:device-secret-v2";
export function getDeviceSecret() { try { return localStorage.getItem(DEVICE_SECRET_KEY) || ""; } catch { return ""; } }
export function setDeviceSecret(value) { localStorage.setItem(DEVICE_SECRET_KEY, String(value || "")); }
export function clearDeviceSecret() { try { localStorage.removeItem(DEVICE_SECRET_KEY); } catch {} }
