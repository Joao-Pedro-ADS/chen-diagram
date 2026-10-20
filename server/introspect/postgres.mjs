/**
 * PostgreSQL schema introspection. Requires the optional `pg` dependency.
 *
 * conn: { host, port, user, password, database, ssl?, connectionString?, schemas? }
 */
export async function introspectPostgres(conn) {
  let pg;
  try { ({ default: pg } = await import("pg")); }
  catch { throw new Error("O driver 'pg' não está instalado. Rode: npm install pg"); }

  const client = new pg.Client(
    conn.connectionString
      ? { connectionString: conn.connectionString, ssl: conn.ssl ? { rejectUnauthorized: false } : undefined }
      : {
          host: conn.host || "localhost",
          port: Number(conn.port) || 5432,
          user: conn.user,
          password: conn.password,
          database: conn.database,
          ssl: conn.ssl ? { rejectUnauthorized: false } : undefined,
        },
  );
  await client.connect();
  try {
    const skipSchemas = ["pg_catalog", "information_schema"];
    const schemaFilter = conn.schemas && conn.schemas.length
      ? `AND ns.nspname = ANY($1)` : `AND ns.nspname <> ALL($1)`;
    const schemaParam = conn.schemas && conn.schemas.length ? conn.schemas : skipSchemas;

    const { rows: cols } = await client.query(
      `SELECT ns.nspname                AS schema,
              cl.relname                AS table,
              att.attname               AS column,
              format_type(att.atttypid, att.atttypmod) AS type,
              NOT att.attnotnull        AS nullable,
              pg_get_expr(def.adbin, def.adrelid) AS "default",
              (att.attndims > 0 OR format_type(att.atttypid, att.atttypmod) LIKE '%[]') AS is_array,
              att.attnum                AS position
       FROM pg_attribute att
       JOIN pg_class cl   ON cl.oid = att.attrelid AND cl.relkind IN ('r','p')
       JOIN pg_namespace ns ON ns.oid = cl.relnamespace
       LEFT JOIN pg_attrdef def ON def.adrelid = att.attrelid AND def.adnum = att.attnum
       WHERE att.attnum > 0 AND NOT att.attisdropped ${schemaFilter}
       ORDER BY ns.nspname, cl.relname, att.attnum`,
      [schemaParam],
    );

    const { rows: keys } = await client.query(
      `SELECT con.conname AS name, con.contype AS type,
              ns.nspname  AS schema, cl.relname AS table,
              att.attname AS column, ord.n AS position
       FROM pg_constraint con
       JOIN pg_class cl     ON cl.oid = con.conrelid
       JOIN pg_namespace ns ON ns.oid = cl.relnamespace
       JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS ord(k, n) ON true
       JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ord.k
       WHERE con.contype IN ('p','u') ${schemaFilter}
       ORDER BY con.conname, ord.n`,
      [schemaParam],
    );

    const { rows: fks } = await client.query(
      `SELECT con.conname AS name,
              ns.nspname  AS schema,  cl.relname  AS table,   att.attname  AS column,
              fns.nspname AS ref_schema, fcl.relname AS ref_table, fatt.attname AS ref_column,
              ord.n AS position
       FROM pg_constraint con
       JOIN pg_class cl      ON cl.oid = con.conrelid
       JOIN pg_namespace ns  ON ns.oid = cl.relnamespace
       JOIN pg_class fcl     ON fcl.oid = con.confrelid
       JOIN pg_namespace fns ON fns.oid = fcl.relnamespace
       JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS ord(k, fk, n) ON true
       JOIN pg_attribute att  ON att.attrelid  = con.conrelid  AND att.attnum  = ord.k
       JOIN pg_attribute fatt ON fatt.attrelid = con.confrelid AND fatt.attnum = ord.fk
       WHERE con.contype = 'f' ${schemaFilter}
       ORDER BY con.conname, ord.n`,
      [schemaParam],
    );

    const multiSchema = new Set(cols.map((c) => c.schema)).size > 1;
    return assemble({ cols, keys, fks, multiSchema, engine: "postgres" });
  } finally {
    await client.end();
  }
}

/* shared assembler for the pg_catalog-style row sets ---------------------- */
export function assemble({ cols, keys, fks, multiSchema, engine }) {
  const id = (schema, table) => (multiSchema && schema ? `${schema}.${table}` : table);
  const tables = new Map();

  const get = (schema, table) => {
    const key = id(schema, table);
    if (!tables.has(key)) {
      tables.set(key, {
        name: key, displayName: table, schema: schema || undefined,
        columns: [], primaryKey: [], uniques: [], foreignKeys: [],
      });
    }
    return tables.get(key);
  };

  for (const c of cols) {
    get(c.schema, c.table).columns.push({
      name: c.column,
      type: c.type,
      nullable: c.nullable === true || c.nullable === "YES" || c.nullable === 1,
      default: c.default ?? null,
      isArray: c.is_array === true || c.is_array === 1,
    });
  }

  const uniqueSets = new Map(); // constraintName -> {table, cols[]}
  for (const k of keys) {
    const t = get(k.schema, k.table);
    if (k.type === "p" || k.type === "PRIMARY KEY") {
      t.primaryKey.push(k.column);
    } else {
      const key = `${id(k.schema, k.table)}::${k.name}`;
      if (!uniqueSets.has(key)) uniqueSets.set(key, { table: t, cols: [] });
      uniqueSets.get(key).cols.push(k.column);
    }
  }
  for (const { table, cols: uc } of uniqueSets.values()) table.uniques.push(uc);

  const fkSets = new Map();
  for (const f of fks) {
    const key = `${id(f.schema, f.table)}::${f.name}`;
    if (!fkSets.has(key)) {
      fkSets.set(key, {
        owner: get(f.schema, f.table), name: f.name,
        columns: [], refTable: id(f.ref_schema, f.ref_table), refColumns: [],
      });
    }
    const s = fkSets.get(key);
    s.columns.push(f.column);
    s.refColumns.push(f.ref_column);
  }
  for (const s of fkSets.values()) {
    s.owner.foreignKeys.push({
      name: s.name, columns: s.columns, refTable: s.refTable, refColumns: s.refColumns,
    });
  }

  return { engine, tables: [...tables.values()] };
}
