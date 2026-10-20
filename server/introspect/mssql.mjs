/**
 * Microsoft SQL Server schema introspection. Requires the optional `mssql` dependency.
 *
 * conn: { host, port, user, password, database, ssl?, encrypt? }
 */
export async function introspectMssql(conn) {
  let sql;
  try { ({ default: sql } = await import("mssql")); }
  catch { throw new Error("O driver 'mssql' não está instalado. Rode: npm install mssql"); }

  const pool = await sql.connect({
    server: conn.host || "localhost",
    port: Number(conn.port) || 1433,
    user: conn.user,
    password: conn.password,
    database: conn.database,
    options: {
      encrypt: conn.encrypt ?? conn.ssl ?? false,
      trustServerCertificate: true,
    },
  });

  try {
    const cols = (await pool.request().query(
      `SELECT s.name AS [schema], t.name AS [table], c.name AS [column],
              tp.name +
                CASE WHEN tp.name IN ('varchar','nvarchar','char','nchar')
                     THEN '(' + CASE WHEN c.max_length = -1 THEN 'max'
                                     ELSE CAST(c.max_length AS varchar) END + ')'
                     ELSE '' END AS [type],
              c.is_nullable AS nullable,
              OBJECT_DEFINITION(c.default_object_id) AS [default],
              c.column_id AS position
       FROM sys.columns c
       JOIN sys.tables t  ON t.object_id = c.object_id
       JOIN sys.schemas s ON s.schema_id = t.schema_id
       JOIN sys.types tp  ON tp.user_type_id = c.user_type_id
       ORDER BY s.name, t.name, c.column_id`,
    )).recordset;

    const keys = (await pool.request().query(
      `SELECT kc.name AS name,
              CASE WHEN kc.type = 'PK' THEN 'p' ELSE 'u' END AS type,
              s.name AS [schema], t.name AS [table], col.name AS [column], ic.key_ordinal AS position
       FROM sys.key_constraints kc
       JOIN sys.tables t  ON t.object_id = kc.parent_object_id
       JOIN sys.schemas s ON s.schema_id = t.schema_id
       JOIN sys.index_columns ic ON ic.object_id = kc.parent_object_id AND ic.index_id = kc.unique_index_id
       JOIN sys.columns col ON col.object_id = ic.object_id AND col.column_id = ic.column_id
       ORDER BY kc.name, ic.key_ordinal`,
    )).recordset;

    const fks = (await pool.request().query(
      `SELECT fk.name AS name,
              s.name AS [schema], t.name AS [table], pc.name AS [column],
              rs.name AS ref_schema, rt.name AS ref_table, rc.name AS ref_column,
              fkc.constraint_column_id AS position
       FROM sys.foreign_keys fk
       JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id
       JOIN sys.tables t   ON t.object_id = fk.parent_object_id
       JOIN sys.schemas s  ON s.schema_id = t.schema_id
       JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
       JOIN sys.tables rt  ON rt.object_id = fk.referenced_object_id
       JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
       JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
       ORDER BY fk.name, fkc.constraint_column_id`,
    )).recordset;

    const multiSchema = new Set(cols.map((c) => c.schema)).size > 1;
    const { assemble } = await import("./postgres.mjs");
    return assemble({ cols, keys, fks, multiSchema, engine: "mssql" });
  } finally {
    await pool.close();
  }
}
