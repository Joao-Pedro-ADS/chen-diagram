/**
 * Builds ./sample.db — a small blogging/e-commerce-ish schema that exercises
 * every Chen feature chen-draw draws: strong + weak entities, 1:N and 1:1
 * foreign keys, an M:N junction table, and a relationship attribute.
 *
 *   node scripts/make-sample-sqlite.mjs
 */
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "sample.db");
fs.rmSync(out, { force: true });

const db = new DatabaseSync(out);
db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    display_name  TEXT NOT NULL,
    created_at    TEXT NOT NULL
  );

  CREATE TABLE profiles (            -- 1:1 with users (user_id is UNIQUE)
    user_id  INTEGER PRIMARY KEY REFERENCES users(id),
    bio      TEXT,
    avatar_url TEXT
  );

  CREATE TABLE posts (              -- 1:N users -> posts
    id         INTEGER PRIMARY KEY,
    author_id  INTEGER NOT NULL REFERENCES users(id),
    title      TEXT NOT NULL,
    body       TEXT,
    published  INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE comments (           -- weak entity: PK = (post_id, seq)
    post_id  INTEGER NOT NULL REFERENCES posts(id),
    seq      INTEGER NOT NULL,
    author_id INTEGER REFERENCES users(id),
    body     TEXT NOT NULL,
    PRIMARY KEY (post_id, seq)
  );

  CREATE TABLE tags (
    id    INTEGER PRIMARY KEY,
    name  TEXT NOT NULL UNIQUE
  );

  CREATE TABLE post_tags (          -- M:N junction, with a relationship attribute
    post_id  INTEGER NOT NULL REFERENCES posts(id),
    tag_id   INTEGER NOT NULL REFERENCES tags(id),
    added_by INTEGER REFERENCES users(id),
    added_at TEXT,
    PRIMARY KEY (post_id, tag_id)
  );
`);
db.close();

console.log("wrote", out);
