/**
 * chen.mjs — pure, dependency-free logic that turns a normalized relational
 * schema into a Chen-notation ER model, lays it out on a 2D canvas, and emits
 * an Excalidraw "skeleton" array (the input shape for
 * `convertToExcalidrawElements` from @excalidraw/excalidraw).
 *
 * The three stages are exported separately so they are easy to test, plus one
 * convenience wrapper `schemaToSkeleton`.
 *
 *   Schema  --buildChenModel-->  ChenModel  --layoutChenModel-->  Layout
 *           --toSkeleton-->  ExcalidrawSkeleton[]
 *
 * ---------------------------------------------------------------------------
 * Normalized schema shape (produced by server/introspect/*):
 *
 *   Schema = {
 *     engine: string,
 *     tables: Table[]
 *   }
 *   Table = {
 *     name: string,          // canonical id, "schema.table" or "table"
 *     displayName: string,   // bare table name
 *     schema?: string,
 *     columns: Column[],
 *     primaryKey: string[],  // ordered column names
 *     uniques: string[][],   // unique column-sets, PK excluded
 *     foreignKeys: ForeignKey[]
 *   }
 *   Column = { name, type, nullable, default, isArray }
 *   ForeignKey = { name, columns: string[], refTable: string, refColumns: string[] }
 */

const KEY_SUFFIX = /(_id|_fk|_key|_ref|id|fk)$/i;

/* ------------------------------------------------------------------ helpers */

const lc = (s) => String(s).toLowerCase();
const setOf = (arr) => new Set(arr.map(lc));
const sameSet = (a, b) => a.length === b.length && setOf(a).size === setOf(b).size &&
  [...setOf(a)].every((x) => setOf(b).has(x));
const subset = (a, b) => { const B = setOf(b); return a.every((x) => B.has(lc(x))); };

/** derive a readable relationship label from a fk column ("author_id" -> "author") */
function roleFromColumns(cols, fallback) {
  if (cols.length === 1) {
    const base = cols[0].replace(KEY_SUFFIX, "");
    if (base && base !== cols[0]) return base;
    if (base) return base;
  }
  return fallback;
}

/* ------------------------------------------------------- 1. build ER model */

/**
 * @param {Schema} schema
 * @param {object} [opts]
 * @param {string[]|null} [opts.includeTables]  only these table names (display or canonical)
 * @param {string[]|null} [opts.includeSchemas] only these schemas
 * @param {boolean} [opts.hideFkColumns=true]  hide plain FK columns from entity attribute lists
 * @param {boolean} [opts.detectJunctions=true] collapse pure link tables into M:N relationships
 * @param {boolean} [opts.detectWeak=true]     render entities with an identifying FK in their PK as weak
 */
export function buildChenModel(schema, opts = {}) {
  const {
    includeTables = null,
    includeSchemas = null,
    hideFkColumns = true,
    detectJunctions = true,
    detectWeak = true,
  } = opts;

  const wantTable = includeTables && setOf(includeTables);
  const wantSchema = includeSchemas && setOf(includeSchemas);

  let tables = schema.tables.filter((t) => {
    if (wantSchema && !wantSchema.has(lc(t.schema || ""))) return false;
    if (wantTable && !(wantTable.has(lc(t.name)) || wantTable.has(lc(t.displayName)))) return false;
    return true;
  });

  const byName = new Map();
  for (const t of tables) {
    byName.set(lc(t.name), t);
    if (!byName.has(lc(t.displayName))) byName.set(lc(t.displayName), t);
  }
  const resolve = (ref) => byName.get(lc(ref)) || null;

  // Only keep FKs whose target is inside the (possibly filtered) set.
  for (const t of tables) t.foreignKeys = (t.foreignKeys || []).filter((fk) => resolve(fk.refTable));

  /* classify -------------------------------------------------------------- */
  // A junction table becomes an M:N / n-ary relationship. Its "spine" FKs are
  // the ones whose columns sit in the primary key (or, for a key-less link
  // table, all of them); any other FK column is treated as a relationship
  // attribute, not an extra participant.
  const kind = new Map();       // table.name -> "entity" | "junction"
  const spineFks = new Map();   // table.name -> ForeignKey[] (the participants)
  for (const t of tables) {
    const pk = t.primaryKey || [];
    const pkSet = setOf(pk);
    const spine = pk.length > 0
      ? t.foreignKeys.filter((fk) => subset(fk.columns, pk))
      : t.foreignKeys.slice();
    const spineCols = setOf(spine.flatMap((fk) => fk.columns));
    const spineTargets = new Set(spine.map((fk) => lc(resolve(fk.refTable).name)));

    const isJunction = detectJunctions && spine.length >= 2 && spineTargets.size >= 2 && (
      (pk.length > 0 && [...pkSet].every((c) => spineCols.has(c))) ||
      (pk.length === 0 && t.columns.every((c) => spineCols.has(lc(c.name))))
    );
    kind.set(lc(t.name), isJunction ? "junction" : "entity");
    if (isJunction) spineFks.set(lc(t.name), spine);
  }

  /* entities ------------------------------------------------------------- */
  const entities = [];
  const entityById = new Map();
  const identifyingFk = new Map(); // table.name -> fk that is identifying (weak entity)

  for (const t of tables) {
    if (kind.get(lc(t.name)) !== "entity") continue;
    const pk = t.primaryKey || [];

    let weak = false;
    let idFk = null;
    if (detectWeak && pk.length > 0) {
      for (const fk of t.foreignKeys) {
        if (subset(fk.columns, pk) && fk.columns.length < pk.length &&
            kind.get(lc(resolve(fk.refTable).name)) === "entity") {
          weak = true; idFk = fk; break;
        }
      }
    }
    if (idFk) identifyingFk.set(lc(t.name), idFk);

    const idFkCols = idFk ? setOf(idFk.columns) : new Set();
    const plainFkCols = setOf(
      t.foreignKeys.flatMap((fk) => fk.columns).filter((c) => !pk.includes(c)),
    );

    const attributes = [];
    for (const col of t.columns) {
      const name = col.name;
      const inPk = pk.map(lc).includes(lc(name));
      if (idFkCols.has(lc(name))) continue;                 // comes in via identifying relationship
      if (hideFkColumns && !inPk && plainFkCols.has(lc(name))) continue;
      attributes.push({
        id: `attr:${t.name}:${name}`,
        name,
        type: col.type,
        isKey: inPk && !weak,
        isPartialKey: inPk && weak,
        isMultivalued: !!col.isArray,
        nullable: col.nullable,
      });
    }

    const e = {
      id: `entity:${t.name}`,
      name: t.name,
      label: t.displayName,
      weak,
      attributes,
    };
    entities.push(e);
    entityById.set(lc(t.name), e);
  }

  /* relationships ------------------------------------------------------- */
  const relationships = [];
  const seen = new Set();

  // (a) junction tables -> N-ary / M:N relationships
  for (const t of tables) {
    if (kind.get(lc(t.name)) !== "junction") continue;
    const spine = spineFks.get(lc(t.name)) || t.foreignKeys;
    const spineColsAll = setOf(spine.flatMap((fk) => fk.columns));
    const participants = spine.map((fk) => {
      const target = resolve(fk.refTable);
      return {
        entityId: `entity:${target.name}`,
        entityLabel: target.displayName,
        cardinality: "N",
        participation: fk.columns.every((c) => {
          const col = t.columns.find((x) => lc(x.name) === lc(c));
          return col && !col.nullable;
        }) ? "total" : "partial",
        role: roleFromColumns(fk.columns, target.displayName),
      };
    }).filter((p) => entityById.has(lc(p.entityId.slice("entity:".length))));

    if (participants.length < 2) continue;

    const attributes = t.columns
      .filter((c) => !spineColsAll.has(lc(c.name)))
      .map((c) => ({
        id: `attr:${t.name}:${c.name}`,
        name: c.name,
        type: c.type,
        isKey: false,
        isMultivalued: !!c.isArray,
      }));

    relationships.push({
      id: `rel:${t.name}`,
      name: t.name,
      label: t.displayName,
      identifying: false,
      fromJunction: true,
      participants,
      attributes,
    });
  }

  // (b) plain foreign keys -> binary relationships
  for (const t of tables) {
    if (kind.get(lc(t.name)) !== "entity") continue;
    const child = entityById.get(lc(t.name));
    if (!child) continue;
    const pk = t.primaryKey || [];
    const idFk = identifyingFk.get(lc(t.name));

    for (const fk of t.foreignKeys) {
      const parentTable = resolve(fk.refTable);
      if (kind.get(lc(parentTable.name)) === "junction") continue;
      const parent = entityById.get(lc(parentTable.name));
      if (!parent) continue;

      const key = `${t.name}|${fk.name}|${parentTable.name}|${fk.columns.join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // 1:1 when the local fk column-set is unique (or is/(covers) the child PK)
      const oneToOne =
        sameSet(fk.columns, pk) ||
        (t.uniques || []).some((u) => sameSet(u, fk.columns));

      const childTotal = fk.columns.every((c) => {
        const col = t.columns.find((x) => lc(x.name) === lc(c));
        return col && !col.nullable;
      });

      const identifying = idFk && idFk.name === fk.name;

      relationships.push({
        id: `rel:${t.name}:${fk.name}`,
        name: fk.name,
        label: roleFromColumns(fk.columns, `${child.label}-${parent.label}`),
        identifying: !!identifying,
        fromJunction: false,
        participants: [
          {
            entityId: parent.id,
            entityLabel: parent.label,
            cardinality: "1",
            participation: "partial",
            role: "one",
          },
          {
            entityId: child.id,
            entityLabel: child.label,
            cardinality: oneToOne ? "1" : "N",
            participation: childTotal || identifying ? "total" : "partial",
            role: "many",
          },
        ],
        attributes: [],
      });
    }
  }

  return { engine: schema.engine, entities, relationships };
}

/* ------------------------------------------------------------ 2. layout */

/**
 * Assigns x/y/width/height to every entity, relationship and attribute, and
 * produces a flat list of connectors.
 */
export function layoutChenModel(model, opts = {}) {
  const {
    layout = "grid",
    entityW = 210,
    entityH = 96,
    relW = 176,
    relH = 100,
    attrW = 132,
    attrH = 52,
    gapX = 560,
    gapY = 480,
    attrGap = 60,
  } = opts;

  const nodes = new Map(); // id -> { id, kind, x, y, width, height, ...meta }
  const connectors = [];   // { id, a, b, kind, participation, label? }
  const labels = [];       // free-standing text { id, x, y, text, fontSize }

  const entities = model.entities;
  const n = entities.length || 1;

  const place = (i) => {
    if (layout === "circle") {
      const R = Math.max(360, n * 78);
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      return { x: Math.cos(a) * R, y: Math.sin(a) * R };
    }
    const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
    return { x: (i % cols) * gapX, y: Math.floor(i / cols) * gapY };
  };

  // entities + their attributes
  entities.forEach((e, i) => {
    const { x, y } = place(i);
    const ex = x;
    const ey = y;
    nodes.set(e.id, {
      id: e.id, kind: "entity", weak: e.weak,
      x: ex, y: ey, width: entityW, height: entityH, label: e.label,
      cx: ex + entityW / 2, cy: ey + entityH / 2,
    });

    const attrs = e.attributes;
    const leftCount = Math.ceil(attrs.length / 2);
    attrs.forEach((att, j) => {
      const onLeft = j < leftCount;
      const idxOnSide = onLeft ? j : j - leftCount;
      const countOnSide = onLeft ? leftCount : attrs.length - leftCount;
      const stackH = (countOnSide - 1) * attrGap;
      const ay = ey + entityH / 2 - stackH / 2 + idxOnSide * attrGap - attrH / 2;
      const ax = onLeft ? ex - 150 - attrW : ex + entityW + 150;
      nodes.set(att.id, {
        id: att.id, kind: "attribute",
        isKey: att.isKey, isPartialKey: att.isPartialKey, isMultivalued: att.isMultivalued,
        x: ax, y: ay, width: attrW, height: attrH, label: att.name,
        cx: ax + attrW / 2, cy: ay + attrH / 2,
      });
      connectors.push({ id: `c:${att.id}`, a: e.id, b: att.id, kind: "attr" });
    });
  });

  // relationships
  for (const r of model.relationships) {
    const parts = r.participants.filter((p) => nodes.has(p.entityId));
    if (parts.length < 2) continue;
    const pts = parts.map((p) => nodes.get(p.entityId));
    let rx = pts.reduce((s, p) => s + p.cx, 0) / pts.length - relW / 2;
    let ry = pts.reduce((s, p) => s + p.cy, 0) / pts.length - relH / 2;

    // nudge the diamond off any entity it lands on
    for (const nd of nodes.values()) {
      if (nd.kind !== "entity") continue;
      const overlap = rx < nd.x + nd.width + 24 && rx + relW > nd.x - 24 &&
                      ry < nd.y + nd.height + 24 && ry + relH > nd.y - 24;
      if (overlap) { ry = nd.y - relH - 60; }
    }

    nodes.set(r.id, {
      id: r.id, kind: "relationship", identifying: r.identifying,
      x: rx, y: ry, width: relW, height: relH, label: r.label,
      cx: rx + relW / 2, cy: ry + relH / 2,
    });

    parts.forEach((p) => {
      const ent = nodes.get(p.entityId);
      connectors.push({
        id: `c:${r.id}:${p.entityId}`, a: r.id, b: p.entityId,
        kind: "rel", participation: p.participation,
      });
      // cardinality label 30% of the way from diamond to entity
      const t = 0.34;
      const lx = (rx + relW / 2) + (ent.cx - (rx + relW / 2)) * t - 8;
      const ly = (ry + relH / 2) + (ent.cy - (ry + relH / 2)) * t - 12;
      labels.push({ id: `l:${r.id}:${p.entityId}`, x: lx, y: ly, text: p.cardinality, fontSize: 20 });
    });

    // relationship attributes ring around the diamond
    (r.attributes || []).forEach((att, j) => {
      const ang = (j / Math.max(1, r.attributes.length)) * Math.PI * 2 - Math.PI / 2;
      const ax = rx + relW / 2 + Math.cos(ang) * 210 - attrW / 2;
      const ay = ry + relH / 2 + Math.sin(ang) * 150 - attrH / 2;
      nodes.set(att.id, {
        id: att.id, kind: "attribute", isKey: false, isMultivalued: att.isMultivalued,
        x: ax, y: ay, width: attrW, height: attrH, label: att.name,
        cx: ax + attrW / 2, cy: ay + attrH / 2,
      });
      connectors.push({ id: `c:${att.id}`, a: r.id, b: att.id, kind: "attr" });
    });
  }

  return { nodes: [...nodes.values()], connectors, labels };
}

/* ----------------------------------------------------- 3. skeleton emit */

const INK = "#1e1e1e";
const ENTITY_BG = "#ffffff";
const REL_BG = "#ffec99";
const ATTR_BG = "#e7f5ff";

/**
 * @returns {object[]} array accepted by convertToExcalidrawElements()
 */
export function toSkeleton(layout) {
  const els = [];
  const shapes = [];
  const conns = [];

  for (const nd of layout.nodes) {
    if (nd.kind === "entity") {
      if (nd.weak) {
        shapes.push({
          type: "rectangle", id: `${nd.id}__outer`,
          x: nd.x - 7, y: nd.y - 7, width: nd.width + 14, height: nd.height + 14,
          strokeColor: INK, backgroundColor: "transparent", strokeWidth: 1.5, roughness: 1,
        });
      }
      shapes.push({
        type: "rectangle", id: nd.id,
        x: nd.x, y: nd.y, width: nd.width, height: nd.height,
        strokeColor: INK, backgroundColor: ENTITY_BG, strokeWidth: 2, roughness: 1,
        label: { text: nd.label, fontSize: 20, fontFamily: 2, strokeColor: INK },
      });
    } else if (nd.kind === "relationship") {
      if (nd.identifying) {
        shapes.push({
          type: "diamond", id: `${nd.id}__outer`,
          x: nd.x - 9, y: nd.y - 9, width: nd.width + 18, height: nd.height + 18,
          strokeColor: INK, backgroundColor: "transparent", strokeWidth: 1.5, roughness: 1,
        });
      }
      shapes.push({
        type: "diamond", id: nd.id,
        x: nd.x, y: nd.y, width: nd.width, height: nd.height,
        strokeColor: INK, backgroundColor: REL_BG, strokeWidth: 2, roughness: 1,
        label: { text: nd.label, fontSize: 18, fontFamily: 2, strokeColor: INK },
      });
    } else if (nd.kind === "attribute") {
      if (nd.isMultivalued) {
        shapes.push({
          type: "ellipse", id: `${nd.id}__outer`,
          x: nd.x - 7, y: nd.y - 7, width: nd.width + 14, height: nd.height + 14,
          strokeColor: INK, backgroundColor: "transparent", strokeWidth: 1.5, roughness: 1,
        });
      }
      shapes.push({
        type: "ellipse", id: nd.id,
        x: nd.x, y: nd.y, width: nd.width, height: nd.height,
        strokeColor: INK, backgroundColor: ATTR_BG, strokeWidth: 1.5, roughness: 1,
        label: { text: nd.label, fontSize: 16, fontFamily: 3, strokeColor: INK },
      });
      if (nd.isKey || nd.isPartialKey) {
        const tw = Math.min(nd.width - 22, Math.max(20, nd.label.length * 8));
        shapes.push({
          type: "line", id: `${nd.id}__ul`,
          x: nd.cx - tw / 2, y: nd.cy + 11,
          width: tw, height: 0, points: [[0, 0], [tw, 0]],
          strokeColor: INK, strokeWidth: 1.5,
          strokeStyle: nd.isPartialKey ? "dashed" : "solid",
        });
      }
    }
  }

  for (const c of layout.connectors) {
    const A = layout.nodes.find((n) => n.id === c.a);
    const B = layout.nodes.find((n) => n.id === c.b);
    if (!A || !B) continue;
    const total = c.participation === "total";
    conns.push({
      type: "arrow", id: c.id,
      x: A.cx, y: A.cy,
      width: B.cx - A.cx, height: B.cy - A.cy,
      points: [[0, 0], [B.cx - A.cx, B.cy - A.cy]],
      strokeColor: INK,
      strokeWidth: c.kind === "rel" && total ? 3.5 : 1.25,
      roughness: 1,
      startArrowhead: null, endArrowhead: null,
      start: { id: c.a }, end: { id: c.b },
    });
  }

  for (const l of layout.labels) {
    els.push({ type: "text", id: l.id, x: l.x, y: l.y, text: l.text, fontSize: l.fontSize, fontFamily: 3, strokeColor: INK });
  }

  return [...shapes, ...conns, ...els];
}

/* ------------------------------------------------------------ wrapper */

export function schemaToSkeleton(schema, opts = {}) {
  const model = buildChenModel(schema, opts);
  const layout = layoutChenModel(model, opts);
  return { model, layout, skeleton: toSkeleton(layout) };
}
