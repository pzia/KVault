PRAGMA foreign_keys = ON;

-- Server-readable projection deliberately contains metadata only. Kobo credentials
-- remain inside the client-side encrypted vault and are never copied here.
CREATE TABLE IF NOT EXISTS account_projection (
  uid_hash TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  email_hint TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (uid_hash) REFERENCES vaults(uid_hash) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS library_projection (
  uid_hash TEXT NOT NULL,
  product_id TEXT NOT NULL,
  revision_id TEXT,
  isbn TEXT,
  title TEXT NOT NULL,
  authors_json TEXT NOT NULL DEFAULT '[]',
  language TEXT,
  publisher TEXT,
  publication_date TEXT,
  description TEXT,
  cover_url TEXT,
  product_url TEXT,
  format TEXT,
  content_type TEXT,
  downloadable INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  generation TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (uid_hash, product_id),
  FOREIGN KEY (uid_hash) REFERENCES vaults(uid_hash) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_library_projection_uid_title ON library_projection(uid_hash, title);
CREATE INDEX IF NOT EXISTS idx_library_projection_uid_revision ON library_projection(uid_hash, revision_id);

CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  uid_hash TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT,
  FOREIGN KEY (uid_hash) REFERENCES vaults(uid_hash) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_uid ON api_tokens(uid_hash, revoked_at);

CREATE TABLE IF NOT EXISTS agent_pairings (
  pair_id TEXT PRIMARY KEY NOT NULL,
  code_hash TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  uid_hash TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  approved_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (uid_hash) REFERENCES vaults(uid_hash) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_agent_pairings_code ON agent_pairings(code_hash, status, expires_at);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY NOT NULL,
  uid_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  revoked_at TEXT,
  FOREIGN KEY (uid_hash) REFERENCES vaults(uid_hash) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_agents_uid ON agents(uid_hash, revoked_at);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY NOT NULL,
  uid_hash TEXT NOT NULL,
  agent_id TEXT,
  type TEXT NOT NULL,
  product_id TEXT,
  revision_id TEXT,
  format TEXT,
  status TEXT NOT NULL,
  idempotency_key TEXT,
  title TEXT,
  authors_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  claimed_at TEXT,
  lease_until TEXT,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  result_json TEXT,
  FOREIGN KEY (uid_hash) REFERENCES vaults(uid_hash) ON DELETE CASCADE,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_uid_status_created ON jobs(uid_hash, status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_uid_idempotency ON jobs(uid_hash, idempotency_key) WHERE idempotency_key IS NOT NULL;
