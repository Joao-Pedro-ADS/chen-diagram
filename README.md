# chen-draw

Um **build local do Excalidraw** com um extra: aponte para um banco de dados e
ele faz a introspecção do schema e desenha o **diagrama entidade-relacionamento
em notação de Chen** direto no canvas. Depois de desenhado é Excalidraw puro —
mover, reestilizar, anotar, exportar para PNG/SVG/`.excalidraw`.

---

## Requisitos

- **Node.js ≥ 22** (usa o módulo nativo `node:sqlite`). Recomendado 24+.
- `npm` (vem com o Node).

```bash
node --version   # precisa ser >= 22
```

---

## Instalação

```bash
cd /home/joaop/dev/tools/chen-draw
npm install
```

Se o `npm install` reclamar de *install scripts* do esbuild:

```bash
npm install-scripts approve esbuild
```

---

## Rodar em desenvolvimento

Sobe o backend (`:5177`) e a UI do Excalidraw (`:5178`) juntos, com hot-reload:

```bash
npm run dev
```

Depois abra **<http://localhost:5178>** no navegador.

> Só quer um dos dois?
> ```bash
> npm run dev:server   # só a API,  http://127.0.0.1:5177
> npm run dev:web      # só a UI,   http://localhost:5178
> ```

---

## Rodar em produção (1 processo só)

Faz o build da SPA e serve tudo pelo servidor Node:

```bash
npm run build
npm start
```

Abra **<http://127.0.0.1:5177>**.

Variáveis de ambiente opcionais:

```bash
HOST=127.0.0.1 PORT=5177 npm start
```

---

## Testar com um banco de exemplo (sem precisar de banco nenhum)

Gera `./sample.db` (SQLite) com entidades fortes e fracas, FK 1:1, FK 1:N,
tabela de junção M:N e atributo de relacionamento:

```bash
npm run sample-db
```

Depois, no painel da UI: engine **SQLite** → campo "caminho do arquivo no
servidor" → `/home/joaop/dev/tools/chen-draw/sample.db` → **Gerar diagrama**.
(Ou selecione o arquivo pelo seletor de upload.)

---

## Rodar os testes

```bash
npm test
```

---

## Usar com o seu banco

Abra a UI, escolha a engine no painel esquerdo e preencha a conexão
(host/porta/usuário/senha/database), ou marque **"Usar connection string"** e
cole uma URL:

```
postgres://usuario:senha@localhost:5432/meubanco
mysql://usuario:senha@localhost:3306/meubanco
sqlserver://usuario:senha@localhost:1433/meubanco
```

Para **SQLite**: arraste o arquivo `.sqlite`/`.db` no seletor, ou informe o
caminho dele no servidor.

Clique em **Gerar diagrama**. Ajuste no painel: layout grade/circular, esconder
colunas FK, detecção de junção/entidade fraca, filtro por schema e lista de
tabelas.

### Bancos suportados

| Engine        | Driver          | Observações |
|---------------|-----------------|-------------|
| PostgreSQL    | `pg`            | introspecção completa via `pg_catalog`, multi-schema, colunas array |
| MySQL/MariaDB | `mysql2`        | via `information_schema`; colunas `SET` → multivaloradas |
| SQLite        | `node:sqlite`   | embutido, sem compilar nada |
| SQL Server    | `mssql`         | via `sys.*` |

Os drivers SQL são `optionalDependencies` — o `npm install` baixa todos, mas se
um falhar ao compilar os outros continuam funcionando. SQLite sempre funciona.

Se aparecer *"O driver 'X' não está instalado"*:

```bash
npm install pg          # PostgreSQL
npm install mysql2      # MySQL / MariaDB
npm install mssql       # SQL Server
```

---

## Como o schema relacional vira notação de Chen

| Entrada relacional | Saída Chen |
|---|---|
| tabela | **entidade** (retângulo) |
| tabela cuja PK é toda formada por FKs para ≥2 tabelas | **relacionamento M:N / n-ário** (losango); colunas não-chave viram **atributos do relacionamento** |
| tabela com PK = *(FK para o pai)* + *(coluna extra)* | **entidade fraca** (retângulo duplo) + **relacionamento identificador** (losango duplo); a coluna extra é a **chave parcial** (sublinhado tracejado) |
| FK comum | **relacionamento binário** (losango) com cardinalidade `1`–`N`, ou `1`–`1` quando as colunas da FK são `UNIQUE` / a PK inteira |
| coluna | **atributo** (elipse); PK → sublinhado sólido |
| FK `NOT NULL` | **participação total** — desenhada com conector mais grosso |
| coluna array do Postgres / `SET` do MySQL | **atributo multivalorado** (elipse dupla) |

---

## Credenciais e segurança

- O servidor escuta **somente em 127.0.0.1**.
- As credenciais são usadas em uma única requisição de introspecção, nunca
  gravadas em disco, nunca logadas (o log redige `password` / `connectionString`).
- Um arquivo SQLite enviado é escrito no diretório temporário do SO e apagado
  logo após a introspecção.

---

## Estrutura do projeto

```
server/
  index.js              Express: /api/introspect, /api/diagram, /api/health
  introspect/*.mjs      um módulo por engine → schema normalizado { engine, tables[] }
shared/
  chen.mjs              puro: buildChenModel → layoutChenModel → toSkeleton
web/
  src/App.jsx           o painel + <Excalidraw>; chama convertToExcalidrawElements
scripts/make-sample-sqlite.mjs
test/chen.test.mjs      cobertura node:test da derivação ER
```

## API

`POST /api/introspect` → `{ schema }`
`POST /api/diagram` → `{ schema, model, skeleton }` (skeleton = entrada para `convertToExcalidrawElements`)

```jsonc
// corpo da requisição
{
  "engine": "postgres",                         // postgres | mysql | sqlite | mssql
  "connection": { "host": "...", "port": 5432, "user": "...", "password": "...", "database": "..." },
  // ou:
  "url": "postgres://user:pass@host:5432/db",
  // ou, para sqlite:  "fileBase64": "<base64>"  /  "connection": { "file": "/caminho/para.db" }
  "options": { "layout": "grid", "hideFkColumns": true, "includeSchemas": ["public"] }
}
```

Exemplo com `curl` (usando o banco de exemplo):

```bash
curl -s -X POST http://127.0.0.1:5177/api/diagram \
  -H 'Content-Type: application/json' \
  -d '{"engine":"sqlite","connection":{"file":"'"$PWD"'/sample.db"}}'
```
