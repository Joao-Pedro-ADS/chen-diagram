/**
 * MySQL / MariaDB schema introspection. Requires the optional `mysql2` dependency.
 *
 * conn: { host, port, user, password, database, ssl? }
 */
export async function introspectMysql(conn) {
  let mysql;
  try { ({ default: mysql } = await import("mysql2/promise")); }
  catch { throw new Error("O driver 'mysql2' não está instalado. Rode: npm install mysql2"); }

  const db = conn.database;
  if (!db) throw new Error("Informe o nome do banco (database) para MySQL.");

  const c = await mysql.createConnection({
    host: conn.host || "localhost",
    port: Number(conn.port) || 3306,
    user: conn.user,
    password: conn.password,
    database: db,
    ssl: conn.ssl ? { rejectUnauthorized: false } : undefined,
  });

  try {
    const [cols] = await c.query(
      `SELECT TABLE_NAME AS \`table\`, COLUMN_NAME AS \`column\`, COLUMN_TYPE AS \`type\`,
              IS_NULLABLE AS nullable, COLUMN_DEFAULT AS \`default\`, ORDINAL_POSITION AS position
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ?
       ORDER BY TABLE_NAME, ORDINAL_POSITION`, [db]);

    const [keys] = await c.query(
      `SELECT tc.CONSTRAINT_NAME AS name, tc.CONSTRAINT_TYPE AS type,
              kcu.TABLE_NAME AS \`table\`, kcu.COLUMN_NAME AS \`column\`, kcu.ORDINAL_POSITION AS position
       FROM information_schema.TABLE_CONSTRAINTS tc
       JOIN information_schema.KEY_COLUMN_USAGE kcu
         ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
        AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
        AND tc.TABLE_NAME = kcu.TABLE_NAME
       WHERE tc.TABLE_SCHEMA = ? AND tc.CONSTRAINT_TYPE IN ('PRIMARY KEY','UNIQUE')
       ORDER BY tc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`, [db]);

    const [fks] = await c.query(
      `SELECT CONSTRAINT_NAME AS name, TABLE_NAME AS \`table\`, COLUMN_NAME AS \`column\`,
              REFERENCED_TABLE_NAME AS ref_table, REFERENCED_COLUMN_NAME AS ref_column,
              ORDINAL_POSITION AS position
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL
       ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION`, [db]);

    const tables = new Map();
    const get = (name) => {
      if (!tables.has(name)) {
        tables.set(name, {
          name, displayName: name, schema: db,
          columns: [], primaryKey: [], uniques: [], foreignKeys: [],
        });
      }
      return tables.get(name);
    };

    for (const r of cols) {
      get(r.table).columns.push({
        name: r.column, type: r.type,
        nullable: r.nullable === "YES",
        default: r.default ?? null,
        isArray: /^set\(/i.test(r.type),
      });
    }

    const uniq = new Map();
    for (const k of keys) {
      const t = get(k.table);
      if (k.type === "PRIMARY KEY") t.primaryKey.push(k.column);
      else {
        const key = `${k.table}::${k.name}`;
        if (!uniq.has(key)) uniq.set(key, { t, cols: [] });
        uniq.get(key).cols.push(k.column);
      }
    }
    for (const { t, cols: uc } of uniq.values()) t.uniques.push(uc);

    const fkSets = new Map();
    for (const f of fks) {
      const key = `${f.table}::${f.name}`;
      if (!fkSets.has(key)) {
        fkSets.set(key, { owner: get(f.table), name: f.name, columns: [], refTable: f.ref_table, refColumns: [] });
      }
      fkSets.get(key).columns.push(f.column);
      fkSets.get(key).refColumns.push(f.ref_column);
    }
    for (const s of fkSets.values()) {
      s.owner.foreignKeys.push({ name: s.name, columns: s.columns, refTable: s.refTable, refColumns: s.refColumns });
    }

    return { engine: "mysql", tables: [...tables.values()] };
  } finally {
    await c.end();
  }
}
