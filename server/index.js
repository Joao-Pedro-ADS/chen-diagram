/**
 * chen-draw backend — introspects a database and returns a normalized schema
 * (and, on request, a ready-to-render Excalidraw skeleton in Chen notation).
 *
 * Binds to 127.0.0.1 only. Credentials live for the duration of one request
 * and are never written to disk or logged.
 */
import express from "express";
import cors from "cors";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { schemaToSkeleton } from "../shared/chen.mjs";
import { introspectPostgres } from "./introspect/postgres.mjs";
import { introspectMysql } from "./introspect/mysql.mjs";
import { introspectSqlite } from "./introspect/sqlite.mjs";
import { introspectMssql } from "./introspect/mssql.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT) || 5177;

const ENGINES = {
  postgres: introspectPostgres,
  postgresql: introspectPostgres,
  pg: introspectPostgres,
  mysql: introspectMysql,
  mariadb: introspectMysql,
  sqlite: introspectSqlite,
  sqlite3: introspectSqlite,
  mssql: introspectMssql,
  sqlserver: introspectMssql,
};

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "64mb" })); // large base64 sqlite uploads

const redact = (o) => {
  const c = { ...o };
  for (const k of ["password", "connectionString", "fileBase64"]) if (k in c) c[k] = "***";
  return c;
};

async function runIntrospection(body) {
  const engineKey = String(body.engine || "").toLowerCase();
  const fn = ENGINES[engineKey];
  if (!fn) {
    throw Object.assign(new Error(`Engine desconhecida: "${body.engine}". Use: postgres, mysql, sqlite, mssql.`), { status: 400 });
  }

  const conn = { ...(body.connection || {}) };

  // parse a URL/DSN when provided instead of discrete fields
  if (body.url || conn.url) {
    const u = new URL(body.url || conn.url);
    conn.host = decodeURIComponent(u.hostname) || conn.host;
    conn.port = u.port || conn.port;
    conn.user = decodeURIComponent(u.username) || conn.user;
    conn.password = decodeURIComponent(u.password) || conn.password;
    conn.database = decodeURIComponent(u.pathname.replace(/^\//, "")) || conn.database;
    if (u.searchParams.get("sslmode") && u.searchParams.get("sslmode") !== "disable") conn.ssl = true;
    if (engineKey.startsWith("postgres") || engineKey === "pg") conn.connectionString = body.url || conn.url;
  }

  let tmpFile = null;
  if ((engineKey === "sqlite" || engineKey === "sqlite3") && body.fileBase64) {
    tmpFile = path.join(os.tmpdir(), `chen-draw-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
    await fs.writeFile(tmpFile, Buffer.from(body.fileBase64, "base64"));
    conn.file = tmpFile;
  }

  try {
    const schema = await fn(conn);
    return schema;
  } finally {
    if (tmpFile) fs.unlink(tmpFile).catch(() => {});
  }
}

app.get("/api/health", (_req, res) => res.json({ ok: true, engines: Object.keys(ENGINES) }));

app.post("/api/introspect", async (req, res) => {
  try {
    const schema = await runIntrospection(req.body);
    res.json({ schema });
  } catch (err) {
    console.error("introspect failed:", err.message, "| body:", JSON.stringify(redact(req.body?.connection || {})));
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post("/api/diagram", async (req, res) => {
  try {
    const schema = await runIntrospection(req.body);
    const { model, skeleton } = schemaToSkeleton(schema, req.body.options || {});
    res.json({ schema, model, skeleton });
  } catch (err) {
    console.error("diagram failed:", err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// serve the built SPA in production
if (process.env.NODE_ENV === "production") {
  const dist = path.join(__dirname, "..", "dist");
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.listen(PORT, HOST, () => {
  console.log(`chen-draw server  →  http://${HOST}:${PORT}`);
});
