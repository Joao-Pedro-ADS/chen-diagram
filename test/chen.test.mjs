import test from "node:test";
import assert from "node:assert/strict";
import { buildChenModel, layoutChenModel, toSkeleton, schemaToSkeleton } from "../shared/chen.mjs";

const schema = {
  engine: "test",
  tables: [
    {
      name: "users", displayName: "users",
      columns: [
        { name: "id", type: "int", nullable: false },
        { name: "email", type: "text", nullable: false },
      ],
      primaryKey: ["id"], uniques: [["email"]], foreignKeys: [],
    },
    {
      name: "profiles", displayName: "profiles",
      columns: [
        { name: "user_id", type: "int", nullable: false },
        { name: "bio", type: "text", nullable: true },
      ],
      primaryKey: ["user_id"], uniques: [],
      foreignKeys: [{ name: "fk_p_u", columns: ["user_id"], refTable: "users", refColumns: ["id"] }],
    },
    {
      name: "posts", displayName: "posts",
      columns: [
        { name: "id", type: "int", nullable: false },
        { name: "author_id", type: "int", nullable: false },
        { name: "title", type: "text", nullable: false },
      ],
      primaryKey: ["id"], uniques: [],
      foreignKeys: [{ name: "fk_post_author", columns: ["author_id"], refTable: "users", refColumns: ["id"] }],
    },
    {
      name: "comments", displayName: "comments",
      columns: [
        { name: "post_id", type: "int", nullable: false },
        { name: "seq", type: "int", nullable: false },
        { name: "body", type: "text", nullable: false },
      ],
      primaryKey: ["post_id", "seq"], uniques: [],
      foreignKeys: [{ name: "fk_c_post", columns: ["post_id"], refTable: "posts", refColumns: ["id"] }],
    },
    {
      name: "tags", displayName: "tags",
      columns: [{ name: "id", type: "int", nullable: false }, { name: "name", type: "text", nullable: false }],
      primaryKey: ["id"], uniques: [["name"]], foreignKeys: [],
    },
    {
      name: "post_tags", displayName: "post_tags",
      columns: [
        { name: "post_id", type: "int", nullable: false },
        { name: "tag_id", type: "int", nullable: false },
        { name: "added_by", type: "int", nullable: true },
      ],
      primaryKey: ["post_id", "tag_id"], uniques: [],
      foreignKeys: [
        { name: "fk_pt_post", columns: ["post_id"], refTable: "posts", refColumns: ["id"] },
        { name: "fk_pt_tag", columns: ["tag_id"], refTable: "tags", refColumns: ["id"] },
        { name: "fk_pt_user", columns: ["added_by"], refTable: "users", refColumns: ["id"] },
      ],
    },
  ],
};

test("post_tags collapses to an M:N relationship with 2 participants", () => {
  const m = buildChenModel(schema);
  const names = m.entities.map((e) => e.label).sort();
  assert.deepEqual(names, ["comments", "posts", "profiles", "tags", "users"]);

  const junction = m.relationships.find((r) => r.fromJunction);
  assert.ok(junction, "expected a junction relationship");
  assert.equal(junction.participants.length, 2);
  assert.deepEqual(junction.participants.map((p) => p.cardinality), ["N", "N"]);
  assert.ok(junction.attributes.some((a) => a.name === "added_by"), "added_by is a relationship attribute");
});

test("comments is a weak entity with a partial key", () => {
  const m = buildChenModel(schema);
  const comments = m.entities.find((e) => e.label === "comments");
  assert.equal(comments.weak, true);
  assert.ok(comments.attributes.some((a) => a.name === "seq" && a.isPartialKey));
  assert.ok(!comments.attributes.some((a) => a.name === "post_id"), "identifying FK column is hidden");
  const idRel = m.relationships.find((r) => r.identifying);
  assert.ok(idRel, "expected an identifying relationship");
});

test("profiles<->users is detected as 1:1", () => {
  const m = buildChenModel(schema);
  const rel = m.relationships.find(
    (r) => !r.fromJunction &&
      r.participants.some((p) => p.entityId === "entity:profiles"),
  );
  assert.deepEqual(rel.participants.map((p) => p.cardinality).sort(), ["1", "1"]);
});

test("posts.author_id is 1:N and hidden from attributes", () => {
  const m = buildChenModel(schema, { hideFkColumns: true });
  const posts = m.entities.find((e) => e.label === "posts");
  assert.ok(!posts.attributes.some((a) => a.name === "author_id"));
  const rel = m.relationships.find(
    (r) => r.participants.some((p) => p.entityId === "entity:posts") &&
           r.participants.some((p) => p.entityId === "entity:users"),
  );
  assert.deepEqual(rel.participants.map((p) => p.cardinality).sort(), ["1", "N"]);
});

test("layout + skeleton produce well-formed excalidraw elements", () => {
  const { skeleton } = schemaToSkeleton(schema);
  assert.ok(skeleton.length > 0);
  const ids = new Set(skeleton.map((e) => e.id));
  assert.equal(ids.size, skeleton.length, "ids are unique");
  for (const el of skeleton) {
    if (el.type === "arrow") {
      assert.ok(ids.has(el.start.id), `arrow start ${el.start.id} exists`);
      assert.ok(ids.has(el.end.id), `arrow end ${el.end.id} exists`);
    }
    assert.equal(typeof el.x, "number");
    assert.equal(typeof el.y, "number");
  }
});
