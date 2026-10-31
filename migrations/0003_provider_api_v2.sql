PRAGMA foreign_keys = ON;

-- Kobo Vault 0.7.0 / API v2: optional server-side acquisition bridge.
-- The main encrypted vault remains unchanged. This row exists only when the
-- user explicitly enables authenticated acquisition for API consumers.
-- Kobo credentials are AES-GCM encrypted with the Cloudflare secret
-- KOBO_API_CREDENTIAL_KEY before being persisted.
CREATE TABLE IF NOT EXISTS kobo_api_credentials (
  uid_hash TEXT PRIMARY KEY NOT NULL,
  iv TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (uid_hash) REFERENCES vaults(uid_hash) ON DELETE CASCADE
);
