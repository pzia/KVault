PRAGMA foreign_keys = ON;

-- Kobo Vault 0.9.6.4: server-side freshness tracking for the published library.
-- This state is per vault identity and contains no Kobo content or secret.
CREATE TABLE IF NOT EXISTS library_sync_state (
  uid_hash TEXT PRIMARY KEY NOT NULL,
  last_success_at TEXT,
  last_attempt_at TEXT,
  last_error TEXT,
  refresh_started_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (uid_hash) REFERENCES vaults(uid_hash) ON DELETE CASCADE
);
