import "dotenv/config"
import fs from "fs"
import path from "path"
import mysql from "mysql2/promise"
import { isSchemaContractDefinitionFile } from "./lib/databaseFilePolicy.mjs"
import {
  buildSchemaContracts,
  compareSchemaContracts,
  serializeExpectedCounts,
} from "./lib/schemaContract.mjs"

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error("DATABASE_URL is required")

const databaseDirectory = path.resolve(process.cwd(), "database")
const definitionFiles = fs.readdirSync(databaseDirectory)
  .filter(isSchemaContractDefinitionFile)
  .sort((left, right) => {
    if (left === "schema.sql") return -1
    if (right === "schema.sql") return 1
    const leftNumber = Number(left.match(/^(\d{3})_/)?.[1] || 0)
    const rightNumber = Number(right.match(/^(\d{3})_/)?.[1] || 0)
    if (leftNumber !== rightNumber) return leftNumber - rightNumber
    return left.localeCompare(right)
  })

const definitionInputs = definitionFiles.map((source) => ({
  source,
  content: fs.readFileSync(path.join(databaseDirectory, source), "utf8"),
}))
const { expected, warnings: parserWarnings } = buildSchemaContracts(definitionInputs)
const expectedCounts = serializeExpectedCounts(expected)

const connection = await mysql.createConnection({ uri: databaseUrl, dateStrings: true })
try {
  await connection.query("SET SESSION TRANSACTION READ ONLY")
  await connection.query("START TRANSACTION READ ONLY")
  const [[identity]] = await connection.query(
    "SELECT DATABASE() database_name, VERSION() server_version, @@version_comment version_comment",
  )
  const [tableRows] = await connection.query(
    `SELECT TABLE_NAME AS table_name
       FROM information_schema.tables
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'`,
  )
  const [columnRows] = await connection.query(
    `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name,
            COLUMN_TYPE AS column_type, IS_NULLABLE AS is_nullable,
            COLUMN_DEFAULT AS column_default, EXTRA AS extra
       FROM information_schema.columns
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME, ORDINAL_POSITION`,
  )
  const [indexRows] = await connection.query(
    `SELECT TABLE_NAME AS table_name, INDEX_NAME AS index_name,
            NON_UNIQUE AS non_unique, SEQ_IN_INDEX AS seq_in_index,
            COLUMN_NAME AS column_name, SUB_PART AS sub_part, COLLATION AS collation
       FROM information_schema.statistics
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
  )
  const [foreignKeyRows] = await connection.query(
    `SELECT TABLE_NAME AS table_name, CONSTRAINT_NAME AS constraint_name,
            COLUMN_NAME AS column_name, ORDINAL_POSITION AS ordinal_position,
            REFERENCED_TABLE_NAME AS referenced_table_name,
            REFERENCED_COLUMN_NAME AS referenced_column_name
       FROM information_schema.key_column_usage
      WHERE TABLE_SCHEMA = DATABASE()
        AND REFERENCED_TABLE_NAME IS NOT NULL
      ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION`,
  )
  const [referentialRuleRows] = await connection.query(
    `SELECT TABLE_NAME AS table_name, CONSTRAINT_NAME AS constraint_name,
            REFERENCED_TABLE_NAME AS referenced_table_name,
            UPDATE_RULE AS update_rule, DELETE_RULE AS delete_rule
       FROM information_schema.referential_constraints
      WHERE CONSTRAINT_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME, CONSTRAINT_NAME`,
  )
  const comparison = compareSchemaContracts(expected, {
    tables: tableRows,
    columns: columnRows,
    indexes: indexRows,
    foreignKeys: foreignKeyRows,
    referentialRules: referentialRuleRows,
  })
  console.log(JSON.stringify({
    identity,
    definition_files: definitionFiles,
    parser_warnings: {
      count: parserWarnings.length,
      samples: parserWarnings.slice(0, 25),
    },
    expected: expectedCounts,
    actual_tables: comparison.actualTableCount,
    status: comparison.status,
    mismatch_count: comparison.mismatchCount,
    missing_tables: comparison.missingTables,
    missing_columns: comparison.missingColumns,
    column_mismatches: comparison.columnMismatches,
    missing_indexes: comparison.missingIndexes,
    index_mismatches: comparison.indexMismatches,
    missing_foreign_keys: comparison.missingForeignKeys,
    foreign_key_mismatches: comparison.foreignKeyMismatches,
  }, null, 2))
  await connection.query("ROLLBACK")
} finally {
  await connection.end()
}
