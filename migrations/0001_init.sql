PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS vaults (
  uid_hash TEXT PRIMARY KEY NOT NULL,
  salt TEXT NOT NULL,
  auth_hash TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  byte_length INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vault_chunks (
  uid_hash TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  blob TEXT NOT NULL,
  PRIMARY KEY (uid_hash, chunk_index),
  FOREIGN KEY (uid_hash) REFERENCES vaults(uid_hash) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_vault_chunks_uid ON vault_chunks(uid_hash);
