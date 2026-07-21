import test from "node:test"
import assert from "node:assert/strict"
import {
  buildSchemaContracts,
  compareSchemaContracts,
  normalizeColumnDefault,
  normalizeColumnType,
} from "../scripts/lib/schemaContract.mjs"

const definition = `
  CREATE TABLE parents (
    id BIGINT UNSIGNED PRIMARY KEY,
    school_id BIGINT UNSIGNED NOT NULL,
    UNIQUE KEY uq_parent_school (school_id)
  );

  CREATE TABLE children (
    id BIGINT UNSIGNED PRIMARY KEY,
    parent_id BIGINT UNSIGNED NOT NULL,
    status ENUM('draft', 'done') NOT NULL DEFAULT 'draft',
    note VARCHAR(80) NULL DEFAULT NULL,
    label VARCHAR(20) NOT NULL DEFAULT '--keep',
    UNIQUE KEY uq_child_parent (parent_id, status),
    KEY idx_child_status (status),
    CONSTRAINT fk_child_parent FOREIGN KEY (parent_id)
      REFERENCES parents(id) ON DELETE CASCADE ON UPDATE RESTRICT
  );

  ALTER TABLE children
    MODIFY COLUMN status ENUM('draft', 'done', 'closed') NOT NULL DEFAULT 'done',
    ADD COLUMN score DECIMAL(5, 2) NOT NULL DEFAULT 0,
    ADD UNIQUE KEY IF NOT EXISTS uq_child_score (parent_id, score);
`

function expectedContract() {
  return buildSchemaContracts([{ source: "fixture.sql", content: definition }]).expected
}

function metadata() {
  const columns = [
    ["parents", "id", "bigint unsigned", "NO", null],
    ["parents", "school_id", "bigint unsigned", "NO", null],
    ["children", "id", "bigint unsigned", "NO", null],
    ["children", "parent_id", "bigint unsigned", "NO", null],
    ["children", "status", "enum('draft','done','closed')", "NO", "done"],
    ["children", "note", "varchar(80)", "YES", null],
    ["children", "label", "varchar(20)", "NO", "--keep"],
    ["children", "score", "decimal(5,2)", "NO", "0.00"],
  ].map(([table_name, column_name, column_type, is_nullable, column_default]) => ({
    table_name, column_name, column_type, is_nullable, column_default,
  }))

  const index = (table_name, index_name, non_unique, names) => names.map((column_name, offset) => ({
    table_name,
    index_name,
    non_unique,
    seq_in_index: offset + 1,
    column_name,
    sub_part: null,
    collation: "A",
  }))
  const indexes = [
    ...index("parents", "PRIMARY", 0, ["id"]),
    ...index("parents", "uq_parent_school", 0, ["school_id"]),
    ...index("children", "PRIMARY", 0, ["id"]),
    ...index("children", "uq_child_parent", 0, ["parent_id", "status"]),
    ...index("children", "idx_child_status", 1, ["status"]),
    ...index("children", "uq_child_score", 0, ["parent_id", "score"]),
  ]
  return {
    tables: [{ table_name: "parents" }, { table_name: "children" }],
    columns,
    indexes,
    foreignKeys: [{
      table_name: "children",
      constraint_name: "fk_child_parent",
      column_name: "parent_id",
      ordinal_position: 1,
      referenced_table_name: "parents",
      referenced_column_name: "id",
    }],
    referentialRules: [{
      table_name: "children",
      constraint_name: "fk_child_parent",
      referenced_table_name: "parents",
      update_rule: "RESTRICT",
      delete_rule: "CASCADE",
    }],
  }
}

test("schema contract parser applies alter definitions without corrupting quoted comment text", () => {
  const { expected, warnings } = buildSchemaContracts([{ source: "fixture.sql", content: definition }])
  assert.deepEqual(warnings, [])
  const children = expected.get("children")
  assert.ok(children)
  assert.deepEqual(
    {
      type: children.columns.get("status").type,
      nullable: children.columns.get("status").nullable,
      default: children.columns.get("status").default,
    },
    { type: "enum('draft','done','closed')", nullable: false, default: "done" },
  )
  assert.equal(children.columns.get("label").default, "--keep")
  assert.equal(children.columns.get("score").type, "decimal(5,2)")
  assert.deepEqual(children.indexes.get("uq_child_score").columns.map((part) => part.column), ["parent_id", "score"])
  assert.deepEqual(
    {
      columns: children.foreignKeys.get("fk_child_parent").columns,
      referencedTable: children.foreignKeys.get("fk_child_parent").referencedTable,
      onDelete: children.foreignKeys.get("fk_child_parent").onDelete,
      onUpdate: children.foreignKeys.get("fk_child_parent").onUpdate,
    },
    { columns: ["parent_id"], referencedTable: "parents", onDelete: "CASCADE", onUpdate: "RESTRICT" },
  )
})

test("schema contract comparison accepts matching column, index, and foreign-key metadata", () => {
  const comparison = compareSchemaContracts(expectedContract(), metadata())
  assert.equal(comparison.status, "in_sync")
  assert.equal(comparison.mismatchCount, 0)
})

test("schema contract comparison reports wrong definitions, uniqueness, and referential rules", () => {
  const actual = metadata()
  const status = actual.columns.find((column) => column.table_name === "children" && column.column_name === "status")
  status.column_type = "enum('draft','done')"
  status.is_nullable = "YES"
  status.column_default = "draft"
  actual.indexes.find((index) => index.table_name === "children" && index.index_name === "uq_child_parent").non_unique = 1
  actual.referentialRules[0].delete_rule = "RESTRICT"

  const comparison = compareSchemaContracts(expectedContract(), actual)
  assert.equal(comparison.status, "drift_detected")
  assert.equal(comparison.mismatchCount, 3)
  assert.deepEqual(comparison.columnMismatches[0].differences, ["type", "nullable", "default"])
  assert.equal(comparison.indexMismatches[0].index, "uq_child_parent")
  assert.equal(comparison.foreignKeyMismatches[0].constraint, "fk_child_parent")
})

test("schema value normalization follows information_schema representations", () => {
  assert.equal(normalizeColumnType("BOOLEAN"), "tinyint(1)")
  assert.equal(normalizeColumnType("DECIMAL ( 5 , 2 ) UNSIGNED"), "decimal(5,2) unsigned")
  assert.equal(normalizeColumnDefault("0.00"), "0")
  assert.equal(normalizeColumnDefault("CURRENT_TIMESTAMP()"), "current_timestamp")
})
