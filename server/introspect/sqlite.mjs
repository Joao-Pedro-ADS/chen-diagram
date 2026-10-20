/**
 * SQLite schema introspection using Node's built-in `node:sqlite` module
 * (no native dependency to compile).
 *
 * conn: { file }  -- absolute/relative path to a .sqlite/.db file on this host,
 *                    OR set by the /api/introspect upload handler to a temp path.
 */
import { DatabaseSync } from "node:sqlite";

export async function introspectSqlite(conn) {
  if (!conn.file) throw new Error("Informe o caminho do arquivo SQLite (file) ou envie o arquivo.");

  const db = new DatabaseSync(conn.file, { readOnly: true });
  try {
    const tableRows = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
      .all();

    const tables = [];
    for (const { name } of tableRows) {
      const q = name.replace(/"/g, '""');
      const info = db.prepare(`PRAGMA table_info("${q}")`).all();
      const fkList = db.prepare(`PRAGMA foreign_key_list("${q}")`).all();
      const idxList = db.prepare(`PRAGMA index_list("${q}")`).all();

      const columns = info.map((c) => ({
        name: c.name,
        type: c.type || "",
        nullable: c.notnull === 0 && c.pk === 0, // a PK column is never nullable
        default: c.dflt_value ?? null,
        isArray: false,
      }));

      const primaryKey = info
        .filter((c) => c.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((c) => c.name);

      // group composite FKs by their `id`
      const fkGroups = new Map();
      for (const f of fkList) {
        if (!fkGroups.has(f.id)) fkGroups.set(f.id, { table: f.table, from: [], to: [] });
        const g = fkGroups.get(f.id);
        g.from[f.seq] = f.from;
        g.to[f.seq] = f.to;
      }
      const foreignKeys = [...fkGroups.entries()].map(([id, g]) => ({
        name: `fk_${name}_${id}_${g.table}`,
        columns: g.from.filter((x) => x != null),
        refTable: g.table,
        refColumns: g.to.filter((x) => x != null),
      }));

      const uniques = [];
      for (const idx of idxList) {
        if (idx.unique && idx.origin !== "pk") {
          const iq = idx.name.replace(/"/g, '""');
          const cols = db.prepare(`PRAGMA index_info("${iq}")`).all().map((r) => r.name).filter(Boolean);
          if (cols.length) uniques.push(cols);
        }
      }

      tables.push({ name, displayName: name, columns, primaryKey, uniques, foreignKeys });
    }

    return { engine: "sqlite", tables };
  } finally {
    db.close();
  }
}
