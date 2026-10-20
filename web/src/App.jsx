import React, { useCallback, useMemo, useRef, useState } from "react";
import { Excalidraw, convertToExcalidrawElements } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";

import { schemaToSkeleton } from "../../shared/chen.mjs";

const ENGINES = [
  { id: "postgres", label: "PostgreSQL", port: 5432 },
  { id: "mysql", label: "MySQL / MariaDB", port: 3306 },
  { id: "sqlite", label: "SQLite", port: null },
  { id: "mssql", label: "SQL Server", port: 1433 },
];

const initialConn = {
  host: "localhost",
  port: 5432,
  user: "",
  password: "",
  database: "",
  ssl: false,
};

export default function App() {
  const [engine, setEngine] = useState("postgres");
  const [conn, setConn] = useState(initialConn);
  const [url, setUrl] = useState("");
  const [useUrl, setUseUrl] = useState(false);
  const [sqliteFile, setSqliteFile] = useState(null); // { name, base64 }

  const [opts, setOpts] = useState({
    layout: "grid",
    hideFkColumns: true,
    detectJunctions: true,
    detectWeak: true,
    includeSchemas: "",
    includeTables: "",
  });

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null); // { kind, text }
  const apiRef = useRef(null);

  const engineMeta = useMemo(() => ENGINES.find((e) => e.id === engine), [engine]);

  const setField = (k, v) => setConn((c) => ({ ...c, [k]: v }));
  const setOpt = (k, v) => setOpts((o) => ({ ...o, [k]: v }));

  const onEngine = (id) => {
    setEngine(id);
    const meta = ENGINES.find((e) => e.id === id);
    if (meta?.port) setConn((c) => ({ ...c, port: meta.port }));
  };

  const onSqlitePick = async (file) => {
    if (!file) return setSqliteFile(null);
    const buf = await file.arrayBuffer();
    let bin = "";
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    setSqliteFile({ name: file.name, base64: btoa(bin) });
  };

  const parseList = (s) =>
    s.split(",").map((x) => x.trim()).filter(Boolean);

  const generate = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    try {
      const body = { engine };
      if (engine === "sqlite") {
        if (sqliteFile) body.fileBase64 = sqliteFile.base64;
        else if (conn.database) body.connection = { file: conn.database };
        else throw new Error("Selecione um arquivo .sqlite ou informe o caminho no campo 'arquivo'.");
      } else if (useUrl) {
        if (!url.trim()) throw new Error("Informe a connection string.");
        body.url = url.trim();
      } else {
        body.connection = { ...conn };
      }

      const res = await fetch("/api/introspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

      const buildOpts = {
        layout: opts.layout,
        hideFkColumns: opts.hideFkColumns,
        detectJunctions: opts.detectJunctions,
        detectWeak: opts.detectWeak,
        includeSchemas: opts.includeSchemas ? parseList(opts.includeSchemas) : null,
        includeTables: opts.includeTables ? parseList(opts.includeTables) : null,
      };

      const { model, skeleton } = schemaToSkeleton(data.schema, buildOpts);
      if (!model.entities.length) throw new Error("Nenhuma tabela encontrada com os filtros atuais.");

      const elements = convertToExcalidrawElements(skeleton);
      const api = apiRef.current;
      api.updateScene({ elements });
      api.scrollToContent(elements, { fitToContent: true, animate: false });

      setMsg({
        kind: "ok",
        text: `Diagrama gerado: ${model.entities.length} entidades, ${model.relationships.length} relacionamentos` +
          `${model.entities.some((e) => e.weak) ? " (inclui entidades fracas)" : ""}.`,
      });
    } catch (err) {
      setMsg({ kind: "err", text: String(err.message || err) });
    } finally {
      setBusy(false);
    }
  }, [engine, conn, url, useUrl, sqliteFile, opts]);

  return (
    <div className="app">
      <aside className="panel">
        <h1>chen-draw</h1>
        <p className="sub">Excalidraw local + diagrama ER do seu banco em notação de Chen.</p>

        <div className="field">
          <label>Banco</label>
          <select value={engine} onChange={(e) => onEngine(e.target.value)}>
            {ENGINES.map((e) => (
              <option key={e.id} value={e.id}>{e.label}</option>
            ))}
          </select>
        </div>

        {engine === "sqlite" ? (
          <>
            <div className="field">
              <label>Arquivo .sqlite / .db</label>
              <input
                type="file"
                accept=".sqlite,.db,.sqlite3,.db3"
                onChange={(e) => onSqlitePick(e.target.files?.[0])}
              />
              {sqliteFile && <div className="hint">Selecionado: {sqliteFile.name}</div>}
            </div>
            <div className="field">
              <label>…ou caminho do arquivo no servidor</label>
              <input
                type="text"
                placeholder="/caminho/para/app.db"
                value={conn.database}
                onChange={(e) => setField("database", e.target.value)}
              />
            </div>
          </>
        ) : (
          <>
            <label className="check">
              <input
                type="checkbox"
                checked={useUrl}
                onChange={(e) => setUseUrl(e.target.checked)}
              />
              Usar connection string
            </label>

            {useUrl ? (
              <div className="field">
                <textarea
                  placeholder={
                    engine === "postgres"
                      ? "postgres://user:pass@host:5432/dbname"
                      : engine === "mysql"
                        ? "mysql://user:pass@host:3306/dbname"
                        : "sqlserver://user:pass@host:1433/dbname"
                  }
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </div>
            ) : (
              <>
                <div className="row">
                  <div className="field" style={{ flex: 2 }}>
                    <label>Host</label>
                    <input type="text" value={conn.host} onChange={(e) => setField("host", e.target.value)} />
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    <label>Porta</label>
                    <input type="number" value={conn.port} onChange={(e) => setField("port", e.target.value)} />
                  </div>
                </div>
                <div className="field">
                  <label>Usuário</label>
                  <input type="text" value={conn.user} onChange={(e) => setField("user", e.target.value)} />
                </div>
                <div className="field">
                  <label>Senha</label>
                  <input type="password" value={conn.password} onChange={(e) => setField("password", e.target.value)} />
                </div>
                <div className="field">
                  <label>Database</label>
                  <input type="text" value={conn.database} onChange={(e) => setField("database", e.target.value)} />
                </div>
                <label className="check">
                  <input type="checkbox" checked={conn.ssl} onChange={(e) => setField("ssl", e.target.checked)} />
                  SSL / TLS
                </label>
              </>
            )}
          </>
        )}

        <div className="divider" />

        <div className="field">
          <label>Layout</label>
          <select value={opts.layout} onChange={(e) => setOpt("layout", e.target.value)}>
            <option value="grid">Grade</option>
            <option value="circle">Circular</option>
          </select>
        </div>
        <label className="check">
          <input type="checkbox" checked={opts.hideFkColumns} onChange={(e) => setOpt("hideFkColumns", e.target.checked)} />
          Esconder colunas FK (viram relacionamentos)
        </label>
        <label className="check">
          <input type="checkbox" checked={opts.detectJunctions} onChange={(e) => setOpt("detectJunctions", e.target.checked)} />
          Tabelas de junção → relacionamento M:N
        </label>
        <label className="check">
          <input type="checkbox" checked={opts.detectWeak} onChange={(e) => setOpt("detectWeak", e.target.checked)} />
          Detectar entidades fracas
        </label>
        <div className="field" style={{ marginTop: 8 }}>
          <label>Somente schemas (ex.: public, sales)</label>
          <input type="text" value={opts.includeSchemas} onChange={(e) => setOpt("includeSchemas", e.target.value)} />
        </div>
        <div className="field">
          <label>Somente tabelas (lista separada por vírgula)</label>
          <input type="text" value={opts.includeTables} onChange={(e) => setOpt("includeTables", e.target.value)} />
        </div>

        <button className="primary" disabled={busy} onClick={generate}>
          {busy ? "Gerando…" : "Gerar diagrama"}
        </button>

        {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}

        <p className="hint">
          As credenciais são enviadas só para o backend local (127.0.0.1) desta ferramenta,
          usadas em uma única requisição e nunca gravadas em disco.
        </p>
      </aside>

      <div className="canvas-wrap">
        <Excalidraw
          excalidrawAPI={(api) => (apiRef.current = api)}
          initialData={{ appState: { viewBackgroundColor: "#ffffff" } }}
        />
      </div>
    </div>
  );
}
