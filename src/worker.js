const APP_RELEASE = "0.9.7";
const PLATFORM_ID = "00000000-0000-0000-0000-000000000373";
const DEFAULT_KOBO_APP_VERSION = "4.44.23552";
const KOBO_AFFILIATE = "Kobo";
const KOBO_STORE = "https://storeapi.kobo.com";
const KOBO_AUTH = "https://auth.kobobooks.com";
const MAX_BODY_BYTES = 12 * 1024 * 1024;
const MAX_CHUNK_BYTES = 1_450_000; // well below D1's 2 MB row/BLOB/string limit
const MAX_CHUNKS = 32;
const API_MAX_PROJECTION_ITEMS = 5000;
const API_PAIRING_TTL_MS = 10 * 60 * 1000;
const API_AGENT_LEASE_MS = 5 * 60 * 1000;
const API_ALLOWED_PARIS_SCOPES = new Set(["paris.read", "paris.jobs.create"]);
const API_V2_SCOPES = new Set(["kobo.catalog.read", "kobo.library.read", "kobo.acquisition.read", "kobo.acquisition.delegate"]);
const API_V2_DEFAULT_SCOPES = ["kobo.catalog.read", "kobo.library.read", "kobo.acquisition.read"];
const API_ACQUISITION_MAX_CANDIDATES = 20;
const KOBO_FETCH_TIMEOUT_MS = 10_000;
const KOBO_FETCH_MAX_RETRIES = 2;
const KOBO_FETCH_BASE_DELAY_MS = 250;
const KOBO_FETCH_MAX_RETRY_AFTER_MS = 2_000;
const LIBRARY_SYNC_FRESH_MS = 24 * 60 * 60 * 1000;
const LIBRARY_SYNC_LOCK_MS = 5 * 60 * 1000;
const LIBRARY_SYNC_FAILURE_BACKOFF_MS = 15 * 60 * 1000;
const KOBO_RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
let anonymousKoboSession = null;

const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Content-Security-Policy": "default-src 'self'; img-src 'self' https://cdn.kobo.com data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self' https://www.kobo.com"
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/")) {
        const response = await routeApi(request, env, url, ctx);
        return withSecurity(response);
      }
      const response = await env.ASSETS.fetch(request);
      return withSecurity(response);
    } catch (error) {
      const pathname = new URL(request.url).pathname;
      const isVersioned = pathname.startsWith("/api/v1/") || pathname.startsWith("/api/v2/");
      if (error instanceof HttpError) return withSecurity(isVersioned ? v1Error(error.status, error.code, error.message, error.headers) : json({ error: error.code, message: error.message }, error.status, error.headers));
      return withSecurity(isVersioned ? v1Error(500, "internal_error", safeError(error)) : json({ error: "internal_error", message: safeError(error) }, 500));
    }
  }
};

function legacyApiV1Enabled(env) {
  return ["1", "true", "yes", "on"].includes(String(env.LEGACY_API_V1_ENABLED || "").trim().toLowerCase());
}

async function routeApi(request, env, url, ctx) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (url.pathname === "/api/health" && request.method === "GET") {
    return json({ ok: true, version: env.APP_VERSION || APP_RELEASE, time: new Date().toISOString() });
  }

  if (url.pathname.startsWith("/api/v2/")) {
    return routeV2(request, env, url, ctx);
  }
  if (url.pathname.startsWith("/api/v1/")) {
    if (!legacyApiV1Enabled(env)) {
      return v1Error(410, "legacy_api_disabled", "L’API v1 jobs/agents est obsolète et désactivée par défaut. Utilisez l’API fournisseur /api/v2/.");
    }
    return routeV1(request, env, url, ctx);
  }

  if (url.pathname === "/api/kobo/activation/start" && request.method === "POST") {
    return startActivation(env);
  }
  if (url.pathname === "/api/kobo/activation/poll" && request.method === "POST") {
    return pollActivation(request, env);
  }
  if (url.pathname === "/api/kobo/library" && request.method === "POST") {
    return getKoboLibrary(request, env, ctx);
  }
  if (url.pathname === "/api/kobo/ratings" && request.method === "POST") {
    return getKoboRatings(request, env, ctx);
  }
  if (url.pathname === "/api/kobo/ratings/diagnostic" && request.method === "POST") {
    return diagnoseKoboRating(request, env);
  }
  if (url.pathname === "/api/kobo/catalog" && request.method === "POST") {
    return searchKoboCatalog(request, env, ctx);
  }

  const vaultMatch = url.pathname.match(/^\/api\/vault\/([a-f0-9]{64})(?:\/(meta))?$/);
  if (vaultMatch) {
    const uidHash = vaultMatch[1];
    const isMeta = vaultMatch[2] === "meta";
    if (isMeta && request.method === "GET") return getVaultMeta(env, uidHash);
    if (!isMeta && request.method === "GET") return getVault(request, env, uidHash);
    if (!isMeta && request.method === "PUT") return putVault(request, env, uidHash);
    if (!isMeta && request.method === "DELETE") return deleteVault(request, env, uidHash);
  }

  return json({ error: "not_found" }, 404);
}


async function routeV2(request, env, url, ctx) {
  const path = url.pathname;

  // Browser-only management routes. They keep using the existing vault auth
  // secret and never expose the encrypted vault itself.
  const projectionMatch = path.match(/^\/api\/v2\/vault\/([a-f0-9]{64})\/projection$/);
  if (projectionMatch) {
    const uidHash = projectionMatch[1];
    if (request.method === "GET") return v1ProjectionStatus(request, env, uidHash);
    if (request.method === "PUT") return v1PutProjection(request, env, uidHash);
    if (request.method === "DELETE") return v1DeleteProjection(request, env, uidHash);
  }
  const tokensMatch = path.match(/^\/api\/v2\/vault\/([a-f0-9]{64})\/api-tokens(?:\/([A-Za-z0-9_-]+))?$/);
  if (tokensMatch) {
    const [, uidHash, tokenId] = tokensMatch;
    if (!tokenId && request.method === "GET") return v1ListApiTokens(request, env, uidHash);
    if (!tokenId && request.method === "POST") return v2CreateApiToken(request, env, uidHash);
    if (tokenId && request.method === "DELETE") return v1RevokeApiToken(request, env, uidHash, tokenId);
  }
  const credentialsMatch = path.match(/^\/api\/v2\/vault\/([a-f0-9]{64})\/acquisition-access$/);
  if (credentialsMatch) {
    const uidHash = credentialsMatch[1];
    if (request.method === "GET") return v2AcquisitionAccessStatus(request, env, uidHash);
    if (request.method === "PUT") return v2PutAcquisitionAccess(request, env, uidHash);
    if (request.method === "DELETE") return v2DeleteAcquisitionAccess(request, env, uidHash);
  }
  const librarySyncProbeMatch = path.match(/^\/api\/v2\/vault\/([a-f0-9]{64})\/diagnostics\/library-sync$/);
  if (librarySyncProbeMatch && request.method === "POST") {
    return v2LibrarySyncProbe(request, env, librarySyncProbeMatch[1]);
  }

  if (path === "/api/v2/status" && request.method === "GET") {
    const client = await optionalApiClient(request, env);
    return v2Status(env, client);
  }

  const client = await authenticateApiClient(request, env);
  if (path === "/api/v2/account" && request.method === "GET") {
    requireApiScope(client, "kobo.library.read");
    return v1Account(env, client);
  }
  if (path === "/api/v2/catalog/search" && request.method === "GET") {
    requireApiScope(client, "kobo.catalog.read");
    return v2CatalogSearch(env, client, url, ctx);
  }
  if (path === "/api/v2/library/search" && request.method === "GET") {
    requireApiScope(client, "kobo.library.read");
    return v2LibrarySearch(env, client, url);
  }
  if (path === "/api/v2/library/manifest" && request.method === "GET") {
    requireApiScope(client, "kobo.library.read");
    return v1Manifest(env, client, url);
  }
  const bookMatch = path.match(/^\/api\/v2\/library\/([^/]+)$/);
  if (bookMatch && request.method === "GET") {
    requireApiScope(client, "kobo.library.read");
    return v2LibraryBook(env, client, decodeURIComponent(bookMatch[1]));
  }
  const acquisitionMatch = path.match(/^\/api\/v2\/library\/([^/]+)\/acquisition$/);
  if (acquisitionMatch && request.method === "POST") {
    requireApiScope(client, "kobo.acquisition.read");
    return v2Acquisition(request, env, client, decodeURIComponent(acquisitionMatch[1]));
  }
  throw new HttpError(404, "not_found", "Route API v2 inconnue");
}


async function routeV1(request, env, url, ctx) {
  const path = url.pathname;

  // Local-agent pairing starts before an agent token exists.
  if (path === "/api/v1/agent/pair/start" && request.method === "POST") return v1AgentPairStart(request, env);
  if (path === "/api/v1/agent/pair/complete" && request.method === "POST") return v1AgentPairComplete(request, env);

  // Browser-only management routes: authenticated with the existing vault auth secret.
  const projectionMatch = path.match(/^\/api\/v1\/vault\/([a-f0-9]{64})\/projection$/);
  if (projectionMatch) {
    const uidHash = projectionMatch[1];
    if (request.method === "GET") return v1ProjectionStatus(request, env, uidHash);
    if (request.method === "PUT") return v1PutProjection(request, env, uidHash);
    if (request.method === "DELETE") return v1DeleteProjection(request, env, uidHash);
  }
  const tokensMatch = path.match(/^\/api\/v1\/vault\/([a-f0-9]{64})\/api-tokens(?:\/([A-Za-z0-9_-]+))?$/);
  if (tokensMatch) {
    const [, uidHash, tokenId] = tokensMatch;
    if (!tokenId && request.method === "GET") return v1ListApiTokens(request, env, uidHash);
    if (!tokenId && request.method === "POST") return v1CreateApiToken(request, env, uidHash);
    if (tokenId && request.method === "DELETE") return v1RevokeApiToken(request, env, uidHash, tokenId);
  }
  const pairApproveMatch = path.match(/^\/api\/v1\/vault\/([a-f0-9]{64})\/agent-pairings\/approve$/);
  if (pairApproveMatch && request.method === "POST") return v1ApproveAgentPairing(request, env, pairApproveMatch[1]);
  const agentsMatch = path.match(/^\/api\/v1\/vault\/([a-f0-9]{64})\/agents(?:\/([A-Za-z0-9_-]+))?$/);
  if (agentsMatch) {
    const [, uidHash, agentId] = agentsMatch;
    if (!agentId && request.method === "GET") return v1ListAgents(request, env, uidHash);
    if (agentId && request.method === "DELETE") return v1RevokeAgent(request, env, uidHash, agentId);
  }
  const privateJobsMatch = path.match(/^\/api\/v1\/vault\/([a-f0-9]{64})\/jobs$/);
  if (privateJobsMatch && request.method === "GET") return v1ListVaultJobs(request, env, privateJobsMatch[1], url);

  // Agent API: only the pairing endpoints above are anonymous.
  if (path.startsWith("/api/v1/agent/")) {
    const agent = await authenticateAgent(request, env);
    if (path === "/api/v1/agent/jobs/next" && request.method === "GET") return v1AgentNextJob(env, agent);
    if (path === "/api/v1/agent/heartbeat" && request.method === "POST") return v1AgentHeartbeat(request, env, agent);
    const jobAction = path.match(/^\/api\/v1\/agent\/jobs\/([A-Za-z0-9_-]+)\/(claim|progress|complete|failed)$/);
    if (jobAction && request.method === "POST") {
      const [, jobId, action] = jobAction;
      if (action === "claim") return v1AgentClaimJob(env, agent, jobId);
      if (action === "progress") return v1AgentProgressJob(request, env, agent, jobId);
      if (action === "complete") return v1AgentCompleteJob(request, env, agent, jobId);
      if (action === "failed") return v1AgentFailJob(request, env, agent, jobId);
    }
    throw new HttpError(404, "not_found", "Route agent inconnue");
  }

  // Paris/desktop API.
  const client = await authenticateApiClient(request, env);
  if (path === "/api/v1/status" && request.method === "GET") {
    requireApiScope(client, "paris.read");
    return json({
      ok: true,
      api_version: "1.0",
      service: "kobo-vault",
      release: env.APP_VERSION || APP_RELEASE,
      capabilities: ["library", "library_search", "agent_export"]
    });
  }
  if (path === "/api/v1/account" && request.method === "GET") {
    requireApiScope(client, "paris.read");
    return v1Account(env, client);
  }
  if (path === "/api/v1/search" && request.method === "GET") {
    requireApiScope(client, "paris.read");
    return v1Search(env, client, url);
  }
  if (path === "/api/v1/library/manifest" && request.method === "GET") {
    requireApiScope(client, "paris.read");
    return v1Manifest(env, client, url);
  }
  const downloadJobMatch = path.match(/^\/api\/v1\/library\/([^/]+)\/download-jobs$/);
  if (downloadJobMatch && request.method === "POST") {
    requireApiScope(client, "paris.jobs.create");
    return v1CreateDownloadJob(request, env, client, decodeURIComponent(downloadJobMatch[1]));
  }
  const jobMatch = path.match(/^\/api\/v1\/jobs\/([A-Za-z0-9_-]+)$/);
  if (jobMatch && request.method === "GET") {
    requireApiScope(client, "paris.read");
    return v1GetJob(env, client, jobMatch[1]);
  }
  throw new HttpError(404, "not_found", "Route API v1 inconnue");
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), min), max) : fallback;
}

function encodeCursor(offset) {
  const raw = JSON.stringify({ o: Math.max(0, Number(offset) || 0) });
  return btoa(raw).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function decodeCursor(value) {
  if (!value) return 0;
  try {
    const normalized = String(value).replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    const parsed = JSON.parse(atob(padded));
    const n = Number(parsed?.o);
    if (!Number.isInteger(n) || n < 0 || n > 10_000_000) throw new Error("bad cursor");
    return n;
  } catch {
    throw new HttpError(400, "invalid_request", "Curseur invalide");
  }
}

function safeJsonParse(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function compactText(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function bearerToken(request) {
  const auth = request.headers.get("Authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m || m[1].length < 20 || m[1].length > 500) throw new HttpError(401, "unauthorized", "Bearer token absent ou invalide");
  return m[1];
}

async function optionalApiClient(request, env) {
  if (!request.headers.get("Authorization")) return null;
  return authenticateApiClient(request, env);
}

async function authenticateApiClient(request, env) {
  const tokenHash = await sha256Hex(bearerToken(request));
  const row = await env.KOBO_VAULT.prepare(
    "SELECT id, uid_hash, label, scopes_json FROM api_tokens WHERE token_hash = ? AND revoked_at IS NULL"
  ).bind(tokenHash).first();
  if (!row) throw new HttpError(401, "unauthorized", "Bearer token invalide");
  const scopes = safeJsonParse(row.scopes_json, []);
  // Best effort: failure to update telemetry must not break a read request.
  await env.KOBO_VAULT.prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").bind(new Date().toISOString(), row.id).run().catch(() => {});
  return { ...row, scopes: Array.isArray(scopes) ? scopes : [] };
}

function requireApiScope(client, scope) {
  if (!client?.scopes?.includes(scope)) throw new HttpError(403, "forbidden", `Scope requis: ${scope}`);
}

async function authenticateAgent(request, env) {
  const tokenHash = await sha256Hex(bearerToken(request));
  const row = await env.KOBO_VAULT.prepare(
    "SELECT id, uid_hash, name, capabilities_json FROM agents WHERE token_hash = ? AND revoked_at IS NULL"
  ).bind(tokenHash).first();
  if (!row) throw new HttpError(401, "unauthorized", "Token agent invalide");
  return { ...row, capabilities: safeJsonParse(row.capabilities_json, []) };
}

function generateApiSecret(prefix) {
  return `${prefix}_${randomHex(32)}`;
}

function generatePairCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8); crypto.getRandomValues(bytes);
  return [...bytes].map(x => alphabet[x % alphabet.length]).join("");
}


async function v2CreateApiToken(request, env, uidHash) {
  await authenticateVault(request, env, uidHash);
  const body = await readJson(request);
  const label = compactText(body.label || "Kobo API consumer", 80) || "Kobo API consumer";
  const requested = Array.isArray(body.scopes) ? body.scopes.map(String) : [...API_V2_DEFAULT_SCOPES];
  const scopes = [...new Set(requested.filter(x => API_V2_SCOPES.has(x)))];
  if (!scopes.length) throw new HttpError(400, "invalid_request", "Au moins un scope API v2 est requis");
  const token = generateApiSecret("kvt");
  const tokenHash = await sha256Hex(token);
  const id = `pat_${randomHex(12)}`;
  const now = new Date().toISOString();
  await env.KOBO_VAULT.prepare(
    "INSERT INTO api_tokens(id, uid_hash, token_hash, label, scopes_json, created_at) VALUES(?, ?, ?, ?, ?, ?)"
  ).bind(id, uidHash, tokenHash, label, JSON.stringify(scopes), now).run();
  return json({ token: { id, label, scopes, value: token, created_at: now } }, 201, { "Cache-Control": "private, no-store" });
}

function bytesToBase64Url(bytes) {
  let raw = "";
  for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const normalized = String(value || "").replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const raw = atob(padded);
  return Uint8Array.from(raw, ch => ch.charCodeAt(0));
}

async function serverCredentialKey(env) {
  const secret = String(env.KOBO_API_CREDENTIAL_KEY || "");
  if (secret.length < 32) throw new HttpError(503, "acquisition_bridge_not_configured", "Le secret KOBO_API_CREDENTIAL_KEY doit être configuré dans Cloudflare pour publier un accès d’acquisition.");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name:"AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptApiCredentials(env, uidHash, value) {
  const key = await serverCredentialKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = new TextEncoder().encode(`kobo-vault-api-credentials:${uidHash}`);
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const encrypted = await crypto.subtle.encrypt({ name:"AES-GCM", iv, additionalData:aad }, key, plaintext);
  return { iv:bytesToBase64Url(iv), ciphertext:bytesToBase64Url(new Uint8Array(encrypted)) };
}

async function decryptApiCredentials(env, uidHash, row) {
  const key = await serverCredentialKey(env);
  const aad = new TextEncoder().encode(`kobo-vault-api-credentials:${uidHash}`);
  try {
    const plain = await crypto.subtle.decrypt({ name:"AES-GCM", iv:base64UrlToBytes(row.iv), additionalData:aad }, key, base64UrlToBytes(row.ciphertext));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new HttpError(500, "acquisition_credentials_unreadable", "Les credentials d’acquisition publiés ne peuvent plus être déchiffrés. Republiez-les depuis Kobo Vault.");
  }
}

async function v2AcquisitionAccessStatus(request, env, uidHash) {
  await authenticateVault(request, env, uidHash);
  const row = await env.KOBO_VAULT.prepare("SELECT updated_at FROM kobo_api_credentials WHERE uid_hash = ?").bind(uidHash).first();
  return json({ enabled:Boolean(row), updated_at:row?.updated_at || null, server_key_configured:String(env.KOBO_API_CREDENTIAL_KEY || "").length >= 32 });
}

async function v2PutAcquisitionAccess(request, env, uidHash) {
  await authenticateVault(request, env, uidHash);
  const body = await readJson(request);
  const accessToken = compactText(body.accessToken, 10000);
  const refreshToken = compactText(body.refreshToken, 10000);
  if (accessToken.length < 10) throw new HttpError(400, "invalid_access_token", "Access token Kobo invalide");
  const bundle = {
    accessToken,
    refreshToken,
    appVersion:compactText(body.appVersion || DEFAULT_KOBO_APP_VERSION, 80),
    userId:compactText(body.userId, 300),
    deviceId:compactText(body.deviceId, 300),
    serialNumber:compactText(body.serialNumber, 300)
  };
  const encrypted = await encryptApiCredentials(env, uidHash, bundle);
  const now = new Date().toISOString();
  await env.KOBO_VAULT.prepare(
    "INSERT INTO kobo_api_credentials(uid_hash, iv, ciphertext, updated_at) VALUES(?, ?, ?, ?) ON CONFLICT(uid_hash) DO UPDATE SET iv=excluded.iv, ciphertext=excluded.ciphertext, updated_at=excluded.updated_at"
  ).bind(uidHash, encrypted.iv, encrypted.ciphertext, now).run();
  await resetLibrarySyncBackoff(env, uidHash);
  return json({ ok:true, enabled:true, updated_at:now });
}

async function v2DeleteAcquisitionAccess(request, env, uidHash) {
  await authenticateVault(request, env, uidHash);
  await env.KOBO_VAULT.prepare("DELETE FROM kobo_api_credentials WHERE uid_hash = ?").bind(uidHash).run();
  return json({ ok:true });
}

async function loadApiKoboCredentials(env, uidHash) {
  const row = await env.KOBO_VAULT.prepare("SELECT iv, ciphertext, updated_at FROM kobo_api_credentials WHERE uid_hash = ?").bind(uidHash).first();
  if (!row) throw new HttpError(409, "acquisition_access_not_published", "L’accès d’acquisition Kobo n’est pas publié. Activez-le explicitement depuis Kobo Vault.");
  return { bundle:await decryptApiCredentials(env, uidHash, row), updatedAt:row.updated_at };
}

async function storeRefreshedApiKoboCredentials(env, uidHash, bundle) {
  const encrypted = await encryptApiCredentials(env, uidHash, bundle);
  const now = new Date().toISOString();
  await env.KOBO_VAULT.prepare("UPDATE kobo_api_credentials SET iv=?, ciphertext=?, updated_at=? WHERE uid_hash=?")
    .bind(encrypted.iv, encrypted.ciphertext, now, uidHash).run();
}

function validSyncTimestamp(value, nowMs = Date.now()) {
  const ms = Date.parse(String(value || ""));
  if (!Number.isFinite(ms)) return null;
  // Do not allow a bad client clock to suppress refreshes indefinitely.
  return new Date(Math.min(ms, nowMs + 5 * 60 * 1000)).toISOString();
}

async function ensureLibrarySyncStateRow(env, uidHash) {
  const now = new Date().toISOString();
  await env.KOBO_VAULT.prepare(
    "INSERT OR IGNORE INTO library_sync_state(uid_hash, last_success_at, last_attempt_at, last_error, refresh_started_at, updated_at) VALUES(?, NULL, NULL, NULL, NULL, ?)"
  ).bind(uidHash, now).run();
}

async function readLibrarySyncState(env, uidHash) {
  await ensureLibrarySyncStateRow(env, uidHash);
  return env.KOBO_VAULT.prepare(
    "SELECT last_success_at, last_attempt_at, last_error, refresh_started_at, updated_at FROM library_sync_state WHERE uid_hash = ?"
  ).bind(uidHash).first();
}

async function markLibrarySyncSuccess(env, uidHash, successAt = new Date().toISOString(), { replace = false } = {}) {
  await ensureLibrarySyncStateRow(env, uidHash);
  const now = new Date().toISOString();
  const normalized = validSyncTimestamp(successAt) || now;
  if (replace) {
    await env.KOBO_VAULT.prepare(
      "UPDATE library_sync_state SET last_success_at = ?, last_error = NULL, refresh_started_at = NULL, updated_at = ? WHERE uid_hash = ?"
    ).bind(normalized, now, uidHash).run();
    return;
  }
  await env.KOBO_VAULT.prepare(
    "UPDATE library_sync_state SET last_success_at = CASE WHEN last_success_at IS NULL OR last_success_at < ? THEN ? ELSE last_success_at END, last_error = NULL, refresh_started_at = NULL, updated_at = ? WHERE uid_hash = ?"
  ).bind(normalized, normalized, now, uidHash).run();
}

async function markLibrarySyncFailure(env, uidHash, error) {
  await ensureLibrarySyncStateRow(env, uidHash);
  const now = new Date().toISOString();
  const message = compactText(error instanceof HttpError ? `${error.code}: ${error.message}` : safeError(error), 1000) || "library_refresh_failed";
  await env.KOBO_VAULT.prepare(
    "UPDATE library_sync_state SET last_error = ?, refresh_started_at = NULL, updated_at = ? WHERE uid_hash = ?"
  ).bind(message, now, uidHash).run();
}

function timestampIsWithin(value, windowMs, nowMs = Date.now()) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) && ms >= nowMs - windowMs;
}

async function acquireLibraryRefreshLock(env, uidHash, nowMs = Date.now()) {
  await ensureLibrarySyncStateRow(env, uidHash);
  const now = new Date(nowMs).toISOString();
  const staleBefore = new Date(nowMs - LIBRARY_SYNC_LOCK_MS).toISOString();
  const result = await env.KOBO_VAULT.prepare(
    "UPDATE library_sync_state SET refresh_started_at = ?, last_attempt_at = ?, updated_at = ? WHERE uid_hash = ? AND (refresh_started_at IS NULL OR refresh_started_at < ?)"
  ).bind(now, now, now, uidHash, staleBefore).run();
  return Number(result?.meta?.changes || 0) > 0;
}

async function resetLibrarySyncBackoff(env, uidHash) {
  await ensureLibrarySyncStateRow(env, uidHash);
  await env.KOBO_VAULT.prepare(
    "UPDATE library_sync_state SET last_attempt_at = NULL, last_error = NULL, refresh_started_at = NULL, updated_at = ? WHERE uid_hash = ?"
  ).bind(new Date().toISOString(), uidHash).run();
}

async function v1CreateApiToken(request, env, uidHash) {
  await authenticateVault(request, env, uidHash);
  const body = await readJson(request);
  const label = compactText(body.label || "Paris Library", 80) || "Paris Library";
  const requested = Array.isArray(body.scopes) ? body.scopes.map(String) : ["paris.read", "paris.jobs.create"];
  const scopes = [...new Set(requested.filter(x => API_ALLOWED_PARIS_SCOPES.has(x)))];
  if (!scopes.includes("paris.read")) scopes.unshift("paris.read");
  const token = generateApiSecret("kvp");
  const tokenHash = await sha256Hex(token);
  const id = `pat_${randomHex(12)}`;
  const now = new Date().toISOString();
  await env.KOBO_VAULT.prepare(
    "INSERT INTO api_tokens(id, uid_hash, token_hash, label, scopes_json, created_at) VALUES(?, ?, ?, ?, ?, ?)"
  ).bind(id, uidHash, tokenHash, label, JSON.stringify(scopes), now).run();
  return json({ token: { id, label, scopes, value: token, created_at: now } }, 201, { "Cache-Control": "private, no-store" });
}

async function v1ListApiTokens(request, env, uidHash) {
  await authenticateVault(request, env, uidHash);
  const rows = await env.KOBO_VAULT.prepare(
    "SELECT id, label, scopes_json, created_at, last_used_at FROM api_tokens WHERE uid_hash = ? AND revoked_at IS NULL ORDER BY created_at DESC"
  ).bind(uidHash).all();
  return json({ items: (rows.results || []).map(r => ({ id:r.id, label:r.label, scopes:safeJsonParse(r.scopes_json, []), created_at:r.created_at, last_used_at:r.last_used_at || null })) });
}

async function v1RevokeApiToken(request, env, uidHash, tokenId) {
  await authenticateVault(request, env, uidHash);
  const result = await env.KOBO_VAULT.prepare(
    "UPDATE api_tokens SET revoked_at = ? WHERE uid_hash = ? AND id = ? AND revoked_at IS NULL"
  ).bind(new Date().toISOString(), uidHash, tokenId).run();
  if (!result.meta?.changes) throw new HttpError(404, "not_found", "Token API introuvable");
  return json({ ok: true });
}

async function v1DeleteProjection(request, env, uidHash) {
  await authenticateVault(request, env, uidHash);
  await env.KOBO_VAULT.batch([
    env.KOBO_VAULT.prepare("DELETE FROM library_projection WHERE uid_hash = ?").bind(uidHash),
    env.KOBO_VAULT.prepare("DELETE FROM account_projection WHERE uid_hash = ?").bind(uidHash),
    env.KOBO_VAULT.prepare("DELETE FROM library_sync_state WHERE uid_hash = ?").bind(uidHash)
  ]);
  return json({ ok:true });
}

async function v1ProjectionStatus(request, env, uidHash) {
  await authenticateVault(request, env, uidHash);
  const row = await env.KOBO_VAULT.prepare(
    "SELECT COUNT(*) AS count, MAX(updated_at) AS updated_at FROM library_projection WHERE uid_hash = ?"
  ).bind(uidHash).first();
  const account = await env.KOBO_VAULT.prepare(
    "SELECT account_id, display_name, email_hint, updated_at FROM account_projection WHERE uid_hash = ?"
  ).bind(uidHash).first();
  const sync = await readLibrarySyncState(env, uidHash);
  return json({
    count: Number(row?.count || 0),
    updated_at: row?.updated_at || null,
    account: account || null,
    sync: sync ? {
      last_success_at: sync.last_success_at || null,
      last_attempt_at: sync.last_attempt_at || null,
      last_error: sync.last_error || null,
      refreshing: Boolean(sync.refresh_started_at)
    } : null
  });
}

export function normalizeProjectionItem(raw) {
  const productId = compactText(raw.product_id ?? raw.productId ?? raw.revision_id ?? raw.revisionId, 200);
  if (!productId) return null;
  const authors = Array.isArray(raw.authors) ? raw.authors.map(x => compactText(x, 200)).filter(Boolean).slice(0, 20) : [];
  const contentType = compactText(raw.content_type ?? raw.contentType ?? raw.mediaType ?? "ebook", 40) || "ebook";
  const format = compactText(raw.format || (contentType === "ebook" ? "EPUB" : ""), 40);
  return {
    productId,
    revisionId: compactText(raw.revision_id ?? raw.revisionId, 200),
    isbn: compactText(raw.isbn, 64),
    title: compactText(raw.title || "(sans titre)", 500) || "(sans titre)",
    authors,
    language: compactText(raw.language, 40),
    publisher: compactText(raw.publisher, 300),
    publicationDate: compactText(raw.publication_date ?? raw.publicationDate, 80),
    description: compactText(raw.description, 2000),
    coverUrl: compactText(raw.cover_url ?? raw.coverUrl, 1200),
    productUrl: compactText(raw.product_url ?? raw.productUrl ?? raw.koboUrl, 1200),
    format,
    contentType,
    downloadable: raw.downloadable === true || raw.downloadable === 1,
    archived: raw.archived === true || raw.archived === 1
  };
}

async function writeLibraryProjection(env, uidHash, items, account = null, now = new Date().toISOString()) {
  const generation = `gen_${randomHex(12)}`;
  if (account) {
    const accountId = compactText(account.id || `vault:${uidHash}`, 200) || `vault:${uidHash}`;
    const displayName = compactText(account.display_name ?? account.displayName ?? "Compte Kobo", 200) || "Compte Kobo";
    const emailHint = compactText(account.email_hint ?? account.emailHint, 200) || null;
    await env.KOBO_VAULT.prepare(
      "INSERT INTO account_projection(uid_hash, account_id, display_name, email_hint, updated_at) VALUES(?, ?, ?, ?, ?) ON CONFLICT(uid_hash) DO UPDATE SET account_id=excluded.account_id, display_name=excluded.display_name, email_hint=excluded.email_hint, updated_at=excluded.updated_at"
    ).bind(uidHash, accountId, displayName, emailHint, now).run();
  }
  for (let i = 0; i < items.length; i += 50) {
    const stmts = items.slice(i, i + 50).map(item => env.KOBO_VAULT.prepare(
      "INSERT INTO library_projection(uid_hash, product_id, revision_id, isbn, title, authors_json, language, publisher, publication_date, description, cover_url, product_url, format, content_type, downloadable, archived, generation, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(uid_hash, product_id) DO UPDATE SET revision_id=excluded.revision_id, isbn=excluded.isbn, title=excluded.title, authors_json=excluded.authors_json, language=excluded.language, publisher=excluded.publisher, publication_date=excluded.publication_date, description=excluded.description, cover_url=excluded.cover_url, product_url=excluded.product_url, format=excluded.format, content_type=excluded.content_type, downloadable=excluded.downloadable, archived=excluded.archived, generation=excluded.generation, updated_at=excluded.updated_at"
    ).bind(uidHash, item.productId, item.revisionId, item.isbn, item.title, JSON.stringify(item.authors), item.language, item.publisher, item.publicationDate, item.description, item.coverUrl, item.productUrl, item.format, item.contentType, item.downloadable ? 1 : 0, item.archived ? 1 : 0, generation, now));
    if (stmts.length) await env.KOBO_VAULT.batch(stmts);
  }
  await env.KOBO_VAULT.prepare("DELETE FROM library_projection WHERE uid_hash = ? AND generation <> ?").bind(uidHash, generation).run();
  return { count:items.length, updatedAt:now };
}

async function v1PutProjection(request, env, uidHash) {
  await authenticateVault(request, env, uidHash);
  const body = await readJson(request);
  const input = Array.isArray(body.items) ? body.items : [];
  if (input.length > API_MAX_PROJECTION_ITEMS) throw new HttpError(413, "invalid_request", `Projection limitée à ${API_MAX_PROJECTION_ITEMS} éléments`);
  const items = input.map(normalizeProjectionItem).filter(Boolean);
  const now = new Date().toISOString();
  const account = body.account && typeof body.account === "object" ? body.account : {};
  const written = await writeLibraryProjection(env, uidHash, items, account, now);
  const sourceSyncAt = validSyncTimestamp(body.source_sync_at ?? body.sourceSyncAt);
  if (sourceSyncAt) await markLibrarySyncSuccess(env, uidHash, sourceSyncAt, { replace:true });
  return json({ ok:true, count:written.count, updated_at:written.updatedAt });
}

export function projectionRowToApi(row) {
  return {
    product_id: row.product_id,
    revision_id: row.revision_id || null,
    title: row.title,
    authors: safeJsonParse(row.authors_json, []),
    publisher: row.publisher || null,
    publication_date: row.publication_date || null,
    description: row.description || null,
    cover_url: row.cover_url || null,
    product_url: row.product_url || null,
    format: row.format || null,
    content_type: row.content_type || "ebook",
    collection: "library",
    owned: true,
    downloadable: Boolean(row.downloadable),
    isbn: row.isbn || null,
    language: row.language || null,
    archived: Boolean(row.archived),
    price: null
  };
}


function hasApiScope(client, scope) {
  return Boolean(client?.scopes?.includes(scope));
}

async function v2Status(env, client) {
  const details = [
    { id:"catalog_search", access:"authenticated", scope:"kobo.catalog.read", available:true },
    { id:"library_search", access:"authenticated", scope:"kobo.library.read", available:true },
    { id:"library_manifest", access:"authenticated", scope:"kobo.library.read", available:true },
    { id:"acquisition_info", access:"authenticated", scope:"kobo.acquisition.read", available:true },
    { id:"acquisition_drm_metadata", access:"authenticated", scope:"kobo.acquisition.read", available:true },
    { id:"acquisition_display_profiles", access:"authenticated", scope:"kobo.acquisition.read", available:true },
    { id:"acquisition_acsm_export", access:"authenticated", scope:"kobo.acquisition.read", available:true },
    { id:"acquisition_library_sync", access:"authenticated", scope:"kobo.acquisition.read", available:true },
    { id:"acquisition_delegation", access:"authenticated", scope:"kobo.acquisition.delegate", available:true }
  ];
  const capabilities = client
    ? details.filter(x => hasApiScope(client, x.scope)).map(x => x.id)
    : details.map(x => x.id);
  let acquisitionAccess = "unknown";
  if (client && (hasApiScope(client, "kobo.acquisition.read") || hasApiScope(client, "kobo.acquisition.delegate"))) {
    const row = await env.KOBO_VAULT.prepare("SELECT 1 AS ok FROM kobo_api_credentials WHERE uid_hash = ?").bind(client.uid_hash).first();
    acquisitionAccess = row ? "configured" : "not_configured";
  }
  return json({
    ok:true,
    api_version:"2.3",
    contract_revision:"2.3.3",
    acquisition_schema_version:"1.4",
    service:"kobo-vault",
    release:env.APP_VERSION || APP_RELEASE,
    role:"kobo-library-provider",
    authentication:{
      type:"bearer",
      token_prefix:"kvt_",
      required_for_private_capabilities:true
    },
    capabilities,
    capability_details:details,
    acquisition_access:acquisitionAccess
  }, 200, { "Cache-Control":"no-store" });
}

async function v2LibraryBook(env, client, productId) {
  await ensureFreshLibraryProjection(env, client.uid_hash);
  const row = await env.KOBO_VAULT.prepare("SELECT * FROM library_projection WHERE uid_hash = ? AND product_id = ?")
    .bind(client.uid_hash, productId).first();
  if (!row) throw new HttpError(404, "not_found", "Livre absent de la bibliothèque Kobo publiée");
  return json({ item:projectionRowToApi(row) });
}

export function normalizeCoverUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const candidate = raw.startsWith("//") ? `https:${raw}` : raw;
  try {
    const u = new URL(candidate);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "";
    return u.toString();
  } catch {
    return "";
  }
}

export function coverUrlForBook(book) {
  const direct = normalizeCoverUrl(book?.coverUrl);
  if (direct) return direct;
  return book?.coverImageId ? `https://cdn.kobo.com/book-images/${encodeURIComponent(book.coverImageId)}/300/450/90/false/image.jpg` : null;
}

export function v2CatalogItem(book, ownedRow = null) {
  const owned = Boolean(ownedRow);
  const mediaType = book.mediaType || "ebook";
  return {
    product_id:book.productId || null,
    revision_id:book.revisionId || null,
    isbn:book.isbn || null,
    title:book.title || "",
    subtitle:book.subtitle || null,
    authors:Array.isArray(book.authors) ? book.authors : [],
    subjects:Array.isArray(book.subjects) ? book.subjects : [],
    publisher:book.publisher || null,
    publication_date:book.publicationDate || null,
    description:book.description || null,
    language:book.language || null,
    series:book.series || null,
    cover_url:coverUrlForBook(book),
    product_url:book.koboUrl || null,
    format:mediaType === "ebook" ? "EPUB" : null,
    content_type:mediaType,
    collection:owned ? "library" : "catalog",
    owned,
    downloadable:owned ? Boolean(ownedRow.downloadable) : false,
    archived:owned ? Boolean(ownedRow.archived) : false,
    price:book.price || null
  };
}

function apiSearchField(url) {
  const field = String(url.searchParams.get("field") || "all").toLowerCase();
  if (!["all","title","author","isbn","subject"].includes(field)) {
    throw new HttpError(400, "invalid_request", "field doit valoir all, title, author, isbn ou subject");
  }
  return field;
}

function normalizedSearchText(value) {
  return normalizeCachePart(String(value || ""));
}

function catalogBookMatchesField(book, query, field) {
  if (field === "all") return true;
  const needle = normalizedSearchText(query);
  if (!needle) return true;
  if (field === "title") return normalizedSearchText(book.title).includes(needle);
  if (field === "author") return normalizedSearchText((book.authors || []).join(" ")).includes(needle);
  if (field === "isbn") return normalizedSearchText(book.isbn).includes(needle);
  if (field === "subject") {
    return normalizedSearchText([book.series, book.description, ...(book.subjects || [])].filter(Boolean).join(" ")).includes(needle);
  }
  return true;
}

async function v2LibrarySearch(env, client, url) {
  const q = compactText(url.searchParams.get("q"), 200);
  if (!q) throw new HttpError(400, "invalid_request", "Paramètre q requis");
  const field = apiSearchField(url);
  const limit = clampInt(url.searchParams.get("limit"), 1, 100, 50);
  const offset = decodeCursor(url.searchParams.get("cursor"));
  if (offset === 0) await ensureFreshLibraryProjection(env, client.uid_hash);
  const like = `%${q.replaceAll("!", "!!").replaceAll("%", "!%").replaceAll("_", "!_")}%`;
  let condition = "(title LIKE ? ESCAPE '!' OR authors_json LIKE ? ESCAPE '!' OR isbn LIKE ? ESCAPE '!' OR publisher LIKE ? ESCAPE '!' OR description LIKE ? ESCAPE '!')";
  let args = [like, like, like, like, like];
  if (field === "title") { condition = "title LIKE ? ESCAPE '!'"; args = [like]; }
  if (field === "author") { condition = "authors_json LIKE ? ESCAPE '!'"; args = [like]; }
  if (field === "isbn") { condition = "isbn LIKE ? ESCAPE '!'"; args = [like]; }
  if (field === "subject") { condition = "(title LIKE ? ESCAPE '!' OR description LIKE ? ESCAPE '!' OR publisher LIKE ? ESCAPE '!')"; args = [like, like, like]; }
  const sql = `SELECT * FROM library_projection WHERE uid_hash = ? AND ${condition} ORDER BY title, product_id LIMIT ? OFFSET ?`;
  const rows = await env.KOBO_VAULT.prepare(sql).bind(client.uid_hash, ...args, limit + 1, offset).all();
  const all = rows.results || [];
  const hasMore = all.length > limit;
  return json({
    items:all.slice(0, limit).map(projectionRowToApi),
    field,
    field_mode:field === "subject" ? "best_effort" : "exact_filter",
    next_cursor:hasMore ? encodeCursor(offset + limit) : null
  }, 200, { "Cache-Control":"private, no-store" });
}

async function getAnonymousKoboSession(env) {
  const appVersion = env.KOBO_APP_VERSION || DEFAULT_KOBO_APP_VERSION;
  if (anonymousKoboSession?.auth?.accessToken && anonymousKoboSession.appVersion === appVersion) return anonymousKoboSession;
  const deviceId = randomHex(32);
  const serialNumber = randomHex(16);
  const auth = await authenticateKoboDevice({ userKey:"", deviceId, serialNumber, appVersion });
  anonymousKoboSession = { auth, appVersion };
  return anonymousKoboSession;
}

async function fetchAnonymousCatalog(env, query, language, pageSize, pageIndex) {
  let session = await getAnonymousKoboSession(env);
  let auth = session.auth;
  const init = await getInitialization(auth, session.appVersion);
  auth = init.auth;
  const candidates = [init.resources.products, init.resources.productsv2, `${KOBO_STORE}/v1/products`, `${KOBO_STORE}/v2/products`].filter(Boolean);
  let payload = null;
  let endpoint = "";
  let lastStatus = 0;
  let lastResponse = null;
  for (const candidate of [...new Set(candidates)]) {
    const u = new URL(candidate);
    u.searchParams.set("Query", query);
    u.searchParams.set("PageSize", String(pageSize));
    u.searchParams.set("PageIndex", String(pageIndex));
    if (language) u.searchParams.set("Language", language);
    const out = await koboAuthedFetch(u, auth, session.appVersion);
    auth = out.auth;
    lastStatus = out.response.status;
    lastResponse = out.response;
    if (!out.response.ok) continue;
    try { payload = await out.response.json(); endpoint = u.pathname; break; } catch {}
  }
  anonymousKoboSession = { auth, appVersion:session.appVersion };
  if (payload === null) {
    if (lastResponse) throw koboHttpError("kobo_catalog_failed", lastResponse, "Kobo catalog search failed", { unauthorizedStatus:401 });
    throw new HttpError(502, "kobo_catalog_failed", `Kobo catalog search failed (${lastStatus || "no response"})`);
  }
  return { items:extractCatalogBooks(payload), endpoint, pageInfo:extractPageInfo(payload) };
}

async function v2CatalogSearch(env, client, url, ctx) {
  const q = compactText(url.searchParams.get("q"), 200);
  if (q.length < 2) throw new HttpError(400, "invalid_request", "Paramètre q requis (2 caractères minimum)");
  const field = apiSearchField(url);
  const language = compactText(url.searchParams.get("language"), 20).toLowerCase();
  const limit = clampInt(url.searchParams.get("limit"), 1, 100, 50);
  const page = clampInt(url.searchParams.get("page"), 0, 10000, 0);
  const ttl = Math.min(Math.max(Number(env.CATALOG_CACHE_TTL_SECONDS) || 86400, 300), 604800);
  const cache = globalThis.caches?.default;
  const cacheUrl = new URL("https://kobo-vault.invalid/__v2_catalog_v3");
  cacheUrl.search = new URLSearchParams({ q:normalizeCachePart(q), field, language, limit:String(limit), page:String(page) }).toString();
  const cacheKey = new Request(cacheUrl.toString());
  let publicResult = null;
  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) publicResult = await hit.json();
  }
  if (!publicResult) {
    const fetched = await fetchAnonymousCatalog(env, q, language, limit, page);
    publicResult = { items:fetched.items, endpoint:fetched.endpoint, page_info:fetched.pageInfo };
    if (cache) {
      const put = cache.put(cacheKey, json(publicResult, 200, { "Cache-Control":`public, max-age=${ttl}` }));
      if (ctx?.waitUntil) ctx.waitUntil(put); else await put;
    }
  }
  const ownedRows = await env.KOBO_VAULT.prepare("SELECT product_id, revision_id, isbn, downloadable, archived FROM library_projection WHERE uid_hash = ?")
    .bind(client.uid_hash).all();
  const ownedById = new Map();
  for (const row of ownedRows.results || []) {
    if (row.product_id) ownedById.set(String(row.product_id), row);
    if (row.revision_id) ownedById.set(String(row.revision_id), row);
    if (row.isbn) ownedById.set(String(row.isbn), row);
  }
  const filtered = (publicResult.items || []).filter(book => catalogBookMatchesField(book, q, field));
  const items = filtered.map(book => {
    const ownedRow = ownedById.get(String(book.productId || "")) || ownedById.get(String(book.revisionId || "")) || ownedById.get(String(book.isbn || "")) || null;
    return v2CatalogItem(book, ownedRow);
  });
  return json({
    items,
    field,
    field_mode:field === "all" ? "upstream" : (field === "subject" ? "best_effort_post_filter" : "post_filter"),
    page,
    count:items.length,
    page_info:publicResult.page_info || {},
    next_page:(publicResult.items || []).length >= limit ? page + 1 : null
  });
}

function sanitizeKoboDownloadUrl(value) {
  try {
    const u = new URL(String(value || ""));
    if (u.protocol !== "https:") return "";
    const host = u.hostname.toLowerCase();
    // Kobo clients drop the legacy `b` parameter on Kobo download URLs, but a
    // pre-signed S3 URL must not be rewritten because any query mutation can
    // invalidate its signature.
    const isAmazonS3 = host === "amazonaws.com" || host.endsWith(".amazonaws.com");
    if (!isAmazonS3) u.searchParams.delete("b");
    return u.toString();
  } catch { return ""; }
}

function classifyKoboDrm(rawType) {
  const raw = compactText(rawType || "unknown", 80) || "unknown";
  const normalized = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (["signednodrm","none","nodrm","drmfree"].includes(normalized)) {
    return { family:"none", protected:false, raw_type:raw };
  }
  if (normalized === "kdrm" || normalized.includes("kobodrm")) {
    return { family:"kobo_kdrm", protected:true, raw_type:raw };
  }
  if (normalized.includes("adobe")) {
    return { family:"adobe_adept", protected:true, raw_type:raw };
  }
  return { family:"unknown", protected:true, raw_type:raw };
}

function normalizeKoboMediaFormat(rawFormat) {
  const raw = compactText(rawFormat || "unknown", 80) || "unknown";
  const upper = raw.toUpperCase();
  if (upper === "KEPUB" || upper.includes("KEPUB")) return { media_format:"kepub", raw_format:raw };
  if (upper === "PDF" || upper.includes("PDF")) return { media_format:"pdf", raw_format:raw };
  if (upper === "ACSM" || upper.includes("ACSM")) return { media_format:"acsm", raw_format:raw };
  if (upper === "FLEPUB" || upper.startsWith("EPUB")) return { media_format:"epub", raw_format:raw };
  return { media_format:"unknown", raw_format:raw };
}

function acquisitionHandling(kind, drmFamily) {
  if (kind === "acsm") return "adobe_adept";
  if (drmFamily === "none") return "http_plain";
  if (drmFamily === "adobe_adept") return "adobe_adept";
  if (drmFamily === "kobo_kdrm") return "kobo_kdrm";
  return "unknown";
}

function contentKeySummary(payload) {
  const keys = Array.isArray(payload?.ContentKeys) ? payload.ContentKeys : [];
  return {
    present:keys.length > 0,
    count:keys.length,
    values_exposed:false
  };
}

function contentUrlRequiresKoboAuthorization(value) {
  try {
    const host = new URL(String(value || "")).hostname.toLowerCase();
    return host === "kobo.com" || host.endsWith(".kobo.com") || host === "kobobooks.com" || host.endsWith(".kobobooks.com");
  } catch { return false; }
}

function koboContentDownloadHeaders() {
  // Kobo content URLs may redirect from storedownloads.kobo.com to requester-pays
  // S3 URLs.  The downstream downloader must preserve this header across that
  // redirect.  It is harmless on non-S3 origins and mirrors current Kobo clients.
  return { "x-amz-request-payer":"requester" };
}

export function normalizeAcquisitionCandidates(payload, displayProfile = "Android", source = "content_access_book") {
  const lists = [
    ...(Array.isArray(payload?.ContentUrls) ? payload.ContentUrls : []),
    ...(Array.isArray(payload?.DownloadUrls) ? payload.DownloadUrls : [])
  ];
  const keySummary = contentKeySummary(payload);
  const out = [];
  const seen = new Set();
  for (const raw of lists) {
    if (!raw || typeof raw !== "object") continue;
    const drm = classifyKoboDrm(raw.DRMType || raw.DrmType || "unknown");
    const fmt = normalizeKoboMediaFormat(raw.UrlFormat || raw.Format || "unknown");
    const kind = fmt.media_format === "acsm" ? "acsm" : "http";
    const urlValues = [raw.DownloadUrl, raw.Url];
    for (const rawUrl of urlValues) {
      const url = sanitizeKoboDownloadUrl(rawUrl);
      if (!url) continue;
      const dedupeKey = `${kind}|${url}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const requiresKoboAuthorization = contentUrlRequiresKoboAuthorization(url);
      out.push({
        kind,
        transport:"https",
        method:"GET",
        url,
        headers:koboContentDownloadHeaders(),
        media_format:fmt.media_format,
        source_format:fmt.raw_format,
        handling:acquisitionHandling(kind, drm.family),
        drm:{
          family:drm.family,
          raw_type:drm.raw_type,
          protected:drm.protected
        },
        kobo:{
          source,
          display_profile:displayProfile,
          content_keys_present:keySummary.present,
          content_key_count:keySummary.count,
          requires_kobo_authorization:requiresKoboAuthorization
        },
        // Compatibilité de transition v2.1 : utiliser les champs structurés ci-dessus.
        drm_type:drm.raw_type,
        format:fmt.raw_format,
        protected:drm.protected
      });
      if (out.length >= API_ACQUISITION_MAX_CANDIDATES) return out;
    }
  }
  return out;
}


function collectBookMetadataFromSyncEvents(events, identifiers) {
  const wanted = new Set((identifiers || []).filter(Boolean).map(String));
  const found = [];
  const seen = new Set();
  const walk = (node, depth = 0) => {
    if (!node || typeof node !== "object" || depth > 12 || seen.has(node)) return;
    seen.add(node);
    if (!Array.isArray(node) && node.BookMetadata && typeof node.BookMetadata === "object") {
      const meta = node.BookMetadata;
      const ids = [meta.CrossRevisionId, meta.RevisionId, meta.ProductId, meta.Id].filter(Boolean).map(String);
      if (ids.some(id => wanted.has(id))) found.push(meta);
    }
    if (Array.isArray(node)) node.forEach(x => walk(x, depth + 1));
    else Object.values(node).forEach(x => walk(x, depth + 1));
  };
  for (const event of events || []) walk(event);
  return found;
}

export function normalizeLibrarySyncCandidates(events, identifiers, contentAccessPayload, displayProfile = "Android") {
  const metas = collectBookMetadataFromSyncEvents(events, identifiers);
  const keySummary = contentKeySummary(contentAccessPayload || {});
  const out = [];
  for (const meta of metas) {
    const filtered = (Array.isArray(meta.DownloadUrls) ? meta.DownloadUrls : []).filter(raw => {
      const format = String(raw?.Format || raw?.UrlFormat || "").toUpperCase();
      return !format.includes("SAMPLE");
    });
    if (!filtered.length) continue;
    const normalized = normalizeAcquisitionCandidates({ DownloadUrls:filtered, ContentKeys:contentAccessPayload?.ContentKeys || [] }, null, "library_sync");
    for (const candidate of normalized) {
      const raw = filtered.find(x => sanitizeKoboDownloadUrl(x?.Url || x?.DownloadUrl) === candidate.url);
      if (raw?.Platform) candidate.kobo.platform = String(raw.Platform);
      out.push(candidate);
    }
  }
  return dedupeLibrarySyncCandidates(out);
}

export function dedupeLibrarySyncCandidates(candidates) {
  const out = [];
  const seen = new Set();
  for (const candidate of candidates || []) {
    if (!candidate?.url) continue;
    const platform = String(candidate?.kobo?.platform || "").toLowerCase();
    const key = [candidate.handling || "", candidate?.drm?.family || "", candidate.media_format || "", candidate.source_format || "", platform].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
    if (out.length >= API_ACQUISITION_MAX_CANDIDATES) break;
  }
  return out;
}

async function resolveLibrarySyncAcquisitionCandidates(env, uidHash, content, productId, revisionId) {
  const identifiers = [...new Set([productId, revisionId, content?.usedIdentifier].filter(Boolean))];
  const sync = await fetchLibrarySyncDiagnosticRun(content.resources || {}, content.auth, content.appVersion, "");
  content.auth = sync.auth || content.auth;
  if (sync.refreshed) {
    const updated = { ...content.bundle, accessToken:content.auth.accessToken, refreshToken:content.auth.refreshToken || content.bundle.refreshToken || "", appVersion:content.appVersion };
    await storeRefreshedApiKoboCredentials(env, uidHash, updated);
  }
  return {
    candidates:normalizeLibrarySyncCandidates(sync.events, identifiers, content.payload, content.displayProfile || "Android"),
    auth:sync.auth || content.auth,
    refreshed:Boolean(sync.refreshed),
    pages:sync.pages?.length || 0,
    event_count:sync.events?.length || 0
  };
}


function sanitizeAcsmUrl(value, base = undefined) {
  try {
    const raw = decodeHtml(String(value || "").trim());
    const u = base ? new URL(raw, base) : new URL(raw);
    if (u.protocol !== "https:") return "";
    return u.toString();
  } catch { return ""; }
}

function looksLikeAcsmUrl(value, base = undefined) {
  const url = sanitizeAcsmUrl(value, base);
  if (!url) return false;
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    const host = u.hostname.toLowerCase();
    if (path.endsWith(".acsm") || path.includes("urllink.acsm")) return true;
    if (/^acs\d*\.(?:kobo|kobobooks)\.com$/.test(host) && path.includes("/fulfillment/")) return true;
    return false;
  } catch { return false; }
}

export function extractAcsmUrls(payload, base = undefined) {
  const found = [];
  const seen = new Set();
  let visited = 0;
  const add = (value) => {
    const url = sanitizeAcsmUrl(value, base);
    if (!url || !looksLikeAcsmUrl(url) || seen.has(url)) return;
    seen.add(url);
    found.push(url);
  };
  const walk = (node, depth = 0) => {
    if (found.length >= 8 || visited++ > 500 || depth > 8 || node === null || node === undefined) return;
    if (typeof node === "string") {
      add(node);
      const text = decodeHtml(node);
      const matches = text.match(/https:\/\/[^\s"'<>\\]+/gi) || [];
      for (const match of matches) add(match.replace(/[),.;]+$/g, ""));
      return;
    }
    if (Array.isArray(node)) {
      for (const value of node) walk(value, depth + 1);
      return;
    }
    if (typeof node === "object") {
      for (const value of Object.values(node)) walk(value, depth + 1);
    }
  };
  walk(payload);
  return found;
}

function isAcsmContentType(value) {
  const type = String(value || "").toLowerCase();
  return type.includes("adobe.adept") || type.includes("application/acsm") || type.includes("application/vnd.adobe");
}

function koboAcsmCandidate(url, { authRequired = false, lookupShape = null } = {}) {
  const safe = sanitizeAcsmUrl(url);
  if (!safe) return null;
  return {
    kind:"acsm",
    transport:"https",
    method:"GET",
    url:safe,
    headers:{},
    media_format:"acsm",
    source_format:"ACSM",
    handling:"adobe_adept",
    drm:{ family:"adobe_adept", raw_type:"AdobeDrm", protected:true },
    kobo:{
      source:"library_download_link",
      display_profile:null,
      content_keys_present:false,
      content_key_count:0,
      requires_kobo_authorization:Boolean(authRequired),
      lookup_shape:lookupShape
    },
    // Compatibilité de transition v2.1.
    drm_type:"AdobeDrm",
    format:"ACSM",
    protected:true
  };
}

function isAllowedKoboApiResource(value) {
  try {
    const u = new URL(String(value || ""));
    const host = u.hostname.toLowerCase();
    return u.protocol === "https:" && (host === "storeapi.kobo.com" || host.endsWith(".kobobooks.com"));
  } catch { return false; }
}

export function buildKoboAcsmLookupAttempts(endpoint, revisionId = "", productId = "") {
  if (!isAllowedKoboApiResource(endpoint)) return [];
  const attempts = [];
  const revision = String(revisionId || "").trim();
  const product = String(productId || "").trim();
  if (revision) {
    const u = new URL(endpoint);
    u.searchParams.set("RevisionId", revision);
    attempts.push({ method:"GET", url:u.toString(), shape:"get_revision_id" });
  }
  if (product && product !== revision) {
    const u = new URL(endpoint);
    u.searchParams.set("ProductId", product);
    attempts.push({ method:"GET", url:u.toString(), shape:"get_product_id" });
  }
  if (revision || product) {
    attempts.push({
      method:"POST",
      url:String(endpoint),
      shape:"post_identifiers",
      body:{ ...(revision ? {RevisionId:revision} : {}), ...(product ? {ProductId:product} : {}) }
    });
  }
  return attempts;
}

async function parseKoboDownloadLinkResponse(response, requestUrl, shape, requestMethod = "GET") {
  const location = response.headers.get("location");
  if (location) {
    const redirected = sanitizeAcsmUrl(location, requestUrl);
    if (redirected && looksLikeAcsmUrl(redirected)) {
      return { candidates:[koboAcsmCandidate(redirected, { lookupShape:shape })], responseKind:"redirect" };
    }
  }
  if (!response.ok) return { candidates:[], responseKind:"error" };

  const contentType = response.headers.get("content-type") || "";
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > 262144) return { candidates:[], responseKind:"oversize" };

  let text = "";
  try { text = await response.text(); } catch { return { candidates:[], responseKind:"unreadable" }; }
  let payload = text;
  if (/json/i.test(contentType) || /^[\s]*[\[{\"]/.test(text)) {
    try { payload = JSON.parse(text); } catch {}
  }
  const urls = extractAcsmUrls(payload, requestUrl);
  if (urls.length) {
    return {
      candidates:urls.map(url => koboAcsmCandidate(url, { lookupShape:shape })).filter(Boolean),
      responseKind:"link"
    };
  }

  // Some Kobo variants may serve the ACSM body directly instead of returning a link.
  // In that case the download-link endpoint itself is a usable candidate, but requires
  // the current Kobo bearer token and therefore becomes directly usable only in delegated mode.
  if (isAcsmContentType(contentType) || /<\s*fulfillmentToken\b/i.test(text) || /<\s*operatorURL\b/i.test(text)) {
    if (requestMethod === "GET") {
      const candidate = koboAcsmCandidate(requestUrl, { authRequired:true, lookupShape:shape });
      return { candidates:candidate ? [candidate] : [], responseKind:"inline_acsm" };
    }
    return { candidates:[], responseKind:"inline_acsm_unrepresentable" };
  }
  return { candidates:[], responseKind:"no_acsm" };
}

async function resolveKoboAcsmExport(env, uidHash, content, productId, revisionId) {
  const endpoint = content?.resources?.get_download_link || "";
  if (!endpoint || !isAllowedKoboApiResource(endpoint)) {
    return {
      candidates:[], auth:content.auth,
      lookup:{ requested:true, status:"resource_unavailable", source:"get_download_link", candidate_count:0, request_shape:null }
    };
  }

  const attempts = buildKoboAcsmLookupAttempts(endpoint, revisionId, productId);
  let auth = content.auth;
  let refreshed = false;
  let hadSuccess = false;
  let lastStatus = 0;
  let matchedShape = null;
  const candidates = [];
  const seen = new Set();

  for (const attempt of attempts) {
    const init = { method:attempt.method, redirect:"manual" };
    if (attempt.body) {
      init.headers = { "Content-Type":"application/json" };
      init.body = JSON.stringify(attempt.body);
    }
    let out;
    try { out = await koboAuthedFetch(attempt.url, auth, content.appVersion, init); }
    catch { continue; }
    auth = out.auth;
    refreshed ||= out.refreshed;
    lastStatus = out.response.status;
    if (out.response.ok || (out.response.status >= 300 && out.response.status < 400)) hadSuccess = true;
    const parsed = await parseKoboDownloadLinkResponse(out.response, attempt.url, attempt.shape, attempt.method);
    for (const candidate of parsed.candidates) {
      if (!candidate || seen.has(candidate.url)) continue;
      seen.add(candidate.url);
      candidates.push(candidate);
    }
    if (parsed.candidates.length) { matchedShape = attempt.shape; break; }
    // Le contrat exact de get_download_link n'est pas public. Même une réponse 200
    // vide peut correspondre à une forme de paramètres ignorée par l'amont : on
    // essaie donc les variantes bornées restantes avant de conclure à l'absence d'ACSM.
  }

  if (refreshed) {
    const bundle = content.bundle;
    const updated = { ...bundle, accessToken:auth.accessToken, refreshToken:auth.refreshToken || bundle.refreshToken || "", appVersion:content.appVersion };
    await storeRefreshedApiKoboCredentials(env, uidHash, updated);
  }

  const status = candidates.length ? "available" : (hadSuccess ? "not_available" : "upstream_error");
  return {
    candidates,
    auth,
    lookup:{
      requested:true,
      status,
      source:"get_download_link",
      candidate_count:candidates.length,
      request_shape:matchedShape,
      ...(status === "upstream_error" && lastStatus ? { upstream_status:lastStatus } : {})
    }
  };
}

function dedupeAcquisitionCandidates(candidates) {
  const out = [];
  const seen = new Set();
  for (const candidate of candidates || []) {
    const key = `${candidate.kind || ""}|${candidate.url || ""}`;
    if (!candidate?.url || seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
    if (out.length >= API_ACQUISITION_MAX_CANDIDATES) break;
  }
  return out;
}

function exposeDelegatedCandidateAuth(candidates, accessToken, mode) {
  if (mode !== "delegated" || !accessToken) return candidates;
  return candidates.map(candidate => {
    if (!candidate?.kobo?.requires_kobo_authorization) return candidate;
    return { ...candidate, headers:{ ...candidate.headers, Authorization:`Bearer ${accessToken}` } };
  });
}

function normalizeDisplayProfile(value) {
  const raw = compactText(value || "Android", 40) || "Android";
  const known = { android:"Android", desktop:"Desktop" };
  const canonical = known[raw.toLowerCase()];
  if (!canonical) throw new HttpError(400, "invalid_request", "display_profile doit valoir Android ou Desktop");
  return canonical;
}



function syncEventKind(event) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return "unknown";
  return Object.keys(event)[0] || "unknown";
}

function redactUrlForDiagnostic(value) {
  try {
    const u = new URL(String(value || ""));
    const names = [...new Set([...u.searchParams.keys()])];
    const sensitive = /(?:sig|signature|token|key|auth|credential|expires|expiry|policy|session|secret)/i;
    const sanitized = new URL(u.origin + u.pathname);
    for (const name of names) sanitized.searchParams.append(name, sensitive.test(name) ? "[REDACTED]" : "[VALUE]");
    const signed = names.some(name => /(?:sig|signature|credential|policy|token|key)/i.test(name));
    const expiryNames = names.filter(name => /(?:expires|expiry|expiration|^exp$|x-amz-date|x-amz-expires|^se$)/i.test(name));
    return {
      redacted_url:sanitized.toString(),
      host:u.hostname,
      scheme:u.protocol.replace(":", ""),
      query_param_names:names,
      signed_or_tokenized:signed,
      expiry_signal:expiryNames.length > 0,
      expiry_param_names:expiryNames
    };
  } catch { return null; }
}

export function redactSyncNode(node, keyName = "", depth = 0) {
  if (depth > 12) return "[DEPTH_LIMIT]";
  if (node === null || node === undefined) return node;
  if (Array.isArray(node)) return node.slice(0, 100).map(v => redactSyncNode(v, keyName, depth + 1));
  if (typeof node === "object") {
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      if (/^(?:AccessToken|RefreshToken|Authorization|Password|Secret|UserKey)$/i.test(key)) { out[key] = "[REDACTED]"; continue; }
      if (/^Value$/i.test(key) && /key/i.test(keyName)) { out[key] = "[REDACTED]"; continue; }
      out[key] = redactSyncNode(value, key, depth + 1);
    }
    return out;
  }
  if (typeof node === "string") {
    if (/url|uri|href|link/i.test(keyName)) {
      const info = redactUrlForDiagnostic(node);
      if (info) return info.redacted_url;
    }
    if (/token|secret|password|authorization/i.test(keyName)) return "[REDACTED]";
    if (/key|token|secret|authorization/i.test(keyName)) return "[REDACTED]";
    return node.length > 2000 ? `${node.slice(0, 2000)}…` : node;
  }
  return node;
}

export function collectLibrarySyncSignals(node, max = 200) {
  const out = [];
  const seen = new Set();
  const interesting = /url|download|content|key|mime|format|drm/i;
  const walk = (value, path = "$", key = "", depth = 0) => {
    if (out.length >= max || depth > 12 || value === null || value === undefined) return;
    if (typeof value !== "object") {
      if (interesting.test(key)) {
        const url = typeof value === "string" ? redactUrlForDiagnostic(value) : null;
        out.push({ path, key, value:url ? url.redacted_url : (/key|token|secret|authorization/i.test(key) && typeof value === "string" ? "[REDACTED]" : value), ...(url ? { url } : {}) });
      }
      return;
    }
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (let i = 0; i < Math.min(value.length, 100); i++) walk(value[i], `${path}[${i}]`, key, depth + 1);
      return;
    }
    for (const [childKey, child] of Object.entries(value)) {
      const childPath = `${path}.${childKey}`;
      if (interesting.test(childKey) && child && typeof child === "object") {
        out.push({ path:childPath, key:childKey, value:Array.isArray(child) ? `[array:${child.length}]` : "[object]" });
      }
      walk(child, childPath, childKey, depth + 1);
    }
  };
  walk(node);
  return out;
}

function eventContainsAnyIdentifier(event, identifiers) {
  const wanted = new Set((identifiers || []).filter(Boolean).map(String));
  if (!wanted.size) return false;
  const seen = new Set();
  const walk = (node, depth = 0) => {
    if (depth > 12 || node === null || node === undefined) return false;
    if (typeof node !== "object") return wanted.has(String(node));
    if (seen.has(node)) return false;
    seen.add(node);
    if (Array.isArray(node)) return node.some(x => walk(x, depth + 1));
    return Object.values(node).some(x => walk(x, depth + 1));
  };
  return walk(event);
}

export function candidateUrlsFromSyncEvent(event) {
  const candidates = [];
  const seen = new Set();
  const walk = (node, path = "$", depth = 0) => {
    if (!node || typeof node !== "object" || depth > 12 || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { node.forEach((x, i) => walk(x, `${path}[${i}]`, depth + 1)); return; }
    for (const [key, value] of Object.entries(node)) {
      const childPath = `${path}.${key}`;
      if (typeof value === "string" && /(?:url|uri|href|link)$/i.test(key) && /download|contenturls?|spine/i.test(childPath)) {
        const info = redactUrlForDiagnostic(value);
        if (info && /^https?$/.test(info.scheme)) candidates.push({ path:childPath, raw_url:value, ...info });
      }
      if (value && typeof value === "object") walk(value, childPath, depth + 1);
    }
  };
  walk(event);
  return candidates;
}

function diagnosticHeaderNamesForUrl(url) {
  const names = ["x-amz-request-payer"];
  if (contentUrlRequiresKoboAuthorization(url)) names.push("Authorization");
  return names;
}

export function formatFromHeadersOrUrl(contentType, contentDisposition, url) {
  const text = `${contentType || ""} ${contentDisposition || ""} ${url || ""}`.toLowerCase();
  if (/kepub/.test(text)) return "KEPUB";
  if (/application\/epub\+zip|\.epub(?:$|[?#])/.test(text)) return "EPUB";
  if (/application\/pdf|\.pdf(?:$|[?#])/.test(text)) return "PDF";
  if (/\.cbz(?:$|[?#])|application\/(?:vnd\.comicbook\+zip|x-cbz)/.test(text)) return "CBZ";
  return "unknown";
}

async function probeSyncUrlRange(rawUrl, auth, appVersion) {
  let current = rawUrl;
  let authorizationAllowed = contentUrlRequiresKoboAuthorization(current);
  for (let hop = 0; hop < 4; hop++) {
    const h = new Headers(koboContentDownloadHeaders());
    if (authorizationAllowed && auth?.accessToken) h.set("Authorization", `Bearer ${auth.accessToken}`);
    let response;
    try {
      h.set("Range", "bytes=0-0");
      response = await koboFetch(current, { method:"GET", headers:h, redirect:"manual" }, { maxRetries:0 });
    } catch (e) {
      return { attempted:true, ok:false, error:safeError(e), endpoint:redactUrlForDiagnostic(current)?.redacted_url || "[invalid-url]" };
    }
    const location = response.headers.get("Location");
    if (response.status >= 300 && response.status < 400 && location) {
      const next = new URL(location, current).toString();
      const prevOrigin = new URL(current).origin;
      const nextOrigin = new URL(next).origin;
      if (prevOrigin !== nextOrigin) authorizationAllowed = false;
      current = next;
      continue;
    }
    const ct = response.headers.get("Content-Type") || "";
    const cd = response.headers.get("Content-Disposition") || "";
    return {
      attempted:true,
      ok:response.ok,
      status:response.status,
      final_url:redactUrlForDiagnostic(current),
      content_type:ct,
      content_disposition:cd ? cd.replace(/filename\*?=(?:UTF-8''|\")?[^;\"]+/i, "filename=[REDACTED]") : "",
      content_length:response.headers.get("Content-Length") || null,
      content_range:response.headers.get("Content-Range") || null,
      range_requested:"bytes=0-0",
      inferred_format:formatFromHeadersOrUrl(ct, cd, current),
      header_names_sent:[...h.keys()]
    };
  }
  return { attempted:true, ok:false, error:"redirect_limit" };
}

async function fetchLibrarySyncDiagnosticRun(resources, auth, appVersion, startToken = "") {
  const libraryUrl = resources.library_sync || `${KOBO_STORE}/v1/library/sync`;
  const events = [];
  const pages = [];
  let token = startToken;
  let finalObservedToken = startToken || "";
  let refreshed = false;
  for (let pageIndex = 0; pageIndex < 100; pageIndex++) {
    const headers = token ? { "x-kobo-synctoken":token } : {};
    const u = new URL(libraryUrl);
    u.searchParams.set("Filter", "ALL");
    u.searchParams.set("DownloadUrlFilter", "Generic,Android");
    u.searchParams.set("PrioritizeRecentReads", "true");
    const out = await koboAuthedFetch(u, auth, appVersion, { headers });
    auth = out.auth; refreshed ||= out.refreshed;
    if (!out.response.ok) throw koboHttpError("kobo_library_sync_probe_failed", out.response, "Kobo library sync probe failed", { unauthorizedStatus:401 });
    const payload = await out.response.json();
    const pageEvents = Array.isArray(payload) ? payload : [];
    events.push(...pageEvents);
    const syncState = out.response.headers.get("x-kobo-sync") || "";
    const observed = out.response.headers.get("x-kobo-synctoken") || "";
    if (observed) finalObservedToken = observed;
    pages.push({ index:pageIndex + 1, event_count:pageEvents.length, x_kobo_sync:syncState || null, sync_token_present:Boolean(observed) });
    if (syncState !== "continue" || !observed) break;
    token = observed;
  }
  return { events, pages, auth, refreshed, syncToken:finalObservedToken };
}


async function diagnoseStandardAcquisitionSources(env, uidHash, productId, revisionId) {
  const contentByProfile = {};
  let reusableContent = null;
  for (const profile of ["Android", "Desktop"]) {
    try {
      const content = await contentAccessForBook(env, uidHash, productId, revisionId || "", profile);
      reusableContent ||= content;
      const candidates = normalizeAcquisitionCandidates(content.payload, profile);
      contentByProfile[profile] = {
        status:"ok",
        resolved_identifier:content.usedIdentifier || null,
        endpoint:redactUrlForDiagnostic(content.usedEndpoint),
        candidate_count:candidates.length,
        candidates:candidates.map(c => ({
          kind:c.kind,
          handling:c.handling,
          media_format:c.media_format,
          source_format:c.source_format,
          drm:c.drm,
          url:redactUrlForDiagnostic(c.url),
          header_names:Object.keys(c.headers || {})
        })),
        content_keys:contentKeySummary(content.payload),
        redacted_response:redactSyncNode(content.payload)
      };
    } catch (e) {
      contentByProfile[profile] = { status:"error", error:{ code:e?.code || "error", status:Number(e?.status || 0) || null, message:safeError(e) } };
    }
  }

  let acsm = { requested:true, status:"not_tested", candidate_count:0 };
  if (reusableContent) {
    try {
      const result = await resolveKoboAcsmExport(env, uidHash, reusableContent, productId, revisionId || "");
      acsm = {
        ...result.lookup,
        candidates:(result.candidates || []).map(c => ({
          kind:c.kind,
          handling:c.handling,
          media_format:c.media_format,
          source_format:c.source_format,
          drm:c.drm,
          url:redactUrlForDiagnostic(c.url),
          header_names:Object.keys(c.headers || {})
        }))
      };
    } catch (e) {
      acsm = { requested:true, status:"error", candidate_count:0, error:{ code:e?.code || "error", status:Number(e?.status || 0) || null, message:safeError(e) } };
    }
  }
  return { content_access_book:contentByProfile, get_download_link:acsm };
}

async function v2LibrarySyncProbe(request, env, uidHash) {
  await authenticateVault(request, env, uidHash);
  const body = await readJson(request).catch(e => { if (e?.code === "invalid_json") return {}; throw e; });
  const requested = Array.isArray(body?.product_ids) ? body.product_ids.map(x => compactText(x, 200)).filter(Boolean) : [];
  const productIds = [...new Set(requested)].slice(0, 20);
  if (!productIds.length) throw new HttpError(400, "invalid_request", "product_ids est vide");
  const loaded = await loadApiKoboCredentials(env, uidHash);
  const bundle = loaded.bundle;
  const appVersion = bundle.appVersion || env.KOBO_APP_VERSION || DEFAULT_KOBO_APP_VERSION;
  let auth = { accessToken:bundle.accessToken, refreshToken:bundle.refreshToken || "" };
  const init = await getInitialization(auth, appVersion);
  auth = init.auth;

  const projectionRows = await env.KOBO_VAULT.prepare(
    `SELECT product_id, revision_id, archived, downloadable, content_type FROM library_projection WHERE uid_hash = ? AND product_id IN (${productIds.map(() => "?").join(",")})`
  ).bind(uidHash, ...productIds).all();
  const projectionByProduct = new Map((projectionRows.results || []).map(row => [String(row.product_id), row]));

  const initial = await fetchLibrarySyncDiagnosticRun(init.resources || {}, auth, appVersion, "");
  auth = initial.auth;
  let incremental = null;
  if (initial.syncToken) {
    incremental = await fetchLibrarySyncDiagnosticRun(init.resources || {}, auth, appVersion, initial.syncToken);
    auth = incremental.auth;
  }
  if (init.refreshed || initial.refreshed || incremental?.refreshed) {
    await storeRefreshedApiKoboCredentials(env, uidHash, { ...bundle, accessToken:auth.accessToken, refreshToken:auth.refreshToken || bundle.refreshToken || "", appVersion });
  }

  const probeUrls = body?.probe_urls !== false;
  const reports = [];
  for (const productId of productIds) {
    const projection = projectionByProduct.get(productId) || null;
    const identifiers = [productId, projection?.revision_id].filter(Boolean);
    const initialMatches = initial.events.filter(e => eventContainsAnyIdentifier(e, identifiers));
    const incrementalMatches = incremental ? incremental.events.filter(e => eventContainsAnyIdentifier(e, identifiers)) : [];
    const allMatches = [...initialMatches, ...incrementalMatches];
    const urlMap = new Map();
    for (const event of allMatches) for (const u of candidateUrlsFromSyncEvent(event)) if (!urlMap.has(u.raw_url)) urlMap.set(u.raw_url, u);
    const urls = [];
    for (const u of [...urlMap.values()].slice(0, 20)) {
      const head = probeUrls ? await probeSyncUrlRange(u.raw_url, auth, appVersion) : { attempted:false };
      urls.push({
        path:u.path,
        url:{ redacted_url:u.redacted_url, host:u.host, scheme:u.scheme, query_param_names:u.query_param_names, signed_or_tokenized:u.signed_or_tokenized, expiry_signal:u.expiry_signal, expiry_param_names:u.expiry_param_names },
        required_header_names:diagnosticHeaderNamesForUrl(u.raw_url),
        head
      });
    }
    const formats = [...new Set(urls.map(x => x.head?.inferred_format).filter(x => x && x !== "unknown"))];
    const standard_sources = await diagnoseStandardAcquisitionSources(env, uidHash, productId, projection?.revision_id || "");
    const syncRecipePresent = urls.length > 0;
    reports.push({
      product_id:productId,
      projection:projection ? { revision_id:projection.revision_id || null, archived:Boolean(projection.archived), downloadable:Boolean(projection.downloadable), content_type:projection.content_type || null } : null,
      initial_sync:{ present:initialMatches.length > 0, event_count:initialMatches.length, event_types:initialMatches.map(syncEventKind), signals:initialMatches.flatMap(e => collectLibrarySyncSignals(e)).slice(0, 200), redacted_events:initialMatches.map(e => redactSyncNode(e)) },
      incremental_sync:{ attempted:Boolean(incremental), present:incrementalMatches.length > 0, event_count:incrementalMatches.length, event_types:incrementalMatches.map(syncEventKind), signals:incrementalMatches.flatMap(e => collectLibrarySyncSignals(e)).slice(0, 200), redacted_events:incrementalMatches.map(e => redactSyncNode(e)) },
      urls,
      observed_formats:formats,
      standard_sources,
      content_keys_signal:allMatches.some(e => collectLibrarySyncSignals(e).some(s => /content.*key|key/i.test(s.path))),
      library_sync_recipe_present:syncRecipePresent,
      classification:syncRecipePresent ? "candidate_device_specific_delivery" : "unknown"
    });
  }

  return json({
    diagnostic:"library_sync_acquisition_probe",
    version:APP_RELEASE,
    provider_contract:{ api:"2.3", revision:"2.3.3", changed:true },
    request:{ product_ids:productIds, probe_urls:probeUrls },
    kobo_identity:{ display_profile_for_content_access:"Android", platform_id:PLATFORM_ID, app_version:appVersion, user_agent:Object.fromEntries(koboHeaders(null, appVersion))["user-agent"], library_sync_query:{ Filter:"ALL", DownloadUrlFilter:"Generic,Android", PrioritizeRecentReads:"true" }, authorization_header_name:"Authorization" },
    resources:{ library_sync:Boolean(init.resources?.library_sync), content_access_book:Boolean(init.resources?.content_access_book), get_download_link:Boolean(init.resources?.get_download_link) },
    initial_sync:{ pages:initial.pages, event_count:initial.events.length, final_sync_token_present:Boolean(initial.syncToken) },
    incremental_sync:incremental ? { pages:incremental.pages, event_count:incremental.events.length, start_sync_token_present:true } : { attempted:false, reason:"no_sync_token_returned" },
    books:reports,
    generated_at:new Date().toISOString()
  }, 200, { "Cache-Control":"private, no-store", "Pragma":"no-cache" });
}

async function contentAccessForBook(env, uidHash, productId, revisionId, displayProfile = "Android") {
  const loaded = await loadApiKoboCredentials(env, uidHash);
  const bundle = loaded.bundle;
  const appVersion = bundle.appVersion || env.KOBO_APP_VERSION || DEFAULT_KOBO_APP_VERSION;
  let auth = { accessToken:bundle.accessToken, refreshToken:bundle.refreshToken || "" };
  const init = await getInitialization(auth, appVersion);
  auth = init.auth;
  const template = init.resources.content_access_book;
  if (!template) throw new HttpError(502, "kobo_content_access_unavailable", "Kobo n’a pas annoncé de ressource content_access_book.");
  const identifiers = [...new Set([revisionId, productId].filter(Boolean))];
  let payload = null;
  let usedIdentifier = "";
  let usedEndpoint = "";
  let lastStatus = 0;
  let lastResponse = null;
  let refreshed = init.refreshed;
  for (const identifier of identifiers) {
    const endpoint = replaceTemplateId(template, "ProductId", identifier);
    const u = new URL(endpoint);
    u.searchParams.set("DisplayProfile", displayProfile);
    const out = await koboAuthedFetch(u, auth, appVersion);
    auth = out.auth;
    refreshed ||= out.refreshed;
    lastStatus = out.response.status;
    lastResponse = out.response;
    if (!out.response.ok) continue;
    try { payload = await out.response.json(); usedIdentifier = identifier; usedEndpoint = endpoint; break; } catch {}
  }
  if (refreshed) {
    const updated = { ...bundle, accessToken:auth.accessToken, refreshToken:auth.refreshToken || bundle.refreshToken || "", appVersion };
    await storeRefreshedApiKoboCredentials(env, uidHash, updated);
  }
  if (!payload) {
    if (lastStatus === 401) throw new HttpError(401, "kobo_session_expired", "La session Kobo publiée doit être renouvelée depuis Kobo Vault.");
    if (lastResponse) throw koboHttpError("upstream_error", lastResponse, "Kobo content access failed", { unauthorizedStatus:401 });
    throw new HttpError(502, "upstream_error", `Kobo content access failed (${lastStatus || "no response"})`);
  }
  return { payload, usedIdentifier, usedEndpoint, auth, appVersion, bundle, displayProfile, resources:init.resources };
}

function parseExpiryValue(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (/^\d{10,13}$/.test(raw)) {
    const n = Number(raw);
    const ms = raw.length >= 13 ? n : n * 1000;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function inferAcquisitionExpiry(candidates) {
  const names = ["expires","expiry","expiration","exp","se"];
  const values = [];
  for (const candidate of candidates || []) {
    try {
      const u = new URL(candidate.url);
      for (const name of names) {
        const parsed = parseExpiryValue(u.searchParams.get(name));
        if (parsed) values.push(parsed);
      }
    } catch {}
  }
  if (!values.length) return null;
  values.sort();
  return values[0];
}

function delegatedContentAccessRequest(content) {
  const raw = Object.fromEntries(koboHeaders(content.auth.accessToken, content.appVersion));
  const headers = {
    "Accept": raw.accept || "application/json",
    "Accept-Language": raw["accept-language"] || "fr-FR,fr;q=0.9,en;q=0.7",
    "User-Agent": raw["user-agent"] || "",
    "Authorization": raw.authorization || `Bearer ${content.auth.accessToken}`
  };
  return {
    method:"GET",
    url:content.usedEndpoint || null,
    headers,
    query:{ DisplayProfile:content.displayProfile || "Android" }
  };
}

async function v2Acquisition(request, env, client, productId) {
  const body = await readJson(request).catch(e => { if (e?.code === "invalid_json") return {}; throw e; });
  const mode = String(body?.mode || "descriptor").toLowerCase();
  if (!["descriptor","delegated"].includes(mode)) throw new HttpError(400, "invalid_request", "mode doit valoir descriptor ou delegated");
  if (mode === "delegated") requireApiScope(client, "kobo.acquisition.delegate");

  const row = await env.KOBO_VAULT.prepare("SELECT * FROM library_projection WHERE uid_hash = ? AND product_id = ?")
    .bind(client.uid_hash, productId).first();
  if (!row) throw new HttpError(404, "not_found", "Livre absent de la bibliothèque Kobo publiée");
  if (row.archived) throw new HttpError(409, "archived_book", "Ce livre est archivé dans la bibliothèque Kobo. Restaurez-le sur Kobo avant de redemander une acquisition.");
  if (!row.downloadable) throw new HttpError(422, "not_downloadable", "Ce livre n’est pas marqué téléchargeable");

  const requestedRevision = compactText(body?.revision_id ?? body?.revisionId, 200);
  if (requestedRevision && row.revision_id && requestedRevision !== row.revision_id) {
    throw new HttpError(409, "revision_mismatch", "La révision demandée n’est plus courante");
  }

  const displayProfile = normalizeDisplayProfile(body?.display_profile ?? body?.displayProfile ?? "Android");
  const includeAcsm = body?.include_acsm !== false && body?.includeAcsm !== false;
  const content = await contentAccessForBook(env, client.uid_hash, productId, row.revision_id || requestedRevision || "", displayProfile);
  const contentAccessCandidates = normalizeAcquisitionCandidates(content.payload, displayProfile);
  let librarySync = { candidates:[], status:"skipped", candidate_count:0, pages:0, event_count:0 };
  // Cifereca's pinned KDRM runtime needs an attested library_sync delivery
  // candidate in addition to a separately delegated content-key replay.
  // A content_access_book KDRM URL alone is not that pinned candidate:
  // do not suppress the library_sync lookup just because such a URL exists.
  // This is a SELECTED acquisition POST only, never inventory or catalog I/O.
  const onlyUnpinnedKdrm = contentAccessCandidates.length > 0
    && contentAccessCandidates.every(candidate => candidate.handling === "kobo_kdrm");
  if (!contentAccessCandidates.length || onlyUnpinnedKdrm) {
    try {
      const resolved = await resolveLibrarySyncAcquisitionCandidates(env, client.uid_hash, content, productId, row.revision_id || requestedRevision || "");
      librarySync = { ...resolved, status:resolved.candidates.length ? "available" : "not_available", candidate_count:resolved.candidates.length };
      content.auth = resolved.auth || content.auth;
    } catch (e) {
      librarySync = { candidates:[], status:"upstream_error", candidate_count:0, pages:0, event_count:0 };
    }
  }
  const acsmExport = includeAcsm
    ? await resolveKoboAcsmExport(env, client.uid_hash, content, productId, row.revision_id || requestedRevision || "")
    : { candidates:[], auth:content.auth, lookup:{ requested:false, status:"skipped", source:"get_download_link", candidate_count:0, request_shape:null } };
  content.auth = acsmExport.auth || content.auth;
  let candidates = dedupeAcquisitionCandidates([...contentAccessCandidates, ...librarySync.candidates, ...acsmExport.candidates]);
  candidates = exposeDelegatedCandidateAuth(candidates, content.auth?.accessToken || "", mode);
  if (!candidates.length) throw new HttpError(422, "not_downloadable", "Kobo n’a retourné aucun artefact téléchargeable compatible");

  const now = new Date().toISOString();
  const expiresAt = inferAcquisitionExpiry(candidates);
  const item = projectionRowToApi(row);
  const keySummary = contentKeySummary(content.payload);
  const acquisition = {
    product_id:productId,
    revision_id:row.revision_id || requestedRevision || null,
    resolved_identifier:content.usedIdentifier || null,
    mode,
    display_profile:displayProfile,
    mechanisms:[...new Set(candidates.map(candidate => candidate.handling))],
    sources:{
      content_access_book:{ status:contentAccessCandidates.length ? "available" : "not_available", candidate_count:contentAccessCandidates.length },
      library_sync:{ status:librarySync.status, candidate_count:librarySync.candidate_count, pages:librarySync.pages || 0, event_count:librarySync.event_count || 0 },
      acsm_export:acsmExport.lookup
    },
    content_keys:{
      present:keySummary.present,
      count:keySummary.count,
      values_exposed:false,
      retrieval:mode === "delegated" ? "consumer_replays_content_access" : "not_exposed"
    },
    candidates,
    validity:{
      generated_at:now,
      expires_at:expiresAt,
      renewable:true,
      refresh_strategy:"resolve_again"
    },
    content_keys_exposed:false,
    credentials_exposed:mode === "delegated"
  };

  if (mode === "delegated") {
    acquisition.delegation = {
      provider:"kobo",
      sensitive:true,
      content_access_request:delegatedContentAccessRequest(content),
      session_context:{
        app_version:content.appVersion,
        user_id:content.bundle.userId || null,
        device_id:content.bundle.deviceId || null,
        serial_number:content.bundle.serialNumber || null
      },
      refresh_token_exposed:false,
      content_access_response:{
        may_include_content_keys:true,
        content_keys_values_returned_by_vault:false,
        consumer_must_classify_drm:true
      },
      renewal:{
        strategy:"resolve_again",
        endpoint:`/api/v2/library/${encodeURIComponent(productId)}/acquisition`
      }
    };
  }

  return json({
    provider:"kobo",
    schema_version:"1.4",
    item,
    acquisition
  }, 200, { "Cache-Control":"private, no-store", "Pragma":"no-cache" });
}

async function v1Account(env, client) {
  const row = await env.KOBO_VAULT.prepare(
    "SELECT account_id, display_name, email_hint FROM account_projection WHERE uid_hash = ?"
  ).bind(client.uid_hash).first();
  if (!row) throw new HttpError(404, "not_found", "Projection Kobo non publiée depuis le navigateur");
  return json({ account: { id:row.account_id, display_name:row.display_name, ...(row.email_hint ? {email_hint:row.email_hint} : {}) } });
}

async function v1Manifest(env, client, url) {
  const limit = clampInt(url.searchParams.get("limit"), 1, 500, 200);
  const offset = decodeCursor(url.searchParams.get("cursor"));
  if (offset === 0) await ensureFreshLibraryProjection(env, client.uid_hash);
  const rows = await env.KOBO_VAULT.prepare(
    "SELECT * FROM library_projection WHERE uid_hash = ? ORDER BY product_id LIMIT ? OFFSET ?"
  ).bind(client.uid_hash, limit + 1, offset).all();
  const all = rows.results || [];
  const hasMore = all.length > limit;
  const items = all.slice(0, limit).map(r => {
    const x = projectionRowToApi(r);
    delete x.collection; delete x.owned; delete x.price; delete x.description; delete x.archived;
    return x;
  });
  return json({ items, next_cursor: hasMore ? encodeCursor(offset + limit) : null }, 200, { "Cache-Control":"private, no-store" });
}

async function v1Search(env, client, url) {
  const q = compactText(url.searchParams.get("q"), 200);
  if (!q) throw new HttpError(400, "invalid_request", "Paramètre q requis");
  const field = ["all","title","author","isbn","subject"].includes(url.searchParams.get("field")) ? url.searchParams.get("field") : "all";
  const scope = ["all","catalog","library"].includes(url.searchParams.get("scope")) ? url.searchParams.get("scope") : "all";
  if (scope !== "library") {
    throw new HttpError(501, "catalog_search_requires_agent", "La recherche catalogue distante n’est pas activée en mode zero-knowledge. Utilisez scope=library dans la V0.6.0.");
  }
  const limit = clampInt(url.searchParams.get("limit"), 1, 100, 50);
  const offset = decodeCursor(url.searchParams.get("cursor"));
  const like = `%${q.replaceAll("!", "!!").replaceAll("%", "!%").replaceAll("_", "!_")}%`;
  let condition = "(title LIKE ? ESCAPE '!' OR authors_json LIKE ? ESCAPE '!' OR isbn LIKE ? ESCAPE '!' OR publisher LIKE ? ESCAPE '!' OR description LIKE ? ESCAPE '!')";
  let args = [like, like, like, like, like];
  if (field === "title") { condition = "title LIKE ? ESCAPE '!'"; args = [like]; }
  if (field === "author") { condition = "authors_json LIKE ? ESCAPE '!'"; args = [like]; }
  if (field === "isbn") { condition = "isbn LIKE ? ESCAPE '!'"; args = [like]; }
  if (field === "subject") { condition = "(title LIKE ? ESCAPE '!' OR description LIKE ? ESCAPE '!')"; args = [like, like]; }
  const sql = `SELECT * FROM library_projection WHERE uid_hash = ? AND ${condition} ORDER BY title, product_id LIMIT ? OFFSET ?`;
  const rows = await env.KOBO_VAULT.prepare(sql).bind(client.uid_hash, ...args, limit + 1, offset).all();
  const all = rows.results || []; const hasMore = all.length > limit;
  return json({ items:all.slice(0,limit).map(projectionRowToApi), next_cursor:hasMore?encodeCursor(offset+limit):null });
}

async function v1CreateDownloadJob(request, env, client, productId) {
  const body = await readJson(request);
  const book = await env.KOBO_VAULT.prepare("SELECT * FROM library_projection WHERE uid_hash = ? AND product_id = ?").bind(client.uid_hash, productId).first();
  if (!book) throw new HttpError(404, "not_found", "Produit inconnu dans la bibliothèque publiée");
  if (!book.downloadable) throw new HttpError(422, "not_downloadable", "Ce produit n’est pas marqué téléchargeable");
  const requestedRevision = compactText(body.revision_id ?? body.revisionId, 200);
  if (requestedRevision && book.revision_id && requestedRevision !== book.revision_id) throw new HttpError(409, "revision_mismatch", "La révision demandée n’est plus courante");
  const revisionId = requestedRevision || book.revision_id || "";
  const format = compactText(body.format || "epub", 20).toLowerCase();
  if (format !== "epub") throw new HttpError(400, "invalid_request", "Seul le format epub est supporté dans la V0.6.0");
  const idem = compactText(request.headers.get("Idempotency-Key"), 200) || null;
  if (idem) {
    const existing = await env.KOBO_VAULT.prepare("SELECT * FROM jobs WHERE uid_hash = ? AND idempotency_key = ?").bind(client.uid_hash, idem).first();
    if (existing) {
      if (existing.product_id !== productId || String(existing.revision_id || "") !== revisionId || String(existing.format || "") !== format) {
        throw new HttpError(409, "idempotency_conflict", "Cette Idempotency-Key a déjà été utilisée avec une autre demande");
      }
      return json({ job: publicJob(existing) }, 200);
    }
  }
  const active = await env.KOBO_VAULT.prepare(
    "SELECT * FROM jobs WHERE uid_hash = ? AND product_id = ? AND COALESCE(revision_id,'') = ? AND status IN ('queued','claimed','downloading','processing') ORDER BY created_at DESC LIMIT 1"
  ).bind(client.uid_hash, productId, revisionId).first();
  if (active) return json({ job: publicJob(active) }, 200);
  const id = `job_${randomHex(12)}`; const now = new Date().toISOString();
  await env.KOBO_VAULT.prepare(
    "INSERT INTO jobs(id, uid_hash, type, product_id, revision_id, format, status, idempotency_key, title, authors_json, created_at, updated_at) VALUES(?, ?, 'DOWNLOAD_KOBO_BOOK', ?, ?, ?, 'queued', ?, ?, ?, ?, ?)"
  ).bind(id, client.uid_hash, productId, revisionId, format, idem, book.title, book.authors_json, now, now).run();
  const row = await env.KOBO_VAULT.prepare("SELECT * FROM jobs WHERE id = ?").bind(id).first();
  return json({ job:publicJob(row) }, 202);
}

export function publicJob(row) {
  const result = safeJsonParse(row?.result_json, null);
  const error = row?.error_code ? { code:row.error_code, message:row.error_message || "" } : null;
  return {
    id:row.id, type:row.type, product_id:row.product_id || null, revision_id:row.revision_id || null,
    format:row.format || null, status:row.status, created_at:row.created_at, started_at:row.started_at || null,
    completed_at:row.completed_at || null, ...(result ? {result} : {}), ...(error ? {error} : {})
  };
}

async function v1GetJob(env, client, jobId) {
  const row = await env.KOBO_VAULT.prepare("SELECT * FROM jobs WHERE id = ? AND uid_hash = ?").bind(jobId, client.uid_hash).first();
  if (!row) throw new HttpError(404, "not_found", "Job introuvable");
  return json({ job:publicJob(row) });
}

async function v1ListVaultJobs(request, env, uidHash, url) {
  await authenticateVault(request, env, uidHash);
  const limit = clampInt(url.searchParams.get("limit"), 1, 100, 20);
  const rows = await env.KOBO_VAULT.prepare("SELECT * FROM jobs WHERE uid_hash = ? ORDER BY created_at DESC LIMIT ?").bind(uidHash, limit).all();
  return json({ items:(rows.results || []).map(publicJob) });
}

async function v1AgentPairStart(request, env) {
  // Opportunistic cleanup keeps anonymous pairing requests bounded without a cron.
  await env.KOBO_VAULT.prepare("DELETE FROM agent_pairings WHERE expires_at < ?").bind(new Date().toISOString()).run();
  const body = await readJson(request);
  const agentName = compactText(body.agent_name ?? body.agentName ?? "kobo-adept", 120) || "kobo-adept";
  const pairId = `pair_${randomHex(12)}`;
  const code = generatePairCode();
  const codeHash = await sha256Hex(code);
  const now = new Date(); const expires = new Date(now.getTime() + API_PAIRING_TTL_MS);
  await env.KOBO_VAULT.prepare(
    "INSERT INTO agent_pairings(pair_id, code_hash, agent_name, status, created_at, expires_at) VALUES(?, ?, ?, 'pending', ?, ?)"
  ).bind(pairId, codeHash, agentName, now.toISOString(), expires.toISOString()).run();
  return json({ pairing:{ pair_id:pairId, code, expires_at:expires.toISOString() } }, 201, { "Cache-Control":"private, no-store" });
}

async function v1ApproveAgentPairing(request, env, uidHash) {
  await authenticateVault(request, env, uidHash);
  const body = await readJson(request);
  const code = compactText(body.code, 32).toUpperCase();
  if (code.length < 6) throw new HttpError(400, "invalid_request", "Code d’appairage invalide");
  const codeHash = await sha256Hex(code);
  const row = await env.KOBO_VAULT.prepare(
    "SELECT * FROM agent_pairings WHERE code_hash = ? AND status = 'pending' AND expires_at > ? ORDER BY created_at DESC LIMIT 1"
  ).bind(codeHash, new Date().toISOString()).first();
  if (!row) throw new HttpError(404, "not_found", "Code d’appairage inconnu ou expiré");
  const now = new Date().toISOString();
  await env.KOBO_VAULT.prepare("UPDATE agent_pairings SET uid_hash = ?, status = 'approved', approved_at = ? WHERE pair_id = ?").bind(uidHash, now, row.pair_id).run();
  return json({ ok:true, pairing:{ pair_id:row.pair_id, agent_name:row.agent_name, status:"approved" } });
}

async function v1AgentPairComplete(request, env) {
  const body = await readJson(request);
  const pairId = compactText(body.pair_id ?? body.pairId, 100);
  const code = compactText(body.code, 32).toUpperCase();
  if (!pairId || !code) throw new HttpError(400, "invalid_request", "pair_id et code requis");
  const codeHash = await sha256Hex(code);
  const pair = await env.KOBO_VAULT.prepare(
    "SELECT * FROM agent_pairings WHERE pair_id = ? AND code_hash = ? AND status = 'approved' AND expires_at > ?"
  ).bind(pairId, codeHash, new Date().toISOString()).first();
  if (!pair?.uid_hash) throw new HttpError(409, "pairing_not_approved", "Appairage non approuvé ou expiré");
  const token = generateApiSecret("kva"); const tokenHash = await sha256Hex(token);
  const agentId = `agent_${randomHex(12)}`; const now = new Date().toISOString();
  const capabilities = ["kobo_download", "post_download_hook"];
  await env.KOBO_VAULT.batch([
    env.KOBO_VAULT.prepare("INSERT INTO agents(id, uid_hash, name, token_hash, capabilities_json, created_at, last_seen_at) VALUES(?, ?, ?, ?, ?, ?, ?)").bind(agentId, pair.uid_hash, pair.agent_name, tokenHash, JSON.stringify(capabilities), now, now),
    env.KOBO_VAULT.prepare("UPDATE agent_pairings SET status='completed', completed_at=? WHERE pair_id=?").bind(now, pairId)
  ]);
  return json({ agent:{ id:agentId, name:pair.agent_name, token, capabilities } }, 201, { "Cache-Control":"private, no-store" });
}

async function v1ListAgents(request, env, uidHash) {
  await authenticateVault(request, env, uidHash);
  const rows = await env.KOBO_VAULT.prepare("SELECT id, name, capabilities_json, created_at, last_seen_at FROM agents WHERE uid_hash = ? AND revoked_at IS NULL ORDER BY created_at DESC").bind(uidHash).all();
  return json({ items:(rows.results || []).map(r=>({id:r.id,name:r.name,capabilities:safeJsonParse(r.capabilities_json,[]),created_at:r.created_at,last_seen_at:r.last_seen_at||null})) });
}

async function v1RevokeAgent(request, env, uidHash, agentId) {
  await authenticateVault(request, env, uidHash);
  const result = await env.KOBO_VAULT.prepare("UPDATE agents SET revoked_at = ? WHERE uid_hash = ? AND id = ? AND revoked_at IS NULL").bind(new Date().toISOString(), uidHash, agentId).run();
  if (!result.meta?.changes) throw new HttpError(404, "not_found", "Agent introuvable");
  return json({ok:true});
}

function agentJob(row) {
  return {
    id:row.id, type:row.type, product_id:row.product_id || null, revision_id:row.revision_id || null,
    format:row.format || "epub", title:row.title || "", authors:safeJsonParse(row.authors_json, [])
  };
}

async function v1AgentNextJob(env, agent) {
  const now = new Date().toISOString();
  // Expired leases become available again. Do not touch jobs assigned to another live agent.
  await env.KOBO_VAULT.prepare("UPDATE jobs SET status='queued', agent_id=NULL, lease_until=NULL, updated_at=? WHERE uid_hash=? AND status IN ('claimed','downloading','processing') AND lease_until IS NOT NULL AND lease_until < ?").bind(now, agent.uid_hash, now).run();
  const row = await env.KOBO_VAULT.prepare("SELECT * FROM jobs WHERE uid_hash = ? AND status = 'queued' ORDER BY created_at LIMIT 1").bind(agent.uid_hash).first();
  return json({ job:row ? agentJob(row) : null });
}

async function v1AgentClaimJob(env, agent, jobId) {
  const now = new Date(); const lease = new Date(now.getTime()+API_AGENT_LEASE_MS).toISOString();
  const result = await env.KOBO_VAULT.prepare(
    "UPDATE jobs SET status='claimed', agent_id=?, claimed_at=COALESCE(claimed_at,?), lease_until=?, updated_at=? WHERE id=? AND uid_hash=? AND status='queued'"
  ).bind(agent.id, now.toISOString(), lease, now.toISOString(), jobId, agent.uid_hash).run();
  if (!result.meta?.changes) throw new HttpError(409, "job_not_claimable", "Job déjà pris ou indisponible");
  return json({ ok:true, lease_until:lease });
}

async function v1AgentProgressJob(request, env, agent, jobId) {
  const body = await readJson(request);
  const status = ["downloading","processing"].includes(body.status) ? body.status : null;
  if (!status) throw new HttpError(400, "invalid_request", "Statut progress invalide");
  const now = new Date(); const lease = new Date(now.getTime()+API_AGENT_LEASE_MS).toISOString();
  const result = await env.KOBO_VAULT.prepare(
    "UPDATE jobs SET status=?, started_at=COALESCE(started_at,?), lease_until=?, updated_at=? WHERE id=? AND uid_hash=? AND agent_id=? AND status IN ('claimed','downloading','processing')"
  ).bind(status, now.toISOString(), lease, now.toISOString(), jobId, agent.uid_hash, agent.id).run();
  if (!result.meta?.changes) throw new HttpError(409, "job_not_owned", "Job non détenu par cet agent");
  return json({ok:true,status,lease_until:lease});
}

function safeBasename(value) {
  const normalized = compactText(value, 1000).replaceAll("\\", "/");
  return normalized.split("/").filter(Boolean).pop()?.slice(0, 500) || "";
}

export function sanitizeJobResult(body) {
  const hook = body.hook && typeof body.hook === "object" ? {
    status: compactText(body.hook.status, 30) || "unknown",
    exit_code: Number.isFinite(Number(body.hook.exit_code ?? body.hook.exitCode)) ? Number(body.hook.exit_code ?? body.hook.exitCode) : null
  } : null;
  return {
    filename:safeBasename(body.filename),
    size:Math.max(0, Number(body.size)||0),
    sha256:/^[a-f0-9]{64}$/i.test(String(body.sha256||"")) ? String(body.sha256).toLowerCase() : null,
    storage:"local-agent",
    ...(hook ? {hook} : {})
  };
}

async function v1AgentCompleteJob(request, env, agent, jobId) {
  const body = await readJson(request); const resultBody = sanitizeJobResult(body); const now = new Date().toISOString();
  const result = await env.KOBO_VAULT.prepare(
    "UPDATE jobs SET status='complete', completed_at=?, updated_at=?, lease_until=NULL, result_json=?, error_code=NULL, error_message=NULL WHERE id=? AND uid_hash=? AND agent_id=? AND status IN ('claimed','downloading','processing')"
  ).bind(now, now, JSON.stringify(resultBody), jobId, agent.uid_hash, agent.id).run();
  if (!result.meta?.changes) throw new HttpError(409, "job_not_owned", "Job non détenu par cet agent");
  return json({ok:true});
}

async function v1AgentFailJob(request, env, agent, jobId) {
  const body = await readJson(request); const error = body.error && typeof body.error === "object" ? body.error : body;
  const code = compactText(error.code || "download_failed", 100) || "download_failed";
  const message = compactText(error.message || "Échec du téléchargement", 500);
  const now = new Date().toISOString();
  const result = await env.KOBO_VAULT.prepare(
    "UPDATE jobs SET status='failed', completed_at=?, updated_at=?, lease_until=NULL, error_code=?, error_message=? WHERE id=? AND uid_hash=? AND agent_id=? AND status IN ('claimed','downloading','processing')"
  ).bind(now, now, code, message, jobId, agent.uid_hash, agent.id).run();
  if (!result.meta?.changes) throw new HttpError(409, "job_not_owned", "Job non détenu par cet agent");
  return json({ok:true});
}

async function v1AgentHeartbeat(request, env, agent) {
  const body = await readJson(request);
  const capabilities = Array.isArray(body.capabilities) ? body.capabilities.map(x=>compactText(x,80)).filter(Boolean).slice(0,30) : agent.capabilities;
  const now = new Date().toISOString();
  await env.KOBO_VAULT.prepare("UPDATE agents SET last_seen_at=?, capabilities_json=? WHERE id=?").bind(now, JSON.stringify(capabilities), agent.id).run();
  return json({ok:true,server_time:now});
}

function withSecurity(response) {
  const h = new Headers(response.headers);
  for (const [k, v] of Object.entries(securityHeaders)) h.set(k, v);
  h.set("Cache-Control", h.get("Cache-Control") || "no-store");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: h });
}

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
  });
}

function v1Error(status, code, message, headers = {}) {
  return json({ error: { code, message } }, status, headers);
}

function safeError(error) {
  if (!error) return "Unknown error";
  return String(error.message || error).slice(0, 500);
}

async function readJson(request) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > MAX_BODY_BYTES) throw new HttpError(413, "payload_too_large", "Payload too large");
  let body;
  try { body = await request.json(); }
  catch { throw new HttpError(400, "invalid_json", "Invalid JSON body"); }
  return body;
}

class HttpError extends Error {
  constructor(status, code, message, headers = {}) { super(message); this.status = status; this.code = code; this.headers = headers; }
}

function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, "0")).join("");
}

function b64Utf8(text) {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

function koboHeaders(accessToken, appVersion) {
  const h = new Headers({
    "Accept": "application/json",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.7",
    "User-Agent": `Mozilla/5.0 (Linux; U; Android 2.0; fr-fr;) AppleWebKit/538.1 (KHTML, like Gecko) Version/4.0 Mobile Safari/538.1 (Kobo Touch 0373/${appVersion})`
  });
  if (accessToken) h.set("Authorization", `Bearer ${accessToken}`);
  return h;
}

export function parseRetryAfterMs(value, nowMs = Date.now()) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const raw = String(value).trim();
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Math.max(0, Math.round(Number(raw) * 1000));
  const at = Date.parse(raw);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, at - nowMs);
}

function retryDelayMs(response, attempt) {
  const retryAfter = response ? parseRetryAfterMs(response.headers.get("Retry-After")) : null;
  if (retryAfter !== null) return Math.min(retryAfter, KOBO_FETCH_MAX_RETRY_AFTER_MS);
  return Math.min(KOBO_FETCH_BASE_DELAY_MS * (2 ** attempt), KOBO_FETCH_MAX_RETRY_AFTER_MS);
}

function koboHttpError(code, response, messagePrefix, { unauthorizedStatus = 502 } = {}) {
  const upstreamStatus = Number(response?.status || 0);
  const status = upstreamStatus === 429 ? 429 : (upstreamStatus === 401 ? unauthorizedStatus : 502);
  const headers = {};
  const retryAfter = response?.headers?.get?.("Retry-After");
  if (status === 429 && retryAfter) headers["Retry-After"] = retryAfter;
  return new HttpError(status, code, `${messagePrefix} (${upstreamStatus || "no response"})`, headers);
}

function sleep(ms) {
  if (!ms) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function koboFetch(url, init = {}, policy = {}) {
  const timeoutMs = Math.max(1, Number(policy.timeoutMs) || KOBO_FETCH_TIMEOUT_MS);
  const maxRetries = Math.max(0, Math.min(Number.isInteger(policy.maxRetries) ? policy.maxRetries : KOBO_FETCH_MAX_RETRIES, 5));
  const fetchImpl = policy.fetchImpl || globalThis.fetch;
  const sleepImpl = policy.sleepImpl || sleep;
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Kobo upstream timeout")), timeoutMs);
    let response = null;
    try {
      response = await fetchImpl(url, { ...init, signal:controller.signal });
      if (!KOBO_RETRYABLE_STATUS.has(response.status) || attempt >= maxRetries) return response;
    } catch (error) {
      lastError = error;
      if (attempt >= maxRetries) {
        const timeout = controller.signal.aborted;
        throw new HttpError(502, timeout ? "kobo_upstream_timeout" : "kobo_upstream_unreachable", timeout ? "Kobo upstream timed out" : "Kobo upstream request failed");
      }
    } finally {
      clearTimeout(timer);
    }
    await sleepImpl(retryDelayMs(response, attempt));
  }

  throw lastError || new HttpError(502, "kobo_upstream_unreachable", "Kobo upstream request failed");
}

async function startActivation(env) {
  const appVersion = env.KOBO_APP_VERSION || DEFAULT_KOBO_APP_VERSION;
  const deviceId = randomHex(32);
  const serialNumber = randomHex(16);

  // Match the e-reader/client flow: register an anonymous device first, then
  // initialize it, and only then start the web activation for that same device.
  const bootstrap = await authenticateKoboDevice({ userKey: "", deviceId, serialNumber, appVersion });
  await getInitialization({ accessToken: bootstrap.accessToken, refreshToken: bootstrap.refreshToken }, appVersion);

  const u = new URL(`${KOBO_AUTH}/ActivateOnWeb`);
  u.search = new URLSearchParams({
    pwspid: PLATFORM_ID,
    wsa: KOBO_AFFILIATE,
    pwsdid: deviceId,
    pwsav: appVersion,
    pwsdm: PLATFORM_ID,
    pwspos: "3.0.35+",
    pwspov: "NA"
  }).toString();

  const r = await koboFetch(u, { headers: koboHeaders(null, appVersion), redirect: "follow" });
  if (!r.ok) return upstreamError("kobo_activation_start", r);
  const html = await r.text();
  const pollMatch = html.match(/data-poll-endpoint=["']([^"']+)["']/i);
  const codeMatch = html.match(/qrcodegenerator\/generate.+?%26code%3D(\d+)/i) || html.match(/[?&]code(?:=|%3D)(\d{4,12})/i);
  if (!pollMatch || !codeMatch) {
    return json({ error: "activation_parse_failed", message: "Le format de la page d'activation Kobo a changé." }, 502);
  }
  const pollUrl = new URL(decodeHtml(pollMatch[1]), KOBO_AUTH).toString();
  return json({
    status: "pending",
    activationCode: codeMatch[1],
    activationUrl: "https://www.kobo.com/activate",
    pollUrl,
    deviceId,
    serialNumber,
    appVersion
  });
}

function decodeHtml(s) {
  return s.replaceAll("&amp;", "&").replaceAll("&#x2F;", "/").replaceAll("&#47;", "/");
}

function validatePollUrl(value) {
  let u;
  try { u = new URL(value); } catch { throw new HttpError(400, "invalid_poll_url", "Invalid poll URL"); }
  if (u.protocol !== "https:" || u.hostname !== "auth.kobobooks.com") {
    throw new HttpError(400, "invalid_poll_url", "Poll URL host is not allowed");
  }
  return u;
}

async function pollActivation(request, env) {
  try {
    const body = await readJson(request);
    const pollUrl = validatePollUrl(body.pollUrl);
    if (!/^[a-f0-9]{64}$/.test(body.deviceId || "") || !/^[a-f0-9]{32}$/.test(body.serialNumber || "")) {
      throw new HttpError(400, "invalid_device", "Invalid activation device identifiers");
    }
    const appVersion = body.appVersion || env.KOBO_APP_VERSION || DEFAULT_KOBO_APP_VERSION;
    const r = await koboFetch(pollUrl, { method: "POST", headers: koboHeaders(null, appVersion) });
    if (!r.ok) return upstreamError("kobo_activation_poll", r);
    const result = await r.json();
    if (result.Status !== "Complete") return json({ status: String(result.Status || "pending").toLowerCase() });

    const redirect = new URL(result.RedirectUrl);
    const userKey = redirect.searchParams.get("userKey");
    const userId = redirect.searchParams.get("userId");
    if (!userKey) throw new HttpError(502, "missing_user_key", "Kobo activation completed without userKey");

    const tokenResult = await authenticateKoboDevice({ userKey, deviceId: body.deviceId, serialNumber: body.serialNumber, appVersion });
    return json({ status: "complete", userId, ...tokenResult });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status);
    throw e;
  }
}

async function authenticateKoboDevice({ userKey, deviceId, serialNumber, appVersion }) {
  const payload = {
    AffiliateName: KOBO_AFFILIATE,
    AppVersion: appVersion,
    ClientKey: b64Utf8(PLATFORM_ID),
    DeviceId: deviceId,
    PlatformId: PLATFORM_ID,
    SerialNumber: serialNumber
  };
  if (userKey) payload.UserKey = userKey;
  const r = await koboFetch(`${KOBO_STORE}/v1/auth/device`, {
    method: "POST",
    headers: { ...Object.fromEntries(koboHeaders(null, appVersion)), "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw koboHttpError("kobo_device_auth_failed", r, "Kobo device auth failed");
  const j = await r.json();
  if (j.TokenType && j.TokenType !== "Bearer") throw new HttpError(502, "unsupported_token_type", "Unsupported Kobo token type");
  return {
    accessToken: j.AccessToken,
    refreshToken: j.RefreshToken,
    userKey: j.UserKey || userKey,
    deviceId,
    serialNumber,
    appVersion
  };
}

async function refreshKoboToken(auth, appVersion) {
  const payload = {
    AppVersion: appVersion,
    ClientKey: b64Utf8(PLATFORM_ID),
    PlatformId: PLATFORM_ID,
    RefreshToken: auth.refreshToken
  };
  const r = await koboFetch(`${KOBO_STORE}/v1/auth/refresh`, {
    method: "POST",
    headers: { ...Object.fromEntries(koboHeaders(auth.accessToken, appVersion)), "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!r.ok) throw koboHttpError("kobo_refresh_failed", r, "Kobo token refresh failed", { unauthorizedStatus:401 });
  const j = await r.json();
  return { ...auth, accessToken: j.AccessToken, refreshToken: j.RefreshToken || auth.refreshToken };
}

async function koboAuthedFetch(url, auth, appVersion, init = {}) {
  let current = auth;
  const doFetch = () => koboFetch(url, { ...init, headers: mergeHeaders(koboHeaders(current.accessToken, appVersion), init.headers) });
  let r = await doFetch();
  let refreshed = false;
  if (r.status === 401 && current.refreshToken) {
    current = await refreshKoboToken(current, appVersion);
    refreshed = true;
    r = await doFetch();
  }
  return { response: r, auth: current, refreshed };
}

function mergeHeaders(a, b) {
  const h = new Headers(a);
  if (b) new Headers(b).forEach((v, k) => h.set(k, v));
  return h;
}

async function getInitialization(auth, appVersion) {
  const out = await koboAuthedFetch(`${KOBO_STORE}/v1/initialization`, auth, appVersion);
  if (!out.response.ok) throw koboHttpError("kobo_initialization_failed", out.response, "Kobo initialization failed", { unauthorizedStatus:401 });
  const j = await out.response.json();
  return { resources: j.Resources || {}, auth: out.auth, refreshed: out.refreshed };
}

async function fetchKoboLibrarySnapshot(auth, appVersion) {
  const init = await getInitialization(auth, appVersion);
  auth = init.auth;
  const libraryUrl = init.resources.library_sync || `${KOBO_STORE}/v1/library/sync`;
  const all = [];
  let syncToken = "";
  let pages = 0;
  let refreshed = init.refreshed;
  do {
    const headers = syncToken ? { "x-kobo-synctoken": syncToken } : {};
    const u = new URL(libraryUrl);
    u.searchParams.set("Filter", "ALL");
    u.searchParams.set("DownloadUrlFilter", "Generic,Android");
    u.searchParams.set("PrioritizeRecentReads", "true");
    const out = await koboAuthedFetch(u, auth, appVersion, { headers });
    auth = out.auth; refreshed ||= out.refreshed;
    if (!out.response.ok) throw koboHttpError("kobo_library_sync", out.response, "Kobo library sync failed", { unauthorizedStatus:401 });
    const page = await out.response.json();
    if (Array.isArray(page)) all.push(...page);
    pages += 1;
    if (pages > 100) throw new HttpError(502, "too_many_sync_pages", "Kobo sync pagination exceeded safety limit");
    syncToken = out.response.headers.get("x-kobo-sync") === "continue" ? (out.response.headers.get("x-kobo-synctoken") || "") : "";
  } while (syncToken);

  return {
    purchases: normalizeLibraryEvents(all),
    pages,
    refreshed,
    auth,
    fetchedAt: new Date().toISOString()
  };
}

async function getKoboLibrary(request, env, ctx) {
  try {
    const body = await readJson(request);
    const auth = validateKoboAuth(body);
    const appVersion = body.appVersion || env.KOBO_APP_VERSION || DEFAULT_KOBO_APP_VERSION;
    const result = await fetchKoboLibrarySnapshot(auth, appVersion);
    return json({
      purchases: result.purchases,
      count: result.purchases.length,
      pages: result.pages,
      tokenRefreshed: result.refreshed,
      auth: result.refreshed ? { ...result.auth, appVersion } : undefined,
      fetchedAt: result.fetchedAt
    });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status, e.headers);
    throw e;
  }
}

function projectionItemFromBook(book) {
  return normalizeProjectionItem({
    product_id: book.productId || book.revisionId || "",
    revision_id: book.revisionId || "",
    isbn: book.isbn || "",
    title: book.title || "(sans titre)",
    authors: Array.isArray(book.authors) ? book.authors : [],
    language: book.language || "",
    publisher: book.publisher || "",
    publication_date: book.publicationDate || "",
    description: book.description || "",
    cover_url: coverUrlForBook(book),
    product_url: book.koboUrl || "",
    format: book.mediaType === "ebook" ? "EPUB" : "",
    content_type: book.mediaType || "ebook",
    downloadable: book.mediaType === "ebook",
    archived: Boolean(book.archived)
  });
}

async function ensureAutoProjectionAccount(env, uidHash, bundle, now) {
  const existing = await env.KOBO_VAULT.prepare(
    "SELECT account_id, display_name, email_hint FROM account_projection WHERE uid_hash = ?"
  ).bind(uidHash).first();
  if (existing) return { id:existing.account_id, display_name:existing.display_name, email_hint:existing.email_hint || null };
  const rawAccount = compactText(bundle?.userId, 300) || uidHash;
  return { id:await sha256Hex(`kobo-account:${rawAccount}`), display_name:"Compte Kobo lié", email_hint:null };
}

export async function ensureFreshLibraryProjection(env, uidHash, nowMs = Date.now()) {
  const state = await readLibrarySyncState(env, uidHash);
  if (timestampIsWithin(state?.last_success_at, LIBRARY_SYNC_FRESH_MS, nowMs)) {
    return { status:"fresh", last_success_at:state.last_success_at };
  }
  if (timestampIsWithin(state?.refresh_started_at, LIBRARY_SYNC_LOCK_MS, nowMs)) {
    return { status:"refreshing", last_success_at:state?.last_success_at || null };
  }
  if (state?.last_error && timestampIsWithin(state?.last_attempt_at, LIBRARY_SYNC_FAILURE_BACKOFF_MS, nowMs)) {
    return { status:"backoff", last_success_at:state?.last_success_at || null, error:state.last_error };
  }
  const locked = await acquireLibraryRefreshLock(env, uidHash, nowMs);
  if (!locked) return { status:"refreshing", last_success_at:state?.last_success_at || null };

  try {
    const credentials = await loadApiKoboCredentials(env, uidHash);
    const bundle = credentials.bundle || {};
    const appVersion = compactText(bundle.appVersion || env.KOBO_APP_VERSION || DEFAULT_KOBO_APP_VERSION, 80) || DEFAULT_KOBO_APP_VERSION;
    const auth = validateKoboAuth(bundle);
    const result = await fetchKoboLibrarySnapshot(auth, appVersion);
    if (result.refreshed) {
      await storeRefreshedApiKoboCredentials(env, uidHash, { ...bundle, ...result.auth, appVersion });
    }
    const items = result.purchases.map(projectionItemFromBook).filter(Boolean);
    if (items.length > API_MAX_PROJECTION_ITEMS) throw new HttpError(502, "library_too_large", `Projection limitée à ${API_MAX_PROJECTION_ITEMS} éléments`);
    const account = await ensureAutoProjectionAccount(env, uidHash, bundle, result.fetchedAt);
    await writeLibraryProjection(env, uidHash, items, account, result.fetchedAt);
    await markLibrarySyncSuccess(env, uidHash, result.fetchedAt);
    return { status:"refreshed", count:items.length, last_success_at:result.fetchedAt };
  } catch (error) {
    await markLibrarySyncFailure(env, uidHash, error);
    // The Provider remains usable with its last published projection when Kobo is unavailable.
    return { status:"stale", last_success_at:state?.last_success_at || null, error:error instanceof HttpError ? error.code : "library_refresh_failed" };
  }
}

function validateKoboAuth(body) {
  const accessToken = String(body.accessToken || "");
  const refreshToken = String(body.refreshToken || "");
  if (accessToken.length < 10 || accessToken.length > 10000) throw new HttpError(400, "invalid_access_token", "Invalid Kobo access token");
  if (refreshToken.length > 10000) throw new HttpError(400, "invalid_refresh_token", "Invalid Kobo refresh token");
  return { accessToken, refreshToken };
}

export function normalizeLibraryEvents(events) {
  const byId = new Map();
  for (const event of events || []) {
    const e = event?.NewEntitlement || event?.ChangedEntitlement || event?.Entitlement || event;
    if (!e || typeof e !== "object") continue;
    const entitlement = e.BookEntitlement || e.AudiobookEntitlement || e.Entitlement || {};
    const metadata = e.BookMetadata || e.AudiobookMetadata || e.ProductMetadata?.Book || e.ProductMetadata?.Audiobook;
    if (!metadata || !metadata.Title) continue;
    if (entitlement.Accessibility === "Preview" || entitlement.IsLocked === true) continue;
    const item = normalizeBook(metadata, entitlement, e);
    const id = item.revisionId || item.productId || item.isbn || `${item.title}|${item.authors.join("|")}`;
    if (!byId.has(id) || e.BookMetadata || e.AudiobookMetadata) byId.set(id, item);
  }
  return [...byId.values()].sort((a, b) => a.title.localeCompare(b.title, "fr", { sensitivity: "base" }));
}

function normalizeStringList(value, max = 30) {
  const raw = Array.isArray(value) ? value : (value ? [value] : []);
  const out = [];
  for (const item of raw) {
    const text = compactText(typeof item === "string" ? item : (item?.Name ?? item?.Title ?? item?.Label ?? ""), 200);
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

function normalizeKoboPrice(m) {
  const price = m?.Price ?? m?.CurrentPrice ?? m?.Prices?.[0] ?? null;
  if (!price) return null;
  const amount = price.Amount ?? price.Value ?? price.amount ?? price.value ?? (typeof price === "number" || typeof price === "string" ? price : null);
  const currency = price.CurrencyCode ?? price.Currency ?? price.currency ?? m?.CurrencyCode ?? null;
  if (amount === null || amount === undefined || amount === "") return null;
  return { amount:String(amount), currency:currency ? String(currency) : null };
}

function normalizeBook(m, entitlement = {}, envelope = {}) {
  const contributors = Array.isArray(m.ContributorRoles) ? m.ContributorRoles : (Array.isArray(m.Contributors) ? m.Contributors : []);
  let authors = contributors.filter(c => !c.Role || String(c.Role).toLowerCase() === "author").map(c => c.Name || c).filter(Boolean);
  if (!authors.length && contributors.length) authors = [contributors[0].Name || contributors[0]].filter(Boolean);
  if (!authors.length && m.Author) authors = [m.Author];
  const series = m.Series?.Name || m.SeriesName || m.Series || "";
  const reading = envelope.ReadingState?.StatusInfo?.Status || envelope.ReadingState?.Status || "";
  return {
    revisionId: m.RevisionId || m.RevisionID || "",
    productId: m.ProductId || m.Id || m.CrossRevisionId || "",
    title: m.Title || "",
    subtitle: m.Subtitle || "",
    authors,
    isbn: m.ISBN || m.Isbn || "",
    language: normalizeLanguage(m.Language || m.LanguageCode || ""),
    series: typeof series === "string" ? series : "",
    seriesNumber: m.SeriesNumber || m.SeriesNumberFloat || "",
    publisher: m.Publisher?.Name || m.Publisher || "",
    description: m.Description || m.ShortDescription || "",
    publicationDate: m.PublicationDate || m.ReleaseDate || m.DatePublished || m.PublishedDate || m.Release?.Date || m.Availability?.StartDate || "",
    subjects: normalizeStringList(m.Subjects || m.Categories || m.Genres || m.Subject || []),
    price: normalizeKoboPrice(m),
    averageRating: extractAverageRating(m),
    ratingCount: extractRatingCount(m),
    coverUrl: normalizeCoverUrl(m.CoverImageUrl || m.CoverImageURL || m.CoverUrl || m.CoverURL || m.ImageUrl || m.ImageURL || ""),
    coverImageId: m.CoverImageId || m.CoverImageID || m.ImageId || m.ImageID || "",
    koboUrl: extractKoboUrl(m),
    mediaType: eMediaType(m, envelope),
    accessibility: entitlement.Accessibility || "",
    archived: Boolean(entitlement.IsRemoved),
    readStatus: reading,
    acquiredAt: entitlement.Created || entitlement.DateCreated || entitlement.PurchaseDate || ""
  };
}

function eMediaType(m, envelope) {
  if (envelope.AudiobookMetadata || m.Type === "Audiobook" || m.ProductType === "Audiobook") return "audiobook";
  return "ebook";
}

function firstFinite(values, { min = -Infinity, max = Infinity, integer = false } = {}) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const n = Number(value);
    if (!Number.isFinite(n) || n < min || n > max) continue;
    return integer ? Math.max(0, Math.round(n)) : n;
  }
  return null;
}

function extractAverageRating(node) {
  if (!node || typeof node !== "object") return null;
  return firstFinite([
    node.AverageRating, node.averageRating, node.AverageStarRating, node.averageStarRating, node.RatingValue, node.ratingValue,
    node.AggregateRating?.RatingValue, node.AggregateRating?.ratingValue, node.aggregateRating?.ratingValue,
    node.ReviewSummary?.AverageRating, node.ReviewSummary?.averageRating,
    node.RatingSummary?.AverageRating, node.RatingSummary?.averageRating,
    node.Ratings?.AverageRating, node.Ratings?.averageRating,
    node.Reviews?.AverageRating, node.Reviews?.averageRating
  ], { min: 0.000001, max: 5 });
}

function extractRatingCount(node) {
  if (!node || typeof node !== "object") return null;
  return firstFinite([
    node.RatingCount, node.ratingCount, node.ReviewCount, node.reviewCount, node.ReviewsCount, node.reviewsCount,
    node.AggregateRating?.RatingCount, node.AggregateRating?.ratingCount, node.AggregateRating?.ReviewCount, node.AggregateRating?.reviewCount,
    node.aggregateRating?.ratingCount, node.aggregateRating?.reviewCount,
    node.TotalRatingCount, node.totalRatingCount, node.TotalReviewCount, node.totalReviewCount,
    node.ReviewSummary?.RatingCount, node.ReviewSummary?.ratingCount, node.ReviewSummary?.ReviewCount, node.ReviewSummary?.reviewCount, node.ReviewSummary?.TotalCount, node.ReviewSummary?.totalCount,
    node.RatingSummary?.RatingCount, node.RatingSummary?.ratingCount, node.RatingSummary?.TotalCount, node.RatingSummary?.totalCount,
    node.Reviews?.TotalCount, node.Reviews?.totalCount
  ], { min: 0, integer: true });
}

function ratingProductId(node) {
  if (!node || typeof node !== "object") return "";
  return String(node.ProductId || node.ProductID || node.productId || node.CrossRevisionId || node.crossRevisionId || node.RevisionId || node.revisionId || node.Product?.Id || node.Product?.ProductId || "");
}

export function extractRatingSummaries(payload, expectedIds = []) {
  const expected = new Set((expectedIds || []).map(String));
  const found = new Map(); const seen = new Set();
  const add = (id, node) => {
    const averageRating = extractAverageRating(node), ratingCount = extractRatingCount(node);
    if (averageRating === null && ratingCount === null) return;
    const key = String(id || ""); if (!key || (expected.size && !expected.has(key))) return;
    const prev = found.get(key) || {};
    found.set(key, { averageRating: averageRating ?? prev.averageRating ?? null, ratingCount: ratingCount ?? prev.ratingCount ?? null });
  };
  const walk = (node, hintedId = "", depth = 0) => {
    if (!node || typeof node !== "object" || depth > 10 || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { for (const item of node) walk(item, hintedId, depth + 1); return; }
    const ownId = ratingProductId(node) || hintedId; add(ownId, node);
    for (const [key, value] of Object.entries(node)) {
      const childHint = expected.has(key) ? key : ownId;
      walk(value, childHint, depth + 1);
    }
  };
  walk(payload);
  if (found.size === 0 && expected.size === 1) {
    const only = [...expected][0];
    const scan = (node, depth = 0) => {
      if (!node || typeof node !== "object" || depth > 10) return null;
      const avg = extractAverageRating(node), count = extractRatingCount(node);
      if (avg !== null || count !== null) return { averageRating: avg, ratingCount: count };
      for (const value of Object.values(node)) { const result = scan(value, depth + 1); if (result) return result; }
      return null;
    };
    const result = scan(payload); if (result) found.set(only, result);
  }
  return Object.fromEntries(found);
}

export function parsePublicKoboRatingHtml(html) {
  const source = String(html || "");
  const candidates = [];
  for (const match of source.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const value = JSON.parse(decodeBasicEntities(match[1].trim()));
      const found = findStructuredRating(value); if (found) candidates.push(found);
    } catch {}
  }
  if (candidates.length) return candidates.sort((a,b)=>(b.ratingCount||0)-(a.ratingCount||0))[0];
  const genericRating = source.match(/["'](?:ratingValue|AverageRating|averageRating)["']\s*:\s*["']?([0-5](?:[.,]\d+)?)/i);
  const genericCount = source.match(/["'](?:ratingCount|reviewCount|RatingCount|ReviewCount)["']\s*:\s*["']?([0-9][0-9 .,_]*)/i);
  if (genericRating) return { averageRating: parseDecimal(genericRating[1]), ratingCount: parseCount(genericCount?.[1]), source: "embedded-json" };
  const text = decodeBasicEntities(source.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ")).replace(/\s+/g," ").trim();
  const anchor = text.search(/Avis et critiques de livres|Book Reviews|Ratings and Reviews|Reseñas|Bewertungen/i);
  const segment = anchor >= 0 ? text.slice(anchor, anchor + 2500) : text;
  const visibleRating = segment.match(/([0-5](?:[.,]\d+)?)\s*\/\s*5\b/i);
  const countScope = visibleRating ? segment.slice((visibleRating.index || 0) + visibleRating[0].length) : segment;
  const visibleCount = countScope.match(/([0-9][0-9 .,_]*)\s*(?:notes?|évaluations?|evaluations?|ratings?|avis|reviews?)\b/i);
  if (visibleRating) return { averageRating: parseDecimal(visibleRating[1]), ratingCount: parseCount(visibleCount?.[1]), source: "visible-html" };
  return null;
}

function findStructuredRating(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 12) return null;
  if (Array.isArray(value)) { for (const item of value) { const r = findStructuredRating(item, depth + 1); if (r) return r; } return null; }
  const type = String(value["@type"] || "").toLowerCase();
  const aggregate = value.aggregateRating || value.AggregateRating;
  for (const node of [aggregate, type === "aggregaterating" ? value : null].filter(Boolean)) {
    const averageRating = extractAverageRating(node), ratingCount = extractRatingCount(node);
    if (averageRating !== null) return { averageRating, ratingCount, source: "json-ld" };
  }
  for (const child of Object.values(value)) { const r = findStructuredRating(child, depth + 1); if (r) return r; }
  return null;
}

function parseDecimal(value) { const n = Number(String(value ?? "").replace(",", ".")); return Number.isFinite(n) && n > 0 && n <= 5 ? n : null; }
function parseCount(value) { if (value == null) return null; const n = Number(String(value).replace(/[^0-9]/g, "")); return Number.isFinite(n) ? n : null; }
function decodeBasicEntities(value) { return String(value || "").replace(/&quot;/gi,'"').replace(/&#34;/g,'"').replace(/&#x27;|&#39;/gi,"'").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<").replace(/&gt;/gi,">").replace(/&nbsp;|&#160;/gi," "); }

export function extractPublicKoboProductUrl(html, baseUrl = "https://www.kobo.com/fr/fr/") {
  const source = String(html || "");
  const patterns = [
    /<link[^>]+rel=["'][^"']*canonical[^"']*["'][^>]+href=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i,
    /href=["']([^"']+\/(?:ebook|audiobook)\/[^"'?#]+)["']/i
  ];
  for (const pattern of patterns) { const match = source.match(pattern); if (!match) continue; const url = sanitizePublicKoboUrl(decodeBasicEntities(match[1]), baseUrl); if (url && /\/(?:ebook|audiobook)\//i.test(new URL(url).pathname)) return url; }
  return "";
}

function sanitizePublicKoboUrl(value, base = "https://www.kobo.com/fr/fr/") {
  try { const u = new URL(String(value || ""), base); const host = u.hostname.toLowerCase(); if (u.protocol !== "https:" || !(host === "kobo.com" || host === "www.kobo.com" || host.endsWith(".kobo.com"))) return ""; u.hash = ""; return u.toString(); } catch { return ""; }
}

async function getKoboRatings(request, env, ctx) {
  try {
    const body = await readJson(request);
    const books = Array.isArray(body.books) ? body.books.slice(0, 8) : [];
    if (!books.length) throw new HttpError(400, "ratings_empty", "No books supplied for rating lookup");
    const forceRefresh = body.forceRefresh === true;
    const appVersion = body.appVersion || env.KOBO_APP_VERSION || DEFAULT_KOBO_APP_VERSION;
    let auth = null; let resources = {}; let refreshed = false;
    if (body.accessToken) {
      const init = await getInitialization(validateKoboAuth(body), appVersion);
      auth = init.auth; resources = init.resources || {}; refreshed = init.refreshed;
    }
    const items = await Promise.all(books.map(book => ratingForBook(book, { env, ctx, forceRefresh, auth, resources, appVersion })));
    const sourceCounts = {};
    for (const item of items) sourceCounts[item.source || "none"] = (sourceCounts[item.source || "none"] || 0) + 1;
    return json({
      items,
      failed: items.filter(x => x.error).length,
      rated: items.filter(x => x.averageRating != null).length,
      sourceCounts,
      fetchedAt: new Date().toISOString(),
      auth: refreshed ? { ...auth, appVersion } : undefined
    });
  } catch (e) { if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status); throw e; }
}

async function ratingForBook(book, { env, ctx, forceRefresh, auth, resources, appVersion }) {
  const clientKey = String(book?.clientKey || "").slice(0, 500);
  const identity = String(book?.revisionId || book?.productId || book?.isbn || `${book?.title || ""}|${book?.authors?.[0] || ""}`).slice(0, 1000);
  if (!identity.trim()) return { clientKey, averageRating: null, ratingCount: null, source: "none", error: "missing_identity" };
  const cache = globalThis.caches?.default;
  const cacheHash = await sha256Hex(`rating-v4|${identity}|${book?.productId || ""}|${book?.koboUrl || ""}`);
  const cacheKey = new Request(`https://kobo-rating-cache.invalid/v4/${cacheHash}`);
  if (cache && !forceRefresh) {
    const hit = await cache.match(cacheKey);
    if (hit) { const cached = await hit.json(); return { clientKey, ...cached, cacheStatus: "hit" }; }
  }

  const attempts = [];
  let result = null;
  if (auth) result = await fetchRatingFromKoboApi(book, { auth, resources, appVersion, attempts });
  if (!result?.averageRating) {
    try {
      const publicResult = await fetchPublicKoboRating(book, env, { attempts });
      if (publicResult?.averageRating != null) result = publicResult;
      else if (!result) result = publicResult;
    } catch (e) { attempts.push({ source: "public", status: 0, error: safeError(e) }); }
  }
  result ||= { averageRating: null, ratingCount: null, productUrl: "", source: "none" };
  const clean = {
    averageRating: result.averageRating ?? null,
    ratingCount: result.ratingCount ?? null,
    productUrl: result.productUrl || book?.koboUrl || "",
    source: result.source || "none"
  };
  // Ne jamais mettre en cache un échec / une absence de note : Kobo sert plusieurs variantes
  // de pages et l'API non documentée peut évoluer. Les résultats positifs restent cacheables.
  if (cache && clean.averageRating != null) {
    const ttl = Math.min(Math.max(Number(env.RATING_CACHE_TTL_SECONDS) || 604800, 3600), 2592000);
    const cached = json(clean, 200, { "Cache-Control": `public, max-age=${ttl}` });
    const put = cache.put(cacheKey, cached); if (ctx?.waitUntil) ctx.waitUntil(put); else await put;
  }
  return { clientKey, ...clean, cacheStatus: forceRefresh ? "refresh" : "miss" };
}

async function fetchRatingFromKoboApi(book, { auth, resources, appVersion, attempts = [] }) {
  // Les endpoints détaillés Kobo utilisent le RevisionId comme identifiant de route.
  // Le ReviewSummary retourné est, lui, indexé par CrossRevisionId/ProductId.
  const revisionId = String(book?.revisionId || "").trim();
  const productId = String(book?.productId || "").trim();
  const fallbackIds = [...new Set([productId, book?.isbn].map(x => String(x || "").trim()).filter(Boolean))];
  const ids = [...new Set([revisionId, ...fallbackIds].filter(Boolean))].slice(0, 3);
  if (!ids.length) return null;

  // Source prioritaire validée sur les réponses Kobo réelles :
  // ReviewSummary[ProductId].AvgRating + OpinionCount, via /products/{RevisionId}/reviews.
  const reviewsTemplate = resources.product_reviews || `${KOBO_STORE}/v1/products/{ProductIds}/reviews`;
  for (const id of ids) {
    const url = replaceTemplateId(reviewsTemplate, "ProductIds", id);
    const u = new URL(url); u.searchParams.set("PageIndex", "0"); u.searchParams.set("PageSize", "100");
    const probe = await fetchKoboJsonProbe(u.toString(), auth, appVersion);
    const rating = probe.payload ? extractReviewAggregate(probe.payload, productId) : null;
    attempts.push(makeApiAttempt("api-reviews", id, u.toString(), probe, rating));
    if (rating?.averageRating != null) return { ...rating, productUrl: book?.koboUrl || "", source: rating.source || "api-reviews" };
    if (probe.status === 401 || probe.status === 403) break;
    // Si un RevisionId existe, les autres identifiants ne sont que des fallbacks de compatibilité.
    if (revisionId && id === revisionId && probe.ok) break;
  }

  // Fallback : /products/books/{RevisionId} expose Rating + TotalRating.
  const detailTemplate = book?.mediaType === "audiobook"
    ? (resources.audiobook || `${KOBO_STORE}/v1/products/audiobooks/{ProductId}`)
    : (resources.book || `${KOBO_STORE}/v1/products/books/{ProductId}`);
  for (const id of ids) {
    const url = replaceTemplateId(detailTemplate, "ProductId", id);
    const probe = await fetchKoboJsonProbe(url, auth, appVersion);
    const rating = probe.payload ? (extractKoboBookRating(probe.payload) || extractBestRatingFromPayload(probe.payload)) : null;
    attempts.push(makeApiAttempt("api-book", id, url, probe, rating));
    if (rating?.averageRating != null) return { ...rating, productUrl: book?.koboUrl || "", source: rating.source || "api-book" };
    if (probe.status === 401 || probe.status === 403) break;
    if (revisionId && id === revisionId && probe.ok) break;
  }
  return null;
}

export function extractKoboBookRating(payload) {
  const candidates = [];
  const add = node => {
    if (!node || typeof node !== "object") return;
    const averageRating = firstFinite([node.Rating, node.AvgRating, node.AverageRating], { min: 0.000001, max: 5 });
    const ratingCount = firstFinite([node.TotalRating, node.OpinionCount, node.RatingCount], { min: 0, integer: true });
    if (averageRating !== null) candidates.push({ averageRating, ratingCount, source: "api-book-rating" });
  };
  add(payload);
  add(payload?.Book);
  add(payload?.Product?.Book);
  if (!candidates.length) return null;
  return candidates.sort((a,b)=>(b.ratingCount ?? -1)-(a.ratingCount ?? -1))[0];
}

export function extractKoboReviewSummary(payload, expectedProductId = "") {
  const summary = payload?.ReviewSummary;
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return null;
  const nodes = [];
  if (expectedProductId && summary[expectedProductId] && typeof summary[expectedProductId] === "object") nodes.push(summary[expectedProductId]);
  for (const value of Object.values(summary)) if (value && typeof value === "object" && !Array.isArray(value) && !nodes.includes(value)) nodes.push(value);
  // Certaines variantes renvoient directement les champs dans ReviewSummary.
  nodes.push(summary);
  for (const node of nodes) {
    const averageRating = firstFinite([node.AvgRating, node.AverageRating, node.averageRating, node.Rating], { min: 0.000001, max: 5 });
    // OpinionCount = nombre de notes. NumberOfReviews = nombre de critiques textuelles : ne pas l'utiliser ici.
    const ratingCount = firstFinite([node.OpinionCount, node.RatingCount, node.ratingCount, node.TotalRating, node.TotalCount], { min: 0, integer: true });
    if (averageRating !== null) return { averageRating, ratingCount, source: "api-reviews-summary" };
  }
  return null;
}

function replaceTemplateId(template, name, value) {
  const encoded = encodeURIComponent(String(value || ""));
  const token = `{${name}}`;
  if (String(template || "").includes(token)) return String(template).replace(token, encoded);
  return String(template || "").replace(/\/+$/, "") + "/" + encoded;
}

async function fetchKoboJsonProbe(url, auth, appVersion) {
  try {
    const response = await koboFetch(url, { headers: koboHeaders(auth?.accessToken || "", appVersion), redirect: "follow" });
    const contentType = response.headers.get("content-type") || "";
    let payload = null; let parseError = "";
    if (response.ok || /json/i.test(contentType)) {
      try { payload = await response.json(); } catch (e) { parseError = safeError(e); }
    } else { try { await response.arrayBuffer(); } catch {} }
    return { status: response.status, ok: response.ok, contentType, payload, parseError };
  } catch (e) { return { status: 0, ok: false, contentType: "", payload: null, error: safeError(e) }; }
}

export function extractBestRatingFromPayload(payload) {
  const seen = new Set(); let best = null;
  const walk = (node, depth = 0) => {
    if (!node || typeof node !== "object" || depth > 12 || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { for (const item of node) walk(item, depth + 1); return; }
    const avg = extractAverageRating(node), count = extractRatingCount(node);
    if (avg !== null) {
      const candidate = { averageRating: avg, ratingCount: count, source: "api-summary" };
      if (!best || (candidate.ratingCount ?? -1) > (best.ratingCount ?? -1)) best = candidate;
    }
    for (const value of Object.values(node)) walk(value, depth + 1);
  };
  walk(payload);
  return best;
}

export function extractReviewAggregate(payload, expectedProductId = "") {
  const koboSummary = extractKoboReviewSummary(payload, expectedProductId);
  if (koboSummary?.averageRating != null) return koboSummary;
  const summary = extractBestRatingFromPayload(payload);
  if (summary?.averageRating != null) return { ...summary, source: "api-reviews-summary" };
  const distribution = findRatingDistribution(payload);
  if (distribution) return distribution;
  const ratings = [];
  const seen = new Set();
  const walk = (node, depth = 0) => {
    if (!node || typeof node !== "object" || depth > 12 || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { for (const item of node) walk(item, depth + 1); return; }
    const looksReview = node.ReviewId || node.reviewId || node.Reviewer || node.reviewer || node.ReviewText || node.reviewText || node.Content || node.content || node.Body || node.body;
    const raw = looksReview ? (node.Rating ?? node.rating ?? node.StarRating ?? node.starRating ?? node.Stars ?? node.stars) : null;
    const n = Number(raw); if (Number.isFinite(n) && n >= 1 && n <= 5) ratings.push(n);
    for (const value of Object.values(node)) walk(value, depth + 1);
  };
  walk(payload);
  if (!ratings.length) return null;
  const total = findLikelyReviewTotal(payload);
  const complete = total === null ? (Array.isArray(payload) && ratings.length === payload.length) : total <= ratings.length;
  if (!complete) return null; // ne jamais présenter la moyenne d'une seule page comme moyenne communautaire globale
  return { averageRating: ratings.reduce((a,b)=>a+b,0) / ratings.length, ratingCount: total ?? ratings.length, source: "api-reviews-complete" };
}

function findRatingDistribution(payload) {
  let result = null; const seen = new Set();
  const walk = (node, depth = 0) => {
    if (result || !node || typeof node !== "object" || depth > 10 || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { for (const item of node) walk(item, depth + 1); return; }
    const pairs = [];
    for (let star = 1; star <= 5; star++) {
      const values = [node[star], node[String(star)], node[`${star}Star`], node[`${star}Stars`], node[`Star${star}`], node[`Rating${star}`]];
      const count = firstFinite(values, { min: 0, integer: true }); if (count !== null) pairs.push([star, count]);
    }
    if (pairs.length >= 4) {
      const count = pairs.reduce((sum, [,n]) => sum + n, 0);
      if (count > 0) result = { averageRating: pairs.reduce((sum,[star,n])=>sum+star*n,0)/count, ratingCount: count, source: "api-reviews-distribution" };
    }
    for (const value of Object.values(node)) walk(value, depth + 1);
  };
  walk(payload); return result;
}

function findLikelyReviewTotal(payload) {
  let best = null; const seen = new Set();
  const walk = (node, depth = 0) => {
    if (!node || typeof node !== "object" || depth > 8 || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { for (const item of node) walk(item, depth + 1); return; }
    for (const [key, value] of Object.entries(node)) {
      if (/^(?:TotalCount|ReviewCount|RatingCount|TotalReviewCount|TotalRatingCount)$/i.test(key)) {
        const n = Number(value); if (Number.isFinite(n) && n >= 0) best = best === null ? n : Math.max(best, n);
      }
      if (value && typeof value === "object") walk(value, depth + 1);
    }
  };
  walk(payload); return best;
}

function makeApiAttempt(source, identifier, url, probe, rating) {
  return {
    source, identifier, endpoint: safeEndpoint(url), status: probe.status, ok: probe.ok,
    contentType: probe.contentType || "", rating: rating || null,
    topLevelKeys: probe.payload && typeof probe.payload === "object" && !Array.isArray(probe.payload) ? Object.keys(probe.payload).slice(0, 40) : [],
    signals: probe.payload ? collectRatingSignals(probe.payload) : [],
    error: probe.error || probe.parseError || ""
  };
}

export function collectRatingSignals(payload, max = 40) {
  const out = []; const seen = new Set();
  const walk = (node, path = "$", depth = 0) => {
    if (out.length >= max || !node || typeof node !== "object" || depth > 10 || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { for (let i=0;i<Math.min(node.length,12);i++) walk(node[i], `${path}[${i}]`, depth+1); return; }
    for (const [key, value] of Object.entries(node)) {
      const child = `${path}.${key}`;
      if (/rating|review|star|score|average|count|total/i.test(key) && (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null)) {
        out.push({ path: child, value: typeof value === "string" ? value.slice(0, 120) : value }); if (out.length >= max) return;
      }
      if (value && typeof value === "object") walk(value, child, depth+1);
    }
  };
  walk(payload); return out;
}

function safeEndpoint(url) {
  try { const u = new URL(url); return `${u.origin}${u.pathname}${u.search}`.slice(0, 500); } catch { return String(url || "").slice(0, 500); }
}

async function diagnoseKoboRating(request, env) {
  try {
    const body = await readJson(request);
    const book = body.book && typeof body.book === "object" ? body.book : null;
    if (!book) throw new HttpError(400, "rating_diagnostic_book", "A book is required");
    const appVersion = body.appVersion || env.KOBO_APP_VERSION || DEFAULT_KOBO_APP_VERSION;
    let auth = null; let resources = {}; let refreshed = false;
    const diagnostics = {
      version: APP_RELEASE,
      book: { title: String(book.title || ""), productId: String(book.productId || ""), revisionId: String(book.revisionId || ""), isbn: String(book.isbn || ""), koboUrl: String(book.koboUrl || "") },
      current: { averageRating: book.averageRating ?? null, ratingCount: book.ratingCount ?? null },
      resources: {}, attempts: [], result: null, generatedAt: new Date().toISOString()
    };
    if (body.accessToken) {
      const init = await getInitialization(validateKoboAuth(body), appVersion);
      auth = init.auth; resources = init.resources || {}; refreshed = init.refreshed;
      diagnostics.resources = {
        book: Boolean(resources.book), audiobook: Boolean(resources.audiobook), product_reviews: Boolean(resources.product_reviews), products: Boolean(resources.products), productsv2: Boolean(resources.productsv2)
      };
      diagnostics.result = await fetchRatingFromKoboApi(book, { auth, resources, appVersion, attempts: diagnostics.attempts });
    } else diagnostics.attempts.push({ source: "api", status: 0, error: "No Kobo device token supplied" });
    if (!diagnostics.result?.averageRating) {
      try {
        const pub = await fetchPublicKoboRating(book, env, { attempts: diagnostics.attempts, diagnostic: true });
        if (pub?.averageRating != null || !diagnostics.result) diagnostics.result = pub;
      } catch (e) { diagnostics.attempts.push({ source: "public", status: 0, error: safeError(e) }); }
    }
    diagnostics.result ||= { averageRating: null, ratingCount: null, source: "none", productUrl: book.koboUrl || "" };
    return json({ ...diagnostics, auth: refreshed ? { ...auth, appVersion } : undefined });
  } catch (e) { if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status); throw e; }
}

async function fetchPublicKoboRating(book, env, { attempts = [], diagnostic = false } = {}) {
  const configured = String(env.KOBO_WEB_LOCALE || "fr/fr").replace(/^\/+|\/+$/g, "") || "fr/fr";
  const locales = [...new Set([configured, "fr/fr", "lu/fr", "be/fr"])];
  let discovered = sanitizePublicKoboUrl(book?.koboUrl, `https://www.kobo.com/${configured}/`);
  let typeAndSlug = "";
  if (discovered) {
    const match = new URL(discovered).pathname.match(/\/(ebook|audiobook)\/([^/?#]+)/i);
    if (match) typeAndSlug = `${match[1]}/${match[2]}`;
  }
  if (!typeAndSlug) {
    const query = String(book?.isbn || [book?.title, book?.authors?.[0]].filter(Boolean).join(" ")).trim();
    if (!query) throw new Error("No public Kobo lookup query");
    const search = new URL(`https://www.kobo.com/${configured}/search`); search.searchParams.set("query", query);
    const lang = String(book?.language || "").split(/[-_]/)[0].toLowerCase(); if (lang) search.searchParams.set("fclanguages", lang);
    const sr = await fetchPublicHtml(search.toString());
    attempts.push({ source: "public-search", endpoint: safeEndpoint(search), status: sr.status, ok: sr.ok, finalUrl: safeEndpoint(sr.url), htmlBytes: sr.html.length });
    if (!sr.ok) throw new Error(`Kobo public search returned ${sr.status}`);
    if (/\/(?:ebook|audiobook)\//i.test(new URL(sr.url).pathname)) discovered = sr.url;
    else discovered = extractPublicKoboProductUrl(sr.html, sr.url || `https://www.kobo.com/${configured}/`);
    if (discovered) { const match = new URL(discovered).pathname.match(/\/(ebook|audiobook)\/([^/?#]+)/i); if (match) typeAndSlug = `${match[1]}/${match[2]}`; }
  }
  if (!typeAndSlug) throw new Error("Kobo public product page not found");
  let lastUrl = discovered || "";
  for (const locale of locales) {
    const url = `https://www.kobo.com/${locale}/${typeAndSlug}`;
    const pr = await fetchPublicHtml(url);
    const rating = pr.ok ? parsePublicKoboRatingHtml(pr.html) : null;
    attempts.push({ source: `public-${locale}`, endpoint: safeEndpoint(url), status: pr.status, ok: pr.ok, finalUrl: safeEndpoint(pr.url), htmlBytes: pr.html.length, rating: rating || null, signals: diagnostic ? collectHtmlRatingSignals(pr.html) : undefined });
    if (pr.ok) lastUrl = pr.url || url;
    if (rating?.averageRating != null) return { averageRating: rating.averageRating, ratingCount: rating.ratingCount, productUrl: lastUrl, source: `${rating.source}:${locale}` };
  }
  return { averageRating: null, ratingCount: null, productUrl: lastUrl, source: "public-product-no-rating" };
}

function collectHtmlRatingSignals(html) {
  const source = String(html || ""); const out = [];
  for (const re of [/aggregateRating/ig,/ratingValue/ig,/ratingCount/ig,/reviewCount/ig,/AverageRating/ig,/\b[0-5](?:[.,]\d+)?\s*\/\s*5\b/ig]) {
    const match = re.exec(source); if (!match) continue; out.push(source.slice(Math.max(0, match.index-80), Math.min(source.length, match.index+180)).replace(/\s+/g," ").slice(0,260));
  }
  return out.slice(0,8);
}

async function fetchPublicHtml(url) {
  const r = await koboFetch(url, { redirect: "follow", headers: {
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.6",
    "User-Agent": "Mozilla/5.0 (Android 14; Mobile; rv:128.0) Gecko/128.0 Firefox/128.0"
  } });
  return { ok: r.ok, status: r.status, url: r.url || url, html: await r.text() };
}


function extractKoboUrl(m) {
  const candidates = [
    m.WebUrl, m.WebURL, m.ProductPageUrl, m.ProductUrl, m.CanonicalUrl, m.Url,
    m.Links?.Product?.Href, m.Links?.Web?.Href, m.Links?.Self?.Href
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}


function normalizeLanguage(v) {
  if (!v) return "";
  if (typeof v === "object") return v.Code || v.Name || "";
  return String(v).replace("_", "-");
}

async function searchKoboCatalog(request, env, ctx) {
  try {
    const body = await readJson(request);
    let auth = validateKoboAuth(body);
    const query = String(body.query || "").trim();
    if (query.length < 2 || query.length > 200) throw new HttpError(400, "invalid_query", "Catalog query must contain 2-200 characters");
    const language = String(body.language || "").slice(0, 20).toLowerCase();
    const pageSize = Math.min(Math.max(Number(body.pageSize) || 100, 1), 100);
    const pageIndex = Math.max(Number(body.pageIndex) || 0, 0);
    const forceRefresh = body.forceRefresh === true;
    const ttl = Math.min(Math.max(Number(env.CATALOG_CACHE_TTL_SECONDS) || 86400, 300), 604800);
    const cache = globalThis.caches?.default;
    const cacheUrl = new URL(request.url);
    cacheUrl.pathname = "/__internal-cache/kobo-catalog-v3";
    cacheUrl.search = new URLSearchParams({ q: normalizeCachePart(query), language, pageSize: String(pageSize), pageIndex: String(pageIndex) }).toString();
    const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });

    if (cache && !forceRefresh) {
      const hit = await cache.match(cacheKey);
      if (hit) {
        const cached = await hit.json();
        return json({ ...cached, cacheStatus: "hit" }, 200, { "X-Kobo-Catalog-Cache": "HIT" });
      }
    }

    const appVersion = body.appVersion || env.KOBO_APP_VERSION || DEFAULT_KOBO_APP_VERSION;
    const init = await getInitialization(auth, appVersion);
    auth = init.auth;
    const candidates = [init.resources.products, init.resources.productsv2, `${KOBO_STORE}/v1/products`, `${KOBO_STORE}/v2/products`].filter(Boolean);
    let lastStatus = 0;
    let payload = null;
    let endpoint = "";
    let refreshed = init.refreshed;
    for (const candidate of [...new Set(candidates)]) {
      const u = new URL(candidate);
      u.searchParams.set("Query", query);
      u.searchParams.set("PageSize", String(pageSize));
      u.searchParams.set("PageIndex", String(pageIndex));
      if (language) u.searchParams.set("Language", language);
      const out = await koboAuthedFetch(u, auth, appVersion);
      auth = out.auth; refreshed ||= out.refreshed;
      lastStatus = out.response.status;
      if (!out.response.ok) continue;
      try { payload = await out.response.json(); endpoint = u.pathname; break; } catch { /* try next */ }
    }
    if (payload === null) throw new HttpError(502, "kobo_catalog_failed", `Kobo catalog search failed (${lastStatus || "no response"})`);
    const items = extractCatalogBooks(payload);
    const publicResult = {
      items,
      count: items.length,
      endpoint,
      pageIndex,
      rawPageInfo: extractPageInfo(payload),
      cachedAt: new Date().toISOString()
    };
    if (cache) {
      const cachedResponse = json(publicResult, 200, { "Cache-Control": `public, max-age=${ttl}` });
      const store = cache.put(cacheKey, cachedResponse);
      if (ctx?.waitUntil) ctx.waitUntil(store); else await store;
    }
    return json({
      ...publicResult,
      cacheStatus: forceRefresh ? "refresh" : "miss",
      tokenRefreshed: refreshed,
      auth: refreshed ? { ...auth, appVersion } : undefined
    }, 200, { "X-Kobo-Catalog-Cache": forceRefresh ? "REFRESH" : "MISS" });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status);
    throw e;
  }
}

function normalizeCachePart(value) {
  return String(value || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}"]+/gu, " ").replace(/\s+/g, " ").trim();
}

export function extractCatalogBooks(payload) {
  const found = new Map();
  const seen = new Set();
  const walk = (node, depth = 0) => {
    if (!node || depth > 10) return;
    if (typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) { for (const x of node) walk(x, depth + 1); return; }
    const candidates = [node.Book, node.ProductMetadata?.Book, node.BookMetadata, node].filter(Boolean);
    for (const c of candidates) {
      if (c && typeof c === "object" && c.Title && (c.RevisionId || c.ProductId || c.Id || c.ISBN || c.ContributorRoles || c.Author)) {
        const item = normalizeBook(c, {}, {});
        const id = item.revisionId || item.productId || item.isbn || `${item.title}|${item.authors.join("|")}`;
        if (!found.has(id)) found.set(id, item);
      }
    }
    for (const v of Object.values(node)) walk(v, depth + 1);
  };
  walk(payload);
  return [...found.values()];
}

function extractPageInfo(payload) {
  if (!payload || typeof payload !== "object") return {};
  return {
    totalPageCount: payload.TotalPageCount ?? payload.totalPageCount ?? null,
    totalItemCount: payload.TotalItemCount ?? payload.totalItemCount ?? payload.TotalCount ?? null,
    pageIndex: payload.PageIndex ?? payload.pageIndex ?? null
  };
}

async function upstreamError(code, response) {
  let detail = "";
  try { detail = (await response.text()).slice(0, 300); } catch {}
  const status = response.status === 429 ? 429 : 502;
  const headers = {};
  const retryAfter = response.headers.get("Retry-After");
  if (status === 429 && retryAfter) headers["Retry-After"] = retryAfter;
  return json({ error: code, message: `Kobo upstream returned ${response.status}`, detail }, status, headers);
}

async function sha256Hex(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function getVaultAuth(request) {
  const value = request.headers.get("X-Vault-Auth") || "";
  if (value.length < 20 || value.length > 500) throw new HttpError(401, "missing_auth", "Missing or invalid vault authentication secret");
  return value;
}

async function getVaultMeta(env, uidHash) {
  const row = await env.KOBO_VAULT.prepare("SELECT salt, version, chunk_count, byte_length, updated_at FROM vaults WHERE uid_hash = ?").bind(uidHash).first();
  if (!row) return json({ exists: false });
  return json({ exists: true, salt: row.salt, version: row.version, chunkCount: row.chunk_count, byteLength: row.byte_length, updatedAt: row.updated_at });
}

async function authenticateVault(request, env, uidHash) {
  const secret = getVaultAuth(request);
  const authHash = await sha256Hex(secret);
  const row = await env.KOBO_VAULT.prepare("SELECT * FROM vaults WHERE uid_hash = ?").bind(uidHash).first();
  if (!row || !constantTimeEqual(authHash, row.auth_hash)) throw new HttpError(401, "invalid_credentials", "Invalid UID/password");
  return row;
}

function constantTimeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0;
}

async function getVault(request, env, uidHash) {
  try {
    const row = await authenticateVault(request, env, uidHash);
    const chunks = await env.KOBO_VAULT.prepare("SELECT chunk_index, blob FROM vault_chunks WHERE uid_hash = ? ORDER BY chunk_index ASC").bind(uidHash).all();
    if ((chunks.results?.length || 0) !== row.chunk_count) throw new HttpError(500, "vault_incomplete", "Remote vault is incomplete");
    return json({ salt: row.salt, version: row.version, blob: chunks.results.map(x => x.blob).join(""), updatedAt: row.updated_at });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status);
    throw e;
  }
}

async function putVault(request, env, uidHash) {
  try {
    const body = await readJson(request);
    const secret = getVaultAuth(request);
    const authHash = await sha256Hex(secret);
    const salt = String(body.salt || "");
    const blob = String(body.blob || "");
    const expectedVersion = Number(body.expectedVersion || 0);
    if (!/^[A-Za-z0-9_-]{16,200}$/.test(salt)) throw new HttpError(400, "invalid_salt", "Invalid salt");
    if (!blob || blob.length > MAX_BODY_BYTES) throw new HttpError(413, "vault_too_large", "Encrypted vault exceeds size limit");
    const chunks = splitByLength(blob, MAX_CHUNK_BYTES);
    if (chunks.length > MAX_CHUNKS) throw new HttpError(413, "too_many_chunks", "Encrypted vault is too large");

    const current = await env.KOBO_VAULT.prepare("SELECT auth_hash, salt, version FROM vaults WHERE uid_hash = ?").bind(uidHash).first();
    const now = new Date().toISOString();
    if (current) {
      if (!constantTimeEqual(authHash, current.auth_hash)) throw new HttpError(401, "invalid_credentials", "Invalid UID/password");
      if (current.salt !== salt) throw new HttpError(409, "salt_mismatch", "Vault salt mismatch");
      if (expectedVersion !== Number(current.version)) return json({ error: "version_conflict", currentVersion: current.version }, 409);
      const newVersion = Number(current.version) + 1;
      const stmts = [
        env.KOBO_VAULT.prepare("DELETE FROM vault_chunks WHERE uid_hash = ?").bind(uidHash),
        env.KOBO_VAULT.prepare("UPDATE vaults SET version = ?, chunk_count = ?, byte_length = ?, updated_at = ? WHERE uid_hash = ?").bind(newVersion, chunks.length, blob.length, now, uidHash),
        ...chunks.map((c, i) => env.KOBO_VAULT.prepare("INSERT INTO vault_chunks(uid_hash, chunk_index, blob) VALUES(?, ?, ?)").bind(uidHash, i, c))
      ];
      await env.KOBO_VAULT.batch(stmts);
      return json({ ok: true, version: newVersion, chunkCount: chunks.length, updatedAt: now });
    }

    if (expectedVersion !== 0) return json({ error: "version_conflict", currentVersion: 0 }, 409);
    const stmts = [
      env.KOBO_VAULT.prepare("INSERT INTO vaults(uid_hash, salt, auth_hash, version, chunk_count, byte_length, created_at, updated_at) VALUES(?, ?, ?, 1, ?, ?, ?, ?)").bind(uidHash, salt, authHash, chunks.length, blob.length, now, now),
      ...chunks.map((c, i) => env.KOBO_VAULT.prepare("INSERT INTO vault_chunks(uid_hash, chunk_index, blob) VALUES(?, ?, ?)").bind(uidHash, i, c))
    ];
    await env.KOBO_VAULT.batch(stmts);
    return json({ ok: true, version: 1, chunkCount: chunks.length, updatedAt: now }, 201);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status);
    throw e;
  }
}

async function deleteVault(request, env, uidHash) {
  try {
    await authenticateVault(request, env, uidHash);
    // Explicit cleanup keeps deletion deterministic even if a D1 connection does not
    // retain PRAGMA foreign_keys between requests.
    await env.KOBO_VAULT.batch([
      env.KOBO_VAULT.prepare("DELETE FROM jobs WHERE uid_hash = ?").bind(uidHash),
      env.KOBO_VAULT.prepare("DELETE FROM agents WHERE uid_hash = ?").bind(uidHash),
      env.KOBO_VAULT.prepare("DELETE FROM agent_pairings WHERE uid_hash = ?").bind(uidHash),
      env.KOBO_VAULT.prepare("DELETE FROM api_tokens WHERE uid_hash = ?").bind(uidHash),
      env.KOBO_VAULT.prepare("DELETE FROM kobo_api_credentials WHERE uid_hash = ?").bind(uidHash),
      env.KOBO_VAULT.prepare("DELETE FROM library_sync_state WHERE uid_hash = ?").bind(uidHash),
      env.KOBO_VAULT.prepare("DELETE FROM library_projection WHERE uid_hash = ?").bind(uidHash),
      env.KOBO_VAULT.prepare("DELETE FROM account_projection WHERE uid_hash = ?").bind(uidHash),
      env.KOBO_VAULT.prepare("DELETE FROM vaults WHERE uid_hash = ?").bind(uidHash)
    ]);
    return json({ ok: true });
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status);
    throw e;
  }
}

function splitByLength(s, n) {
  const out = []; for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n)); return out;
}
